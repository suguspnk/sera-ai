import { describe, expect, it, beforeEach, vi } from "vitest";
import { emitAgentEvent } from "../infra/agent-events.js";
import {
  registerSubagentRun,
  waitForSubagentRun,
  getSubagentRun,
  getActiveSubagentRuns,
  resetSubagentRegistryForTests,
} from "./subagent-registry.js";

describe("subagent-registry event-driven completion", () => {
  beforeEach(() => {
    resetSubagentRegistryForTests();
  });

  it("registers and tracks subagent runs", () => {
    registerSubagentRun({
      runId: "run-1",
      childSessionKey: "agent:main:subagent:child-1",
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      task: "Test task",
      cleanup: "keep",
    });

    const run = getSubagentRun("run-1");
    expect(run).toBeDefined();
    expect(run?.childSessionKey).toBe("agent:main:subagent:child-1");
    expect(run?.task).toBe("Test task");
    expect(run?.endedAt).toBeUndefined();
  });

  it("returns active runs that have not completed", () => {
    registerSubagentRun({
      runId: "run-1",
      childSessionKey: "agent:main:subagent:child-1",
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      task: "Active task",
      cleanup: "keep",
    });

    const active = getActiveSubagentRuns("agent:main:main");
    expect(active.length).toBe(1);
    expect(active[0].runId).toBe("run-1");
  });

  it("waitForSubagentRun resolves immediately if already completed", async () => {
    registerSubagentRun({
      runId: "run-1",
      childSessionKey: "agent:main:subagent:child-1",
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      task: "Test task",
      cleanup: "keep",
    });

    // Simulate completion via agent event
    emitAgentEvent({
      runId: "run-1",
      stream: "lifecycle",
      data: {
        phase: "end",
        endedAt: Date.now(),
      },
    });

    // Should resolve immediately
    const result = await waitForSubagentRun("run-1", 1000);
    expect(result).toBeDefined();
    expect(result?.outcome?.status).toBe("ok");
  });

  it("waitForSubagentRun resolves when completion event arrives", async () => {
    registerSubagentRun({
      runId: "run-2",
      childSessionKey: "agent:main:subagent:child-2",
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      task: "Async task",
      cleanup: "keep",
    });

    // Start waiting
    const waitPromise = waitForSubagentRun("run-2", 5000);

    // Emit completion after a delay
    setTimeout(() => {
      emitAgentEvent({
        runId: "run-2",
        stream: "lifecycle",
        data: {
          phase: "end",
          endedAt: Date.now(),
        },
      });
    }, 50);

    const result = await waitPromise;
    expect(result).toBeDefined();
    expect(result?.runId).toBe("run-2");
    expect(result?.outcome?.status).toBe("ok");
  });

  it("waitForSubagentRun returns null on timeout", async () => {
    registerSubagentRun({
      runId: "run-3",
      childSessionKey: "agent:main:subagent:child-3",
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      task: "Slow task",
      cleanup: "keep",
    });

    // Wait with short timeout, no completion event
    const result = await waitForSubagentRun("run-3", 50);
    expect(result).toBeNull();
  });

  it("handles error completion status", async () => {
    registerSubagentRun({
      runId: "run-4",
      childSessionKey: "agent:main:subagent:child-4",
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      task: "Error task",
      cleanup: "keep",
    });

    // Simulate error completion
    emitAgentEvent({
      runId: "run-4",
      stream: "lifecycle",
      data: {
        phase: "error",
        error: "Task failed",
        endedAt: Date.now(),
      },
    });

    const result = await waitForSubagentRun("run-4", 1000);
    expect(result).toBeDefined();
    expect(result?.outcome?.status).toBe("error");
    expect(result?.outcome?.error).toBe("Task failed");
  });

  it("completed runs are no longer in active list", async () => {
    registerSubagentRun({
      runId: "run-5",
      childSessionKey: "agent:main:subagent:child-5",
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      task: "Complete me",
      cleanup: "keep",
    });

    expect(getActiveSubagentRuns("agent:main:main").length).toBe(1);

    // Complete the run
    emitAgentEvent({
      runId: "run-5",
      stream: "lifecycle",
      data: {
        phase: "end",
        endedAt: Date.now(),
      },
    });

    // Give time for event to process
    await new Promise((r) => setTimeout(r, 10));

    // Should no longer be in active list
    expect(getActiveSubagentRuns("agent:main:main").length).toBe(0);
  });

  it("multiple waiters are all notified on completion", async () => {
    registerSubagentRun({
      runId: "run-6",
      childSessionKey: "agent:main:subagent:child-6",
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      task: "Multi-wait task",
      cleanup: "keep",
    });

    // Multiple waiters
    const waiter1 = waitForSubagentRun("run-6", 5000);
    const waiter2 = waitForSubagentRun("run-6", 5000);
    const waiter3 = waitForSubagentRun("run-6", 5000);

    // Complete
    setTimeout(() => {
      emitAgentEvent({
        runId: "run-6",
        stream: "lifecycle",
        data: {
          phase: "end",
          endedAt: Date.now(),
        },
      });
    }, 20);

    const results = await Promise.all([waiter1, waiter2, waiter3]);
    
    expect(results[0]).toBeDefined();
    expect(results[1]).toBeDefined();
    expect(results[2]).toBeDefined();
    expect(results[0]?.runId).toBe("run-6");
  });
});
