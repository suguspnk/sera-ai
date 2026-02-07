/**
 * Runtime Optimizations
 * 
 * This module exports all optimization utilities and provides
 * a single initialization function for gateway startup.
 */

// Priority Queue & Session Isolation
export {
  enqueueCommandInLane,
  enqueueSessionTask,
  enqueueCommand,
  setCommandLaneConcurrency,
  setMaxConcurrentSessions,
  getQueueSize,
  getSessionQueueSize,
  getTotalQueueSize,
  getTotalSessionQueueSize,
  getActiveSessionCount,
  getQueueStats,
  clearCommandLane,
  clearSessionLane,
  type EnqueueOptions,
  type SessionEnqueueOptions,
} from "../process/command-queue.js";

export { CommandLane, TaskPriority, resolvePriority } from "../process/lanes.js";

// Eager Auth Resolution
export {
  preloadAuth,
  preloadAuthBatch,
  warmAuthCache,
  findAvailableAuth,
  invalidateAuth,
  clearAuthCache,
  getAuthCacheStats,
  type PreloadAuthParams,
} from "../agents/auth-preload.js";

// Request Coalescing
export {
  coalesceMessage,
  combineMessages,
  configureCoalescing,
  flushCoalesceWindow,
  hasActiveWindow,
  getPendingCount,
  getCoalesceStats,
  clearAllWindows,
  type CoalesceMessage,
  type CoalesceConfig,
} from "../agents/request-coalescing.js";

// Unified Timer Manager
export {
  timers,
  managedSetTimeout,
  managedSetInterval,
  clearManagedTimer,
  clearManagedTimeout,
  clearManagedInterval,
  clearAllTimers,
  clearTimersByLabel,
  listActiveTimers,
  getTimerStats,
  registerTimerShutdownHandler,
} from "./timer-manager.js";

// Event-Driven Subagent
export {
  registerSubagentRun,
  waitForSubagentRun,
  getSubagentRun,
  getActiveSubagentRuns,
  listSubagentRunsForRequester,
  releaseSubagentRun,
  initSubagentRegistry,
} from "../agents/subagent-registry.js";

import type { OpenClawConfig } from "../config/config.js";
import { warmAuthCache } from "../agents/auth-preload.js";
import { configureCoalescing } from "../agents/request-coalescing.js";
import { registerTimerShutdownHandler } from "./timer-manager.js";
import { initSubagentRegistry } from "../agents/subagent-registry.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("optimizations");

export type OptimizationsConfig = {
  /** Enable auth cache warming on startup */
  warmAuthCache?: boolean;
  /** Request coalescing window in milliseconds */
  coalesceWindowMs?: number;
  /** Maximum messages to coalesce */
  coalesceMaxMessages?: number;
  /** Enable request coalescing */
  coalesceEnabled?: boolean;
  /** Register timer cleanup on shutdown */
  registerTimerCleanup?: boolean;
};

/**
 * Initialize all runtime optimizations.
 * Call this at gateway startup.
 */
export async function initializeOptimizations(
  cfg: OpenClawConfig,
  opts: OptimizationsConfig = {},
): Promise<void> {
  const startTime = Date.now();
  log.info("initializing runtime optimizations");

  // 1. Initialize subagent registry (event-driven completion)
  initSubagentRegistry();

  // 2. Configure request coalescing
  const coalesceConfig = cfg.agents?.defaults?.coalesce;
  configureCoalescing({
    enabled: opts.coalesceEnabled ?? coalesceConfig?.enabled ?? true,
    windowMs: opts.coalesceWindowMs ?? coalesceConfig?.windowMs ?? 1500,
    maxMessages: opts.coalesceMaxMessages ?? coalesceConfig?.maxMessages ?? 10,
  });

  // 3. Warm auth cache
  if (opts.warmAuthCache ?? true) {
    try {
      await warmAuthCache(cfg);
    } catch (err) {
      log.warn(`auth cache warming failed: ${err}`);
    }
  }

  // 4. Register timer cleanup
  if (opts.registerTimerCleanup ?? true) {
    registerTimerShutdownHandler();
  }

  log.info(`optimizations initialized in ${Date.now() - startTime}ms`);
}

/**
 * Get combined statistics for all optimizations.
 */
export function getOptimizationStats(): {
  queue: ReturnType<typeof import("../process/command-queue.js").getQueueStats>;
  authCache: ReturnType<typeof import("../agents/auth-preload.js").getAuthCacheStats>;
  coalesce: ReturnType<typeof import("../agents/request-coalescing.js").getCoalesceStats>;
  timers: ReturnType<typeof import("./timer-manager.js").getTimerStats>;
} {
  const { getQueueStats } = require("../process/command-queue.js");
  const { getAuthCacheStats } = require("../agents/auth-preload.js");
  const { getCoalesceStats } = require("../agents/request-coalescing.js");
  const { getTimerStats } = require("./timer-manager.js");

  return {
    queue: getQueueStats(),
    authCache: getAuthCacheStats(),
    coalesce: getCoalesceStats(),
    timers: getTimerStats(),
  };
}
