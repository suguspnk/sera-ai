import { CommandLane, TaskPriority, resolvePriority } from "../../process/lanes.js";

export { TaskPriority, resolvePriority } from "../../process/lanes.js";

export function resolveSessionLane(key: string) {
  const cleaned = key.trim() || CommandLane.Main;
  return cleaned.startsWith("session:") ? cleaned : `session:${cleaned}`;
}

export function resolveGlobalLane(lane?: string) {
  const cleaned = lane?.trim();
  return cleaned ? cleaned : CommandLane.Main;
}

export function resolveEmbeddedSessionLane(key: string) {
  return resolveSessionLane(key);
}

/**
 * Resolve task priority from run context.
 */
export function resolveRunPriority(params: {
  isHeartbeat?: boolean;
  isCron?: boolean;
  isSubagent?: boolean;
  isMention?: boolean;
  isReply?: boolean;
  isUrgent?: boolean;
  priority?: TaskPriority;
}): TaskPriority {
  // Explicit priority always wins
  if (params.priority !== undefined) {
    return params.priority;
  }
  
  // Urgent flag (e.g., from channel hint)
  if (params.isUrgent) {
    return TaskPriority.Urgent;
  }
  
  // Mentions and replies are urgent
  if (params.isMention || params.isReply) {
    return TaskPriority.Urgent;
  }
  
  // Heartbeats and cron are background
  if (params.isHeartbeat || params.isCron) {
    return TaskPriority.Background;
  }
  
  // Subagents are normal priority
  if (params.isSubagent) {
    return TaskPriority.Normal;
  }
  
  return TaskPriority.Normal;
}
