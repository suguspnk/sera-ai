/**
 * Unified Timer Manager
 * 
 * Centralized management of all timers (setTimeout/setInterval) for:
 * - Clean shutdown (cancel all pending timers)
 * - Debugging (list active timers)
 * - Metrics (track timer usage)
 * 
 * Usage:
 *   import { timers } from "./timer-manager.js";
 *   const id = timers.setTimeout(() => { ... }, 1000, "my-timer");
 *   timers.clearTimeout(id);
 */

import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("timers");

type TimerType = "timeout" | "interval";

type TimerEntry = {
  id: string;
  type: TimerType;
  label: string;
  createdAt: number;
  delayMs: number;
  handle: NodeJS.Timeout;
  callback: () => void;
};

let nextId = 1;
const activeTimers = new Map<string, TimerEntry>();

// Metrics
let totalCreated = 0;
let totalFired = 0;
let totalCancelled = 0;

function generateId(label: string): string {
  return `${label}-${nextId++}`;
}

/**
 * Create a managed setTimeout.
 * 
 * @param callback - Function to call when timer fires
 * @param delayMs - Delay in milliseconds
 * @param label - Human-readable label for debugging
 * @returns Timer ID for cancellation
 */
export function managedSetTimeout(
  callback: () => void,
  delayMs: number,
  label: string = "anonymous",
): string {
  const id = generateId(label);
  
  const wrappedCallback = () => {
    activeTimers.delete(id);
    totalFired++;
    
    try {
      callback();
    } catch (err) {
      log.error(`timer callback error: id=${id} label=${label} error=${err}`);
    }
  };
  
  const handle = setTimeout(wrappedCallback, delayMs);
  handle.unref?.(); // Don't keep process alive for this timer
  
  const entry: TimerEntry = {
    id,
    type: "timeout",
    label,
    createdAt: Date.now(),
    delayMs,
    handle,
    callback: wrappedCallback,
  };
  
  activeTimers.set(id, entry);
  totalCreated++;
  
  log.debug(`timeout created: id=${id} label=${label} delayMs=${delayMs}`);
  
  return id;
}

/**
 * Create a managed setInterval.
 * 
 * @param callback - Function to call on each interval
 * @param intervalMs - Interval in milliseconds
 * @param label - Human-readable label for debugging
 * @returns Timer ID for cancellation
 */
export function managedSetInterval(
  callback: () => void,
  intervalMs: number,
  label: string = "anonymous",
): string {
  const id = generateId(label);
  
  const wrappedCallback = () => {
    totalFired++;
    
    try {
      callback();
    } catch (err) {
      log.error(`interval callback error: id=${id} label=${label} error=${err}`);
    }
  };
  
  const handle = setInterval(wrappedCallback, intervalMs);
  handle.unref?.(); // Don't keep process alive for this timer
  
  const entry: TimerEntry = {
    id,
    type: "interval",
    label,
    createdAt: Date.now(),
    delayMs: intervalMs,
    handle,
    callback: wrappedCallback,
  };
  
  activeTimers.set(id, entry);
  totalCreated++;
  
  log.debug(`interval created: id=${id} label=${label} intervalMs=${intervalMs}`);
  
  return id;
}

/**
 * Cancel a managed timer (timeout or interval).
 */
export function clearManagedTimer(id: string): boolean {
  const entry = activeTimers.get(id);
  if (!entry) {
    return false;
  }
  
  if (entry.type === "timeout") {
    clearTimeout(entry.handle);
  } else {
    clearInterval(entry.handle);
  }
  
  activeTimers.delete(id);
  totalCancelled++;
  
  log.debug(`timer cleared: id=${id} label=${entry.label}`);
  
  return true;
}

/**
 * Alias for clearManagedTimer (for timeout clarity).
 */
export const clearManagedTimeout = clearManagedTimer;

/**
 * Alias for clearManagedTimer (for interval clarity).
 */
export const clearManagedInterval = clearManagedTimer;

/**
 * Cancel all active timers.
 * Call this during shutdown.
 */
export function clearAllTimers(): number {
  const count = activeTimers.size;
  
  for (const entry of activeTimers.values()) {
    if (entry.type === "timeout") {
      clearTimeout(entry.handle);
    } else {
      clearInterval(entry.handle);
    }
  }
  
  activeTimers.clear();
  totalCancelled += count;
  
  log.info(`cleared all timers: count=${count}`);
  
  return count;
}

/**
 * Cancel all timers matching a label pattern.
 */
export function clearTimersByLabel(pattern: string | RegExp): number {
  const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;
  let count = 0;
  
  for (const [id, entry] of activeTimers) {
    if (regex.test(entry.label)) {
      if (entry.type === "timeout") {
        clearTimeout(entry.handle);
      } else {
        clearInterval(entry.handle);
      }
      activeTimers.delete(id);
      totalCancelled++;
      count++;
    }
  }
  
  if (count > 0) {
    log.debug(`cleared timers by label: pattern=${pattern} count=${count}`);
  }
  
  return count;
}

/**
 * List all active timers (for debugging).
 */
export function listActiveTimers(): Array<{
  id: string;
  type: TimerType;
  label: string;
  createdAt: number;
  delayMs: number;
  ageMs: number;
}> {
  const now = Date.now();
  
  return [...activeTimers.values()].map((entry) => ({
    id: entry.id,
    type: entry.type,
    label: entry.label,
    createdAt: entry.createdAt,
    delayMs: entry.delayMs,
    ageMs: now - entry.createdAt,
  }));
}

/**
 * Get timer statistics.
 */
export function getTimerStats(): {
  active: number;
  timeouts: number;
  intervals: number;
  totalCreated: number;
  totalFired: number;
  totalCancelled: number;
} {
  let timeouts = 0;
  let intervals = 0;
  
  for (const entry of activeTimers.values()) {
    if (entry.type === "timeout") {
      timeouts++;
    } else {
      intervals++;
    }
  }
  
  return {
    active: activeTimers.size,
    timeouts,
    intervals,
    totalCreated,
    totalFired,
    totalCancelled,
  };
}

/**
 * Convenience object for easier imports.
 */
export const timers = {
  setTimeout: managedSetTimeout,
  setInterval: managedSetInterval,
  clearTimeout: clearManagedTimeout,
  clearInterval: clearManagedInterval,
  clear: clearManagedTimer,
  clearAll: clearAllTimers,
  clearByLabel: clearTimersByLabel,
  list: listActiveTimers,
  stats: getTimerStats,
};

/**
 * Register shutdown handler to clean up timers.
 */
export function registerTimerShutdownHandler(): void {
  const cleanup = () => {
    const cleared = clearAllTimers();
    if (cleared > 0) {
      log.info(`shutdown: cleared ${cleared} timers`);
    }
  };
  
  process.on("beforeExit", cleanup);
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}
