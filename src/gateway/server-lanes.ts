import type { loadConfig } from "../config/config.js";
import { resolveAgentMaxConcurrent, resolveSubagentMaxConcurrent } from "../config/agent-limits.js";
import { setCommandLaneConcurrency, setMaxConcurrentSessions } from "../process/command-queue.js";
import { CommandLane } from "../process/lanes.js";

/** Default max concurrent sessions when not configured */
const DEFAULT_MAX_CONCURRENT_SESSIONS = 16;

/**
 * Resolve max concurrent sessions from config.
 * This controls how many different sessions can have active tasks simultaneously.
 */
export function resolveMaxConcurrentSessions(cfg?: ReturnType<typeof loadConfig>): number {
  const raw = cfg?.agents?.defaults?.maxConcurrentSessions;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(1, Math.floor(raw));
  }
  return DEFAULT_MAX_CONCURRENT_SESSIONS;
}

export function applyGatewayLaneConcurrency(cfg: ReturnType<typeof loadConfig>) {
  // Configure lane concurrency
  setCommandLaneConcurrency(CommandLane.Cron, cfg.cron?.maxConcurrentRuns ?? 1);
  setCommandLaneConcurrency(CommandLane.Main, resolveAgentMaxConcurrent(cfg));
  setCommandLaneConcurrency(CommandLane.Subagent, resolveSubagentMaxConcurrent(cfg));
  
  // Configure session concurrency (new!)
  // This limits how many different sessions can be active at once
  setMaxConcurrentSessions(resolveMaxConcurrentSessions(cfg));
}
