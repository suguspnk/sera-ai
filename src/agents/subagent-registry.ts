import { loadConfig } from "../config/config.js";
import { callGateway } from "../gateway/call.js";
import { onAgentEvent, emitAgentEvent } from "../infra/agent-events.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { type DeliveryContext, normalizeDeliveryContext } from "../utils/delivery-context.js";
import { runSubagentAnnounceFlow, type SubagentRunOutcome } from "./subagent-announce.js";
import {
  loadSubagentRegistryFromDisk,
  saveSubagentRegistryToDisk,
} from "./subagent-registry.store.js";
import { resolveAgentTimeoutMs } from "./timeout.js";

const log = createSubsystemLogger("subagent");

export type SubagentRunRecord = {
  runId: string;
  childSessionKey: string;
  requesterSessionKey: string;
  requesterOrigin?: DeliveryContext;
  requesterDisplayKey: string;
  task: string;
  cleanup: "delete" | "keep";
  label?: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  outcome?: SubagentRunOutcome;
  archiveAtMs?: number;
  cleanupCompletedAt?: number;
  cleanupHandled?: boolean;
};

const subagentRuns = new Map<string, SubagentRunRecord>();
let sweepTimer: NodeJS.Timeout | null = null;
let listenerStarted = false;
let listenerStop: (() => void) | null = null;
// Use var to avoid TDZ when init runs across circular imports during bootstrap.
var restoreAttempted = false;
const SUBAGENT_ANNOUNCE_TIMEOUT_MS = 120_000;

// Track pending completion waiters for immediate notification
const completionWaiters = new Map<string, Set<(record: SubagentRunRecord) => void>>();

function persistSubagentRuns() {
  try {
    saveSubagentRegistryToDisk(subagentRuns);
  } catch {
    // ignore persistence failures
  }
}

const resumedRuns = new Set<string>();

function resumeSubagentRun(runId: string) {
  if (!runId || resumedRuns.has(runId)) {
    return;
  }
  const entry = subagentRuns.get(runId);
  if (!entry) {
    return;
  }
  if (entry.cleanupCompletedAt) {
    return;
  }

  if (typeof entry.endedAt === "number" && entry.endedAt > 0) {
    if (!beginSubagentCleanup(runId)) {
      return;
    }
    const requesterOrigin = normalizeDeliveryContext(entry.requesterOrigin);
    void runSubagentAnnounceFlow({
      childSessionKey: entry.childSessionKey,
      childRunId: entry.runId,
      requesterSessionKey: entry.requesterSessionKey,
      requesterOrigin,
      requesterDisplayKey: entry.requesterDisplayKey,
      task: entry.task,
      timeoutMs: SUBAGENT_ANNOUNCE_TIMEOUT_MS,
      cleanup: entry.cleanup,
      waitForCompletion: false,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      label: entry.label,
      outcome: entry.outcome,
    }).then((didAnnounce) => {
      finalizeSubagentCleanup(runId, entry.cleanup, didAnnounce);
    });
    resumedRuns.add(runId);
    return;
  }

  // For runs that haven't completed, just ensure the listener is active.
  // The event-driven listener will handle completion.
  ensureListener();
  resumedRuns.add(runId);
}

function restoreSubagentRunsOnce() {
  if (restoreAttempted) {
    return;
  }
  restoreAttempted = true;
  try {
    const restored = loadSubagentRegistryFromDisk();
    if (restored.size === 0) {
      return;
    }
    for (const [runId, entry] of restored.entries()) {
      if (!runId || !entry) {
        continue;
      }
      // Keep any newer in-memory entries.
      if (!subagentRuns.has(runId)) {
        subagentRuns.set(runId, entry);
      }
    }

    // Resume pending work.
    ensureListener();
    scheduleSweepIfNeeded();
    for (const runId of subagentRuns.keys()) {
      resumeSubagentRun(runId);
    }
  } catch {
    // ignore restore failures
  }
}

function resolveArchiveAfterMs(cfg?: ReturnType<typeof loadConfig>) {
  const config = cfg ?? loadConfig();
  const minutes = config.agents?.defaults?.subagents?.archiveAfterMinutes ?? 60;
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return undefined;
  }
  return Math.max(1, Math.floor(minutes)) * 60_000;
}

function resolveSubagentWaitTimeoutMs(
  cfg: ReturnType<typeof loadConfig>,
  runTimeoutSeconds?: number,
) {
  return resolveAgentTimeoutMs({ cfg, overrideSeconds: runTimeoutSeconds });
}

/**
 * Schedule a sweep at the earliest archive time.
 * This replaces the fixed 60-second interval with precise scheduling.
 */
function scheduleSweepIfNeeded() {
  // Cancel any existing timer
  if (sweepTimer) {
    clearTimeout(sweepTimer);
    sweepTimer = null;
  }

  // Find the earliest archive time
  let earliestArchiveAt: number | undefined;
  for (const entry of subagentRuns.values()) {
    if (entry.archiveAtMs && (!earliestArchiveAt || entry.archiveAtMs < earliestArchiveAt)) {
      earliestArchiveAt = entry.archiveAtMs;
    }
  }

  if (!earliestArchiveAt) {
    return; // No items to archive
  }

  const now = Date.now();
  const delayMs = Math.max(1000, earliestArchiveAt - now); // At least 1 second

  log.debug(`scheduling sweep in ${Math.round(delayMs / 1000)}s for ${subagentRuns.size} runs`);

  sweepTimer = setTimeout(() => {
    sweepTimer = null;
    void sweepSubagentRuns();
  }, delayMs);
  sweepTimer.unref?.();
}

function stopSweeper() {
  if (sweepTimer) {
    clearTimeout(sweepTimer);
    sweepTimer = null;
  }
}

async function sweepSubagentRuns() {
  const now = Date.now();
  let mutated = false;
  const toDelete: string[] = [];

  for (const [runId, entry] of subagentRuns.entries()) {
    if (!entry.archiveAtMs || entry.archiveAtMs > now) {
      continue;
    }
    toDelete.push(runId);
  }

  for (const runId of toDelete) {
    const entry = subagentRuns.get(runId);
    subagentRuns.delete(runId);
    mutated = true;

    if (entry) {
      log.debug(`archived subagent run: ${runId} session=${entry.childSessionKey}`);
      try {
        await callGateway({
          method: "sessions.delete",
          params: { key: entry.childSessionKey, deleteTranscript: true },
          timeoutMs: 10_000,
        });
      } catch {
        // ignore
      }
    }
  }

  if (mutated) {
    persistSubagentRuns();
  }

  // Schedule next sweep if there are more items
  scheduleSweepIfNeeded();
}

/**
 * Notify completion waiters immediately when a subagent completes.
 */
function notifyCompletionWaiters(runId: string, record: SubagentRunRecord) {
  const waiters = completionWaiters.get(runId);
  if (!waiters || waiters.size === 0) {
    return;
  }

  for (const waiter of waiters) {
    try {
      waiter(record);
    } catch {
      // ignore callback errors
    }
  }

  completionWaiters.delete(runId);
}

/**
 * Emit a subagent completion event to the parent session.
 * This allows the parent to react immediately without polling.
 */
function emitSubagentCompletionEvent(record: SubagentRunRecord) {
  emitAgentEvent({
    runId: record.runId,
    stream: "lifecycle",
    sessionKey: record.requesterSessionKey,
    data: {
      phase: "subagent_complete",
      childSessionKey: record.childSessionKey,
      childRunId: record.runId,
      outcome: record.outcome,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      task: record.task,
      label: record.label,
    },
  });
}

function ensureListener() {
  if (listenerStarted) {
    return;
  }
  listenerStarted = true;
  listenerStop = onAgentEvent((evt) => {
    if (!evt || evt.stream !== "lifecycle") {
      return;
    }
    const entry = subagentRuns.get(evt.runId);
    if (!entry) {
      return;
    }
    const phase = evt.data?.phase;
    if (phase === "start") {
      const startedAt = typeof evt.data?.startedAt === "number" ? evt.data.startedAt : undefined;
      if (startedAt) {
        entry.startedAt = startedAt;
        persistSubagentRuns();
      }
      log.debug(`subagent started: ${evt.runId} session=${entry.childSessionKey}`);
      return;
    }
    if (phase !== "end" && phase !== "error") {
      return;
    }

    const endedAt = typeof evt.data?.endedAt === "number" ? evt.data.endedAt : Date.now();
    entry.endedAt = endedAt;
    if (phase === "error") {
      const error = typeof evt.data?.error === "string" ? evt.data.error : undefined;
      entry.outcome = { status: "error", error };
    } else if (evt.data?.aborted) {
      entry.outcome = { status: "timeout" };
    } else {
      entry.outcome = { status: "ok" };
    }
    persistSubagentRuns();

    log.debug(`subagent completed: ${evt.runId} status=${entry.outcome?.status} duration=${endedAt - (entry.startedAt ?? entry.createdAt)}ms`);

    // Notify completion waiters immediately
    notifyCompletionWaiters(evt.runId, entry);

    // Emit event to parent session for immediate reaction
    emitSubagentCompletionEvent(entry);

    if (!beginSubagentCleanup(evt.runId)) {
      return;
    }
    const requesterOrigin = normalizeDeliveryContext(entry.requesterOrigin);
    void runSubagentAnnounceFlow({
      childSessionKey: entry.childSessionKey,
      childRunId: entry.runId,
      requesterSessionKey: entry.requesterSessionKey,
      requesterOrigin,
      requesterDisplayKey: entry.requesterDisplayKey,
      task: entry.task,
      timeoutMs: SUBAGENT_ANNOUNCE_TIMEOUT_MS,
      cleanup: entry.cleanup,
      waitForCompletion: false,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      label: entry.label,
      outcome: entry.outcome,
    }).then((didAnnounce) => {
      finalizeSubagentCleanup(evt.runId, entry.cleanup, didAnnounce);
    });
  });
}

function finalizeSubagentCleanup(runId: string, cleanup: "delete" | "keep", didAnnounce: boolean) {
  const entry = subagentRuns.get(runId);
  if (!entry) {
    return;
  }
  if (!didAnnounce) {
    // Allow retry on the next wake if announce was deferred or failed.
    entry.cleanupHandled = false;
    persistSubagentRuns();
    return;
  }
  if (cleanup === "delete") {
    subagentRuns.delete(runId);
    persistSubagentRuns();
    return;
  }
  entry.cleanupCompletedAt = Date.now();
  persistSubagentRuns();
}

function beginSubagentCleanup(runId: string) {
  const entry = subagentRuns.get(runId);
  if (!entry) {
    return false;
  }
  if (entry.cleanupCompletedAt) {
    return false;
  }
  if (entry.cleanupHandled) {
    return false;
  }
  entry.cleanupHandled = true;
  persistSubagentRuns();
  return true;
}

export function registerSubagentRun(params: {
  runId: string;
  childSessionKey: string;
  requesterSessionKey: string;
  requesterOrigin?: DeliveryContext;
  requesterDisplayKey: string;
  task: string;
  cleanup: "delete" | "keep";
  label?: string;
  runTimeoutSeconds?: number;
}) {
  const now = Date.now();
  const cfg = loadConfig();
  const archiveAfterMs = resolveArchiveAfterMs(cfg);
  const archiveAtMs = archiveAfterMs ? now + archiveAfterMs : undefined;
  const requesterOrigin = normalizeDeliveryContext(params.requesterOrigin);

  subagentRuns.set(params.runId, {
    runId: params.runId,
    childSessionKey: params.childSessionKey,
    requesterSessionKey: params.requesterSessionKey,
    requesterOrigin,
    requesterDisplayKey: params.requesterDisplayKey,
    task: params.task,
    cleanup: params.cleanup,
    label: params.label,
    createdAt: now,
    startedAt: now,
    archiveAtMs,
    cleanupHandled: false,
  });

  ensureListener();
  persistSubagentRuns();

  if (archiveAfterMs) {
    scheduleSweepIfNeeded();
  }

  log.debug(`subagent registered: ${params.runId} child=${params.childSessionKey} parent=${params.requesterSessionKey}`);
}

/**
 * Wait for a subagent to complete.
 * Uses event-driven notification for immediate response.
 *
 * @returns The completed record, or null if timeout
 */
export function waitForSubagentRun(
  runId: string,
  timeoutMs: number,
): Promise<SubagentRunRecord | null> {
  const entry = subagentRuns.get(runId);

  // Already completed
  if (entry?.endedAt) {
    return Promise.resolve(entry);
  }

  // Not found
  if (!entry) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    let settled = false;

    const finish = (record: SubagentRunRecord | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      // Remove from waiters
      const waiters = completionWaiters.get(runId);
      if (waiters) {
        waiters.delete(callback);
        if (waiters.size === 0) {
          completionWaiters.delete(runId);
        }
      }

      resolve(record);
    };

    const callback = (record: SubagentRunRecord) => {
      finish(record);
    };

    // Register waiter
    let waiters = completionWaiters.get(runId);
    if (!waiters) {
      waiters = new Set();
      completionWaiters.set(runId, waiters);
    }
    waiters.add(callback);

    // Timeout
    const timer = setTimeout(() => finish(null), Math.max(1, timeoutMs));
  });
}

/**
 * Get all active (non-completed) subagent runs for a requester.
 */
export function getActiveSubagentRuns(requesterSessionKey: string): SubagentRunRecord[] {
  const key = requesterSessionKey.trim();
  if (!key) {
    return [];
  }
  return [...subagentRuns.values()].filter(
    (entry) => entry.requesterSessionKey === key && !entry.endedAt
  );
}

/**
 * Get a subagent run by ID.
 */
export function getSubagentRun(runId: string): SubagentRunRecord | undefined {
  return subagentRuns.get(runId);
}

export function resetSubagentRegistryForTests() {
  subagentRuns.clear();
  resumedRuns.clear();
  completionWaiters.clear();
  stopSweeper();
  restoreAttempted = false;
  if (listenerStop) {
    listenerStop();
    listenerStop = null;
  }
  listenerStarted = false;
  persistSubagentRuns();
}

export function addSubagentRunForTests(entry: SubagentRunRecord) {
  subagentRuns.set(entry.runId, entry);
  persistSubagentRuns();
}

export function releaseSubagentRun(runId: string) {
  const didDelete = subagentRuns.delete(runId);
  if (didDelete) {
    persistSubagentRuns();
  }
  if (subagentRuns.size === 0) {
    stopSweeper();
  }
}

export function listSubagentRunsForRequester(requesterSessionKey: string): SubagentRunRecord[] {
  const key = requesterSessionKey.trim();
  if (!key) {
    return [];
  }
  return [...subagentRuns.values()].filter((entry) => entry.requesterSessionKey === key);
}

export function initSubagentRegistry() {
  restoreSubagentRunsOnce();
}
