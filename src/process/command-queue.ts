import { diagnosticLogger as diag, logLaneDequeue, logLaneEnqueue } from "../logging/diagnostic.js";
import { CommandLane, TaskPriority } from "./lanes.js";

// Enhanced in-process queue with priority scheduling and per-session isolation.
//
// Key improvements over the original:
// 1. Priority levels (Urgent > Normal > Background)
// 2. Per-session lanes - sessions don't block each other
// 3. Global concurrency limit across all sessions
// 4. Backward compatible with existing API

type QueueEntry = {
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  enqueuedAt: number;
  warnAfterMs: number;
  priority: TaskPriority;
  sessionKey?: string;
  onWait?: (waitMs: number, queuedAhead: number) => void;
};

type LaneState = {
  lane: string;
  /** Priority buckets: index = priority level */
  buckets: QueueEntry[][];
  active: number;
  activeTaskIds: Set<number>;
  maxConcurrent: number;
  draining: boolean;
};

/**
 * Per-session state for session-isolated lanes.
 * Each session gets serialized execution (1 at a time per session),
 * but multiple sessions can run in parallel up to global limit.
 */
type SessionLaneState = {
  sessionKey: string;
  queue: QueueEntry[];
  active: boolean;
};

const lanes = new Map<string, LaneState>();
let nextTaskId = 1;
const sessionLanes = new Map<string, SessionLaneState>();

// Global limit for concurrent session runs (prevents resource exhaustion)
let maxConcurrentSessions = 16;
let activeSessionCount = 0;

function createEmptyBuckets(): QueueEntry[][] {
  return [[], [], []]; // Urgent, Normal, Background
}

function getLaneState(lane: string): LaneState {
  const existing = lanes.get(lane);
  if (existing) {
    return existing;
  }
  const created: LaneState = {
    lane,
    buckets: createEmptyBuckets(),
    active: 0,
    activeTaskIds: new Set(),
    maxConcurrent: 1,
    draining: false,
  };
  lanes.set(lane, created);
  return created;
}

function getSessionLaneState(sessionKey: string): SessionLaneState {
  const existing = sessionLanes.get(sessionKey);
  if (existing) {
    return existing;
  }
  const created: SessionLaneState = {
    sessionKey,
    queue: [],
    active: false,
  };
  sessionLanes.set(sessionKey, created);
  return created;
}

/**
 * Get total queued entries across all priority buckets.
 */
function getTotalQueued(state: LaneState): number {
  return state.buckets.reduce((sum, bucket) => sum + bucket.length, 0);
}

/**
 * Dequeue the highest priority entry.
 */
function dequeueHighestPriority(state: LaneState): QueueEntry | undefined {
  for (const bucket of state.buckets) {
    if (bucket.length > 0) {
      return bucket.shift();
    }
  }
  return undefined;
}

/**
 * Enqueue entry into the appropriate priority bucket.
 */
function enqueueWithPriority(state: LaneState, entry: QueueEntry) {
  const bucketIndex = Math.min(Math.max(0, entry.priority), state.buckets.length - 1);
  state.buckets[bucketIndex].push(entry);
}

function drainLane(lane: string) {
  const state = getLaneState(lane);
  if (state.draining) {
    return;
  }
  state.draining = true;

  const pump = () => {
    while (state.active < state.maxConcurrent && getTotalQueued(state) > 0) {
      const entry = dequeueHighestPriority(state);
      if (!entry) break;

      const waitedMs = Date.now() - entry.enqueuedAt;
      if (waitedMs >= entry.warnAfterMs) {
        entry.onWait?.(waitedMs, getTotalQueued(state));
        diag.warn(
          `lane wait exceeded: lane=${lane} priority=${entry.priority} waitedMs=${waitedMs} queueAhead=${getTotalQueued(state)}`,
        );
      }
      logLaneDequeue(lane, waitedMs, getTotalQueued(state));
      const taskId = nextTaskId++;
      state.active += 1;
      state.activeTaskIds.add(taskId);
      void (async () => {
        const startTime = Date.now();
        try {
          const result = await entry.task();
          state.active -= 1;
          state.activeTaskIds.delete(taskId);
          diag.debug(
            `lane task done: lane=${lane} priority=${entry.priority} durationMs=${Date.now() - startTime} active=${state.active} queued=${getTotalQueued(state)}`,
          );
          pump();
          entry.resolve(result);
        } catch (err) {
          state.active -= 1;
          state.activeTaskIds.delete(taskId);
          const isProbeLane = lane.startsWith("auth-probe:") || lane.startsWith("session:probe-");
          if (!isProbeLane) {
            diag.error(
              `lane task error: lane=${lane} priority=${entry.priority} durationMs=${Date.now() - startTime} error="${String(err)}"`,
            );
          }
          pump();
          entry.reject(err);
        }
      })();
    }
    state.draining = false;
  };

  pump();
}

/**
 * Drain session-isolated lane.
 * Each session is serialized, but sessions run in parallel.
 */
function drainSessionLane(sessionKey: string) {
  const state = getSessionLaneState(sessionKey);

  // Already running a task for this session
  if (state.active) {
    return;
  }

  // No tasks queued
  if (state.queue.length === 0) {
    return;
  }

  // Global session limit reached - wait for a slot
  if (activeSessionCount >= maxConcurrentSessions) {
    return;
  }

  const entry = state.queue.shift();
  if (!entry) return;

  state.active = true;
  activeSessionCount += 1;

  const waitedMs = Date.now() - entry.enqueuedAt;
  if (waitedMs >= entry.warnAfterMs) {
    entry.onWait?.(waitedMs, state.queue.length);
    diag.warn(
      `session lane wait exceeded: session=${sessionKey} priority=${entry.priority} waitedMs=${waitedMs} queueAhead=${state.queue.length}`,
    );
  }

  diag.debug(`session lane dequeue: session=${sessionKey} priority=${entry.priority} waitedMs=${waitedMs}`);

  void (async () => {
    const startTime = Date.now();
    try {
      const result = await entry.task();
      state.active = false;
      activeSessionCount -= 1;
      diag.debug(
        `session task done: session=${sessionKey} priority=${entry.priority} durationMs=${Date.now() - startTime} queued=${state.queue.length}`,
      );
      // Drain this session's queue
      drainSessionLane(sessionKey);
      // Try to activate other waiting sessions
      drainWaitingSessions();
      entry.resolve(result);
    } catch (err) {
      state.active = false;
      activeSessionCount -= 1;
      diag.error(
        `session task error: session=${sessionKey} priority=${entry.priority} durationMs=${Date.now() - startTime} error="${String(err)}"`,
      );
      drainSessionLane(sessionKey);
      drainWaitingSessions();
      entry.reject(err);
    }
  })();
}

/**
 * Try to activate sessions that were waiting for a global slot.
 */
function drainWaitingSessions() {
  if (activeSessionCount >= maxConcurrentSessions) {
    return;
  }

  // Find sessions with pending work that aren't active
  for (const [sessionKey, state] of sessionLanes) {
    if (!state.active && state.queue.length > 0) {
      drainSessionLane(sessionKey);
      if (activeSessionCount >= maxConcurrentSessions) {
        break;
      }
    }
  }
}

export function setCommandLaneConcurrency(lane: string, maxConcurrent: number) {
  const cleaned = lane.trim() || CommandLane.Main;
  const state = getLaneState(cleaned);
  state.maxConcurrent = Math.max(1, Math.floor(maxConcurrent));
  drainLane(cleaned);
}

/**
 * Set the global limit for concurrent session runs.
 */
export function setMaxConcurrentSessions(max: number) {
  const previous = maxConcurrentSessions;
  maxConcurrentSessions = Math.max(1, Math.floor(max));
  if (maxConcurrentSessions > previous) {
    drainWaitingSessions();
  }
}

export type EnqueueOptions = {
  warnAfterMs?: number;
  priority?: TaskPriority;
  onWait?: (waitMs: number, queuedAhead: number) => void;
};

export function enqueueCommandInLane<T>(
  lane: string,
  task: () => Promise<T>,
  opts?: EnqueueOptions,
): Promise<T> {
  const cleaned = lane.trim() || CommandLane.Main;
  const warnAfterMs = opts?.warnAfterMs ?? 2_000;
  const priority = opts?.priority ?? TaskPriority.Normal;
  const state = getLaneState(cleaned);
  return new Promise<T>((resolve, reject) => {
    const entry: QueueEntry = {
      task: () => task(),
      resolve: (value) => resolve(value as T),
      reject,
      enqueuedAt: Date.now(),
      warnAfterMs,
      priority,
      onWait: opts?.onWait,
    };
    enqueueWithPriority(state, entry);
    logLaneEnqueue(cleaned, getTotalQueued(state) + state.active);
    drainLane(cleaned);
  });
}

export type SessionEnqueueOptions = EnqueueOptions & {
  sessionKey: string;
};

/**
 * Enqueue a task for a specific session.
 * Tasks for the same session are serialized (FIFO within priority).
 * Different sessions run in parallel up to the global limit.
 */
export function enqueueSessionTask<T>(
  task: () => Promise<T>,
  opts: SessionEnqueueOptions,
): Promise<T> {
  const { sessionKey, warnAfterMs = 2_000, priority = TaskPriority.Normal, onWait } = opts;

  if (!sessionKey) {
    // Fallback to main lane if no session key
    return enqueueCommandInLane(CommandLane.Main, task, { warnAfterMs, priority, onWait });
  }

  const state = getSessionLaneState(sessionKey);

  return new Promise<T>((resolve, reject) => {
    const entry: QueueEntry = {
      task: () => task(),
      resolve: (value) => resolve(value as T),
      reject,
      enqueuedAt: Date.now(),
      warnAfterMs,
      priority,
      sessionKey,
      onWait,
    };

    // Insert by priority within the session's queue
    let inserted = false;
    for (let i = 0; i < state.queue.length; i++) {
      if (state.queue[i].priority > priority) {
        state.queue.splice(i, 0, entry);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      state.queue.push(entry);
    }

    diag.debug(
      `session enqueue: session=${sessionKey} priority=${priority} queued=${state.queue.length} active=${state.active}`,
    );

    drainSessionLane(sessionKey);
  });
}

export function enqueueCommand<T>(
  task: () => Promise<T>,
  opts?: EnqueueOptions,
): Promise<T> {
  return enqueueCommandInLane(CommandLane.Main, task, opts);
}

export function getQueueSize(lane: string = CommandLane.Main) {
  const resolved = lane.trim() || CommandLane.Main;
  const state = lanes.get(resolved);
  if (!state) {
    return 0;
  }
  return getTotalQueued(state) + state.active;
}

export function getSessionQueueSize(sessionKey: string): number {
  const state = sessionLanes.get(sessionKey);
  if (!state) {
    return 0;
  }
  return state.queue.length + (state.active ? 1 : 0);
}

export function getTotalQueueSize() {
  let total = 0;
  for (const s of lanes.values()) {
    total += getTotalQueued(s) + s.active;
  }
  return total;
}

export function getTotalSessionQueueSize(): number {
  let total = 0;
  for (const s of sessionLanes.values()) {
    total += s.queue.length + (s.active ? 1 : 0);
  }
  return total;
}

export function getActiveSessionCount(): number {
  return activeSessionCount;
}

export function clearCommandLane(lane: string = CommandLane.Main) {
  const cleaned = lane.trim() || CommandLane.Main;
  const state = lanes.get(cleaned);
  if (!state) {
    return 0;
  }
  const removed = getTotalQueued(state);
  state.buckets = createEmptyBuckets();
  return removed;
}

export function clearSessionLane(sessionKey: string): number {
  const state = sessionLanes.get(sessionKey);
  if (!state) {
    return 0;
  }
  const removed = state.queue.length;
  state.queue = [];
  return removed;
}

/**
 * Returns the total number of actively executing tasks across all lanes
 * (excludes queued-but-not-started entries).
 */
export function getActiveTaskCount(): number {
  let total = 0;
  for (const s of lanes.values()) {
    total += s.active;
  }
  return total;
}

/**
 * Wait for all currently active tasks across all lanes to finish.
 * Polls at a short interval; resolves when no tasks are active or
 * when `timeoutMs` elapses (whichever comes first).
 *
 * New tasks enqueued after this call are ignored — only tasks that are
 * already executing are waited on.
 */
export function waitForActiveTasks(timeoutMs: number): Promise<{ drained: boolean }> {
  const POLL_INTERVAL_MS = 250;
  const deadline = Date.now() + timeoutMs;
  const activeAtStart = new Set<number>();
  for (const state of lanes.values()) {
    for (const taskId of state.activeTaskIds) {
      activeAtStart.add(taskId);
    }
  }

  return new Promise((resolve) => {
    const check = () => {
      if (activeAtStart.size === 0) {
        resolve({ drained: true });
        return;
      }

      let hasPending = false;
      for (const state of lanes.values()) {
        for (const taskId of state.activeTaskIds) {
          if (activeAtStart.has(taskId)) {
            hasPending = true;
            break;
          }
        }
        if (hasPending) {
          break;
        }
      }

      if (!hasPending) {
        resolve({ drained: true });
        return;
      }
      if (Date.now() >= deadline) {
        resolve({ drained: false });
        return;
      }
      setTimeout(check, POLL_INTERVAL_MS);
    };
    check();
  });
}

/**
 * Get queue statistics for monitoring.
 */
export function getQueueStats(): {
  lanes: Record<string, { queued: number; active: number; maxConcurrent: number }>;
  sessions: { total: number; active: number; maxConcurrent: number };
  byPriority: { urgent: number; normal: number; background: number };
} {
  const laneStats: Record<string, { queued: number; active: number; maxConcurrent: number }> = {};
  let urgentTotal = 0;
  let normalTotal = 0;
  let backgroundTotal = 0;

  for (const [name, state] of lanes) {
    laneStats[name] = {
      queued: getTotalQueued(state),
      active: state.active,
      maxConcurrent: state.maxConcurrent,
    };
    urgentTotal += state.buckets[TaskPriority.Urgent]?.length ?? 0;
    normalTotal += state.buckets[TaskPriority.Normal]?.length ?? 0;
    backgroundTotal += state.buckets[TaskPriority.Background]?.length ?? 0;
  }

  // Also count session queues
  for (const state of sessionLanes.values()) {
    for (const entry of state.queue) {
      switch (entry.priority) {
        case TaskPriority.Urgent:
          urgentTotal++;
          break;
        case TaskPriority.Normal:
          normalTotal++;
          break;
        case TaskPriority.Background:
          backgroundTotal++;
          break;
      }
    }
  }

  return {
    lanes: laneStats,
    sessions: {
      total: sessionLanes.size,
      active: activeSessionCount,
      maxConcurrent: maxConcurrentSessions,
    },
    byPriority: {
      urgent: urgentTotal,
      normal: normalTotal,
      background: backgroundTotal,
    },
  };
}
