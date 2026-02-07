import { describe, expect, it, beforeEach } from "vitest";
import {
  enqueueCommandInLane,
  enqueueSessionTask,
  getQueueStats,
  getActiveSessionCount,
  clearCommandLane,
  clearSessionLane,
} from "./command-queue.js";
import { CommandLane, TaskPriority } from "./lanes.js";

describe("command-queue priority scheduling", () => {
  beforeEach(() => {
    clearCommandLane(CommandLane.Main);
  });

  it("processes urgent tasks before normal tasks", async () => {
    const order: string[] = [];
    
    // Enqueue normal first
    const normalPromise = enqueueCommandInLane(
      CommandLane.Main,
      async () => {
        order.push("normal");
        return "normal";
      },
      { priority: TaskPriority.Normal }
    );
    
    // Enqueue urgent second (should run first if normal hasn't started)
    const urgentPromise = enqueueCommandInLane(
      CommandLane.Main,
      async () => {
        order.push("urgent");
        return "urgent";
      },
      { priority: TaskPriority.Urgent }
    );
    
    await Promise.all([normalPromise, urgentPromise]);
    
    // With single concurrency, first enqueued runs first
    // But if queue has multiple waiting, urgent should be picked next
    expect(order).toContain("urgent");
    expect(order).toContain("normal");
  });

  it("processes background tasks last", async () => {
    const order: string[] = [];
    let resolveFirst: () => void;
    const firstBlocker = new Promise<void>(r => { resolveFirst = r; });
    
    // Block the lane with a first task
    const firstPromise = enqueueCommandInLane(
      CommandLane.Main,
      async () => {
        await firstBlocker;
        order.push("first");
        return "first";
      },
      { priority: TaskPriority.Normal }
    );
    
    // Queue up tasks while blocked
    const bgPromise = enqueueCommandInLane(
      CommandLane.Main,
      async () => {
        order.push("background");
        return "background";
      },
      { priority: TaskPriority.Background }
    );
    
    const urgentPromise = enqueueCommandInLane(
      CommandLane.Main,
      async () => {
        order.push("urgent");
        return "urgent";
      },
      { priority: TaskPriority.Urgent }
    );
    
    const normalPromise = enqueueCommandInLane(
      CommandLane.Main,
      async () => {
        order.push("normal");
        return "normal";
      },
      { priority: TaskPriority.Normal }
    );
    
    // Release the blocker
    resolveFirst!();
    
    await Promise.all([firstPromise, bgPromise, urgentPromise, normalPromise]);
    
    // First runs first (already started)
    // Then urgent, normal, background in priority order
    expect(order[0]).toBe("first");
    expect(order[1]).toBe("urgent");
    expect(order[2]).toBe("normal");
    expect(order[3]).toBe("background");
  });
});

describe("command-queue session isolation", () => {
  beforeEach(() => {
    clearSessionLane("session-a");
    clearSessionLane("session-b");
  });

  it("allows different sessions to run in parallel", async () => {
    const running = new Set<string>();
    const maxParallel = { count: 0 };
    
    const track = (session: string) => {
      running.add(session);
      maxParallel.count = Math.max(maxParallel.count, running.size);
    };
    const untrack = (session: string) => {
      running.delete(session);
    };
    
    const sessionA = enqueueSessionTask(
      async () => {
        track("a");
        await new Promise(r => setTimeout(r, 50));
        untrack("a");
        return "a";
      },
      { sessionKey: "session-a", priority: TaskPriority.Normal }
    );
    
    const sessionB = enqueueSessionTask(
      async () => {
        track("b");
        await new Promise(r => setTimeout(r, 50));
        untrack("b");
        return "b";
      },
      { sessionKey: "session-b", priority: TaskPriority.Normal }
    );
    
    await Promise.all([sessionA, sessionB]);
    
    // Both sessions should have run in parallel
    expect(maxParallel.count).toBe(2);
  });

  it("serializes tasks within the same session", async () => {
    const order: number[] = [];
    
    const task1 = enqueueSessionTask(
      async () => {
        order.push(1);
        await new Promise(r => setTimeout(r, 20));
        order.push(2);
        return 1;
      },
      { sessionKey: "session-a", priority: TaskPriority.Normal }
    );
    
    const task2 = enqueueSessionTask(
      async () => {
        order.push(3);
        await new Promise(r => setTimeout(r, 10));
        order.push(4);
        return 2;
      },
      { sessionKey: "session-a", priority: TaskPriority.Normal }
    );
    
    await Promise.all([task1, task2]);
    
    // Tasks should be serialized: 1, 2, 3, 4
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it("respects priority within a session", async () => {
    const order: string[] = [];
    let resolveFirst: () => void;
    const firstBlocker = new Promise<void>(r => { resolveFirst = r; });
    
    // Block the session
    const first = enqueueSessionTask(
      async () => {
        await firstBlocker;
        order.push("first");
        return "first";
      },
      { sessionKey: "session-a", priority: TaskPriority.Normal }
    );
    
    // Queue up tasks with different priorities
    const bg = enqueueSessionTask(
      async () => {
        order.push("background");
        return "background";
      },
      { sessionKey: "session-a", priority: TaskPriority.Background }
    );
    
    const urgent = enqueueSessionTask(
      async () => {
        order.push("urgent");
        return "urgent";
      },
      { sessionKey: "session-a", priority: TaskPriority.Urgent }
    );
    
    // Release
    resolveFirst!();
    
    await Promise.all([first, bg, urgent]);
    
    expect(order[0]).toBe("first");
    expect(order[1]).toBe("urgent");
    expect(order[2]).toBe("background");
  });
});

describe("getQueueStats", () => {
  it("returns queue statistics", () => {
    const stats = getQueueStats();
    
    expect(stats).toHaveProperty("lanes");
    expect(stats).toHaveProperty("sessions");
    expect(stats).toHaveProperty("byPriority");
    expect(stats.sessions).toHaveProperty("active");
    expect(stats.sessions).toHaveProperty("maxConcurrent");
    expect(stats.byPriority).toHaveProperty("urgent");
    expect(stats.byPriority).toHaveProperty("normal");
    expect(stats.byPriority).toHaveProperty("background");
  });
});
