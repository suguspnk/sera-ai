# Event-Driven Subagent Completion

This document describes the event-driven subagent completion system.

## Overview

Subagent completion is now fully event-driven, removing the need for polling. When a subagent completes, the parent session is notified immediately.

## How It Works

### 1. Agent Lifecycle Events

All agent runs emit lifecycle events via `emitAgentEvent()`:

```typescript
// When run starts
emitAgentEvent({
  runId: "run-123",
  stream: "lifecycle",
  data: { phase: "start", startedAt: Date.now() }
});

// When run ends
emitAgentEvent({
  runId: "run-123",
  stream: "lifecycle",
  data: { phase: "end", endedAt: Date.now() }
});

// On error
emitAgentEvent({
  runId: "run-123",
  stream: "lifecycle",
  data: { phase: "error", error: "...", endedAt: Date.now() }
});
```

### 2. Subagent Registry Listener

The subagent registry listens for lifecycle events and reacts immediately:

```typescript
onAgentEvent((evt) => {
  if (evt.stream !== "lifecycle") return;
  
  const entry = subagentRuns.get(evt.runId);
  if (!entry) return;
  
  if (evt.data.phase === "end" || evt.data.phase === "error") {
    // Update record
    entry.endedAt = evt.data.endedAt;
    entry.outcome = { status: evt.data.phase === "error" ? "error" : "ok" };
    
    // Notify waiters immediately
    notifyCompletionWaiters(entry);
    
    // Emit event to parent session
    emitSubagentCompletionEvent(entry);
    
    // Start announce flow
    runSubagentAnnounceFlow(entry);
  }
});
```

### 3. Parent Session Notification

When a subagent completes, a `subagent_complete` event is emitted to the parent session:

```typescript
emitAgentEvent({
  runId: entry.runId,
  stream: "lifecycle",
  sessionKey: entry.requesterSessionKey, // Parent session
  data: {
    phase: "subagent_complete",
    childSessionKey: entry.childSessionKey,
    childRunId: entry.runId,
    outcome: entry.outcome,
    startedAt: entry.startedAt,
    endedAt: entry.endedAt,
    task: entry.task,
  },
});
```

## API

### Wait for Subagent Completion

```typescript
import { waitForSubagentRun } from "./agents/subagent-registry.js";

// Wait up to 30 seconds for completion
const result = await waitForSubagentRun("run-123", 30_000);

if (result) {
  console.log("Completed:", result.outcome);
} else {
  console.log("Timeout waiting for subagent");
}
```

### Get Active Subagent Runs

```typescript
import { getActiveSubagentRuns } from "./agents/subagent-registry.js";

// Get all subagents that haven't completed yet
const active = getActiveSubagentRuns("agent:main:main");
console.log(`${active.length} subagents still running`);
```

## Smart Sweeper

The archive sweeper now uses precise scheduling instead of fixed intervals:

### Before (Polling)
```typescript
// Ran every 60 seconds regardless of need
sweeper = setInterval(() => sweepSubagentRuns(), 60_000);
```

### After (Event-Driven)
```typescript
// Schedules at exactly the right time
function scheduleSweepIfNeeded() {
  const earliestArchiveAt = findEarliestArchiveTime();
  if (!earliestArchiveAt) return; // Nothing to sweep
  
  const delayMs = earliestArchiveAt - Date.now();
  sweepTimer = setTimeout(() => sweepSubagentRuns(), delayMs);
}
```

## Benefits

1. **Immediate Response** - Parent sessions are notified instantly when subagents complete
2. **No Polling** - Completion detection is purely event-driven
3. **Efficient Cleanup** - Sweeper only runs when needed, at exactly the right time
4. **Multiple Waiters** - Many callers can wait for the same subagent
5. **Resilient** - Persistence ensures completion handling survives restarts

## Migration

The changes are backward compatible. The `agent.wait` gateway method still works, now backed by the same event-driven infrastructure.

Existing code using `callGateway({ method: "agent.wait", ... })` will continue to work but will benefit from the improved responsiveness.
