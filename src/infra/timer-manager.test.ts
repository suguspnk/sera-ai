import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  timers,
  managedSetTimeout,
  managedSetInterval,
  clearManagedTimer,
  clearAllTimers,
  clearTimersByLabel,
  listActiveTimers,
  getTimerStats,
} from "./timer-manager.js";

describe("timer-manager", () => {
  beforeEach(() => {
    clearAllTimers();
    vi.useFakeTimers();
  });

  describe("managedSetTimeout", () => {
    it("creates a timeout that fires after delay", () => {
      const callback = vi.fn();
      managedSetTimeout(callback, 1000, "test-timeout");
      
      expect(callback).not.toHaveBeenCalled();
      
      vi.advanceTimersByTime(1000);
      
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("is removed from active timers after firing", () => {
      managedSetTimeout(() => {}, 1000, "auto-remove");
      
      expect(getTimerStats().active).toBe(1);
      
      vi.advanceTimersByTime(1000);
      
      expect(getTimerStats().active).toBe(0);
    });

    it("can be cancelled before firing", () => {
      const callback = vi.fn();
      const id = managedSetTimeout(callback, 1000, "cancel-me");
      
      clearManagedTimer(id);
      vi.advanceTimersByTime(1000);
      
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("managedSetInterval", () => {
    it("fires repeatedly at interval", () => {
      const callback = vi.fn();
      managedSetInterval(callback, 100, "test-interval");
      
      vi.advanceTimersByTime(350);
      
      expect(callback).toHaveBeenCalledTimes(3);
    });

    it("remains in active timers until cleared", () => {
      const id = managedSetInterval(() => {}, 100, "persistent");
      
      vi.advanceTimersByTime(500);
      expect(getTimerStats().active).toBe(1);
      
      clearManagedTimer(id);
      expect(getTimerStats().active).toBe(0);
    });
  });

  describe("clearAllTimers", () => {
    it("cancels all active timers", () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      
      managedSetTimeout(cb1, 1000, "timeout-1");
      managedSetInterval(cb2, 100, "interval-1");
      
      expect(getTimerStats().active).toBe(2);
      
      const cleared = clearAllTimers();
      
      expect(cleared).toBe(2);
      expect(getTimerStats().active).toBe(0);
      
      vi.advanceTimersByTime(2000);
      
      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).not.toHaveBeenCalled();
    });
  });

  describe("clearTimersByLabel", () => {
    it("clears timers matching string pattern", () => {
      managedSetTimeout(() => {}, 1000, "auth-refresh");
      managedSetTimeout(() => {}, 1000, "auth-expire");
      managedSetTimeout(() => {}, 1000, "heartbeat");
      
      expect(getTimerStats().active).toBe(3);
      
      const cleared = clearTimersByLabel("auth");
      
      expect(cleared).toBe(2);
      expect(getTimerStats().active).toBe(1);
    });

    it("clears timers matching regex pattern", () => {
      managedSetTimeout(() => {}, 1000, "sweep-sessions");
      managedSetTimeout(() => {}, 1000, "sweep-cache");
      managedSetTimeout(() => {}, 1000, "cleanup");
      
      const cleared = clearTimersByLabel(/^sweep-/);
      
      expect(cleared).toBe(2);
    });
  });

  describe("listActiveTimers", () => {
    it("returns info about all active timers", () => {
      managedSetTimeout(() => {}, 5000, "test-timeout");
      managedSetInterval(() => {}, 1000, "test-interval");
      
      const list = listActiveTimers();
      
      expect(list).toHaveLength(2);
      expect(list.find((t) => t.type === "timeout")).toBeDefined();
      expect(list.find((t) => t.type === "interval")).toBeDefined();
      expect(list.every((t) => t.ageMs >= 0)).toBe(true);
    });
  });

  describe("getTimerStats", () => {
    it("tracks timer statistics", () => {
      const initialStats = getTimerStats();
      const initialCreated = initialStats.totalCreated;
      
      managedSetTimeout(() => {}, 100, "t1");
      managedSetTimeout(() => {}, 100, "t2");
      managedSetInterval(() => {}, 100, "i1");
      
      const stats1 = getTimerStats();
      expect(stats1.active).toBe(3);
      expect(stats1.timeouts).toBe(2);
      expect(stats1.intervals).toBe(1);
      expect(stats1.totalCreated).toBe(initialCreated + 3);
      
      vi.advanceTimersByTime(100);
      
      const stats2 = getTimerStats();
      expect(stats2.active).toBe(1); // Only interval remains
      expect(stats2.totalFired).toBeGreaterThan(0);
    });
  });

  describe("timers convenience object", () => {
    it("provides all timer functions", () => {
      expect(typeof timers.setTimeout).toBe("function");
      expect(typeof timers.setInterval).toBe("function");
      expect(typeof timers.clearTimeout).toBe("function");
      expect(typeof timers.clearInterval).toBe("function");
      expect(typeof timers.clear).toBe("function");
      expect(typeof timers.clearAll).toBe("function");
      expect(typeof timers.clearByLabel).toBe("function");
      expect(typeof timers.list).toBe("function");
      expect(typeof timers.stats).toBe("function");
    });
  });
});
