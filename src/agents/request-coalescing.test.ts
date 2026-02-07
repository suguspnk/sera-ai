import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  coalesceMessage,
  combineMessages,
  configureCoalescing,
  clearAllWindows,
  hasActiveWindow,
  getPendingCount,
  flushCoalesceWindow,
  type CoalesceMessage,
} from "./request-coalescing.js";

describe("request-coalescing", () => {
  beforeEach(() => {
    // Use very short windows for fast tests
    configureCoalescing({ enabled: true, windowMs: 20, maxMessages: 5 });
  });

  afterEach(() => {
    clearAllWindows();
  });

  it("returns single message immediately when disabled", async () => {
    configureCoalescing({ enabled: false });
    
    const msg: CoalesceMessage = { text: "hello", timestamp: Date.now() };
    const result = await coalesceMessage("session-1", msg);
    
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("hello");
  });

  it("creates a window for first message", async () => {
    const msg: CoalesceMessage = { text: "first", timestamp: Date.now() };
    
    // Start coalescing but don't await
    const promise = coalesceMessage("session-1", msg);
    
    expect(hasActiveWindow("session-1")).toBe(true);
    expect(getPendingCount("session-1")).toBe(1);
    
    // Wait for window to close (short 20ms window)
    const result = await promise;
    expect(result).toHaveLength(1);
    expect(hasActiveWindow("session-1")).toBe(false);
  });

  it("accumulates multiple messages within window", async () => {
    const start = Date.now();
    
    // Send messages rapidly
    const promise1 = coalesceMessage("session-1", { text: "msg1", timestamp: start });
    const promise2 = coalesceMessage("session-1", { text: "msg2", timestamp: start + 1 });
    const promise3 = coalesceMessage("session-1", { text: "msg3", timestamp: start + 2 });
    
    expect(getPendingCount("session-1")).toBe(3);
    
    // All promises should resolve with same result (window will close after 20ms)
    const [r1, r2, r3] = await Promise.all([promise1, promise2, promise3]);
    
    expect(r1).toHaveLength(3);
    expect(r2).toHaveLength(3);
    expect(r3).toHaveLength(3);
    expect(r1[0].text).toBe("msg1");
    expect(r1[1].text).toBe("msg2");
    expect(r1[2].text).toBe("msg3");
  });

  it("closes window when max messages reached", async () => {
    configureCoalescing({ enabled: true, windowMs: 5000, maxMessages: 3 });
    
    const promises = [
      coalesceMessage("session-1", { text: "1", timestamp: Date.now() }),
      coalesceMessage("session-1", { text: "2", timestamp: Date.now() }),
      coalesceMessage("session-1", { text: "3", timestamp: Date.now() }), // Should trigger close
    ];
    
    // Should resolve immediately without waiting for timeout
    const results = await Promise.all(promises);
    
    expect(results[0]).toHaveLength(3);
    expect(hasActiveWindow("session-1")).toBe(false);
  });

  it("keeps separate windows for different sessions", async () => {
    const p1 = coalesceMessage("session-1", { text: "s1-msg", timestamp: Date.now() });
    const p2 = coalesceMessage("session-2", { text: "s2-msg", timestamp: Date.now() });
    
    expect(hasActiveWindow("session-1")).toBe(true);
    expect(hasActiveWindow("session-2")).toBe(true);
    expect(getPendingCount("session-1")).toBe(1);
    expect(getPendingCount("session-2")).toBe(1);
    
    // Wait for windows to close (short 20ms windows)
    const [r1, r2] = await Promise.all([p1, p2]);
    
    expect(r1[0].text).toBe("s1-msg");
    expect(r2[0].text).toBe("s2-msg");
  });

  it("flushCoalesceWindow closes window immediately", async () => {
    const promise = coalesceMessage("session-1", { text: "flush-test", timestamp: Date.now() });
    
    expect(hasActiveWindow("session-1")).toBe(true);
    
    flushCoalesceWindow("session-1");
    
    const result = await promise;
    expect(result).toHaveLength(1);
    expect(hasActiveWindow("session-1")).toBe(false);
  });

  it("skips coalescing for subagent sessions", async () => {
    const msg: CoalesceMessage = { text: "subagent", timestamp: Date.now() };
    const result = await coalesceMessage("agent:main:subagent:run-123", msg);
    
    // Should return immediately without creating window
    expect(result).toHaveLength(1);
    expect(hasActiveWindow("agent:main:subagent:run-123")).toBe(false);
  });
});

describe("combineMessages", () => {
  it("returns empty for no messages", () => {
    const result = combineMessages([]);
    expect(result.text).toBe("");
    expect(result.images).toHaveLength(0);
  });

  it("returns single message unchanged", () => {
    const result = combineMessages([{ text: "hello", timestamp: 0 }]);
    expect(result.text).toBe("hello");
  });

  it("joins multiple messages with newlines", () => {
    const result = combineMessages([
      { text: "first", timestamp: 0 },
      { text: "second", timestamp: 1 },
      { text: "third", timestamp: 2 },
    ]);
    expect(result.text).toBe("first\n\nsecond\n\nthird");
  });

  it("combines images from all messages", () => {
    const result = combineMessages([
      { text: "with image", timestamp: 0, images: [{ type: "image/png", data: "abc" }] },
      { text: "another", timestamp: 1, images: [{ type: "image/jpeg", data: "def" }] },
    ]);
    expect(result.images).toHaveLength(2);
    expect(result.images[0].data).toBe("abc");
    expect(result.images[1].data).toBe("def");
  });

  it("trims whitespace from messages", () => {
    const result = combineMessages([
      { text: "  spaced  ", timestamp: 0 },
      { text: "\ttabbed\t", timestamp: 1 },
    ]);
    expect(result.text).toBe("spaced\n\ntabbed");
  });
});
