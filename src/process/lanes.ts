export const enum CommandLane {
  Main = "main",
  Cron = "cron",
  Subagent = "subagent",
  Nested = "nested",
}

/**
 * Priority levels for task scheduling.
 * Lower number = higher priority (processed first).
 */
export const enum TaskPriority {
  /** Direct mentions, replies, urgent user requests */
  Urgent = 0,
  /** Regular messages and interactions */
  Normal = 1,
  /** Heartbeats, cron jobs, background cleanup */
  Background = 2,
}

/**
 * Resolve priority from context hints.
 */
export function resolvePriority(hints?: {
  isHeartbeat?: boolean;
  isCron?: boolean;
  isSubagent?: boolean;
  isMention?: boolean;
  isReply?: boolean;
  priority?: TaskPriority;
}): TaskPriority {
  if (hints?.priority !== undefined) {
    return hints.priority;
  }
  if (hints?.isMention || hints?.isReply) {
    return TaskPriority.Urgent;
  }
  if (hints?.isHeartbeat || hints?.isCron) {
    return TaskPriority.Background;
  }
  if (hints?.isSubagent) {
    return TaskPriority.Normal;
  }
  return TaskPriority.Normal;
}
