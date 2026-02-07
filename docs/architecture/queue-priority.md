# Priority Queue & Session Isolation

This document describes the enhanced task scheduling system with priority levels and per-session isolation.

## Overview

The task queue has been enhanced with two key features:

1. **Priority Scheduling** - Tasks can be marked as Urgent, Normal, or Background priority
2. **Per-Session Isolation** - Different sessions can run in parallel without blocking each other

## Priority Levels

```typescript
enum TaskPriority {
  Urgent = 0,     // Direct mentions, replies, urgent user requests
  Normal = 1,     // Regular messages and interactions
  Background = 2, // Heartbeats, cron jobs, background cleanup
}
```

Higher priority tasks (lower number) are processed before lower priority tasks in the queue.

### Automatic Priority Resolution

Priority is automatically resolved from context hints:

| Hint | Priority |
|------|----------|
| `isMention: true` | Urgent |
| `isReply: true` | Urgent |
| `isHeartbeat: true` | Background |
| `isCron: true` | Background |
| `isSubagent: true` | Normal |
| Default | Normal |

You can also set an explicit `priority` to override automatic resolution.

## Session Isolation

Previously, all tasks competed for a limited number of slots in each lane. This meant one busy session could block others.

Now, **each session gets its own serialized queue**, but **different sessions can run in parallel**.

### How It Works

1. Each unique `sessionKey` gets its own task queue
2. Tasks within a session are processed in priority order, one at a time
3. Multiple sessions can have active tasks simultaneously (up to `maxConcurrentSessions`)

### Configuration

```yaml
# config.yaml
agents:
  defaults:
    maxConcurrentSessions: 16  # How many sessions can be active at once
```

### Benefits

- **Fairness**: A slow session doesn't block other users
- **Responsiveness**: Urgent messages in one session don't wait for background tasks in another
- **Scalability**: System can handle more concurrent users

## API

### Enqueue with Priority

```typescript
import { enqueueCommandInLane, TaskPriority } from "./process/command-queue.js";

// Enqueue an urgent task in the main lane
await enqueueCommandInLane(CommandLane.Main, async () => {
  // urgent work
}, { priority: TaskPriority.Urgent });
```

### Enqueue Session Task

```typescript
import { enqueueSessionTask, TaskPriority } from "./process/command-queue.js";

// Enqueue a task for a specific session
await enqueueSessionTask(async () => {
  // session-specific work
}, {
  sessionKey: "discord:guild:123",
  priority: TaskPriority.Normal,
});
```

### Queue Statistics

```typescript
import { getQueueStats } from "./process/command-queue.js";

const stats = getQueueStats();
// {
//   lanes: { main: { queued: 5, active: 2, maxConcurrent: 4 } },
//   sessions: { total: 10, active: 3, maxConcurrent: 16 },
//   byPriority: { urgent: 2, normal: 8, background: 5 }
// }
```

## Integration

### Agent Runner

The agent runner automatically uses session-based queuing with priority:

```typescript
// In auto-reply handler
await runEmbeddedPiAgent({
  sessionKey: "discord:guild:123",
  isMention: true,  // → TaskPriority.Urgent
  // ...
});

// Heartbeat run
await runEmbeddedPiAgent({
  sessionKey: "main",
  isHeartbeat: true,  // → TaskPriority.Background
  // ...
});
```

### Migration

Existing code continues to work - the changes are backward compatible:

- `enqueueCommandInLane` without priority defaults to `Normal`
- `enqueueCommand` works as before
- Lanes (Main, Cron, Subagent) still function with their configured concurrency

## Monitoring

Use the queue stats API or the gateway health endpoint to monitor:

- Queue depths by priority
- Active session count
- Lane utilization

## Best Practices

1. **Set hints correctly** - Pass `isMention`, `isReply`, etc. to get correct priority
2. **Don't abuse Urgent** - Reserve for truly time-sensitive interactions
3. **Configure limits** - Adjust `maxConcurrentSessions` based on your workload
4. **Monitor stats** - Watch for queue buildup in production
