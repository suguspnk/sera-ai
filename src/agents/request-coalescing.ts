/**
 * Request Coalescing
 * 
 * Batches rapid-fire messages from the same session into a single agent run.
 * This reduces API calls and improves response coherence when users send
 * multiple messages quickly.
 * 
 * How it works:
 * 1. First message starts a coalesce window (default 1.5s)
 * 2. Subsequent messages within the window are accumulated
 * 3. When window closes, all messages are combined into one prompt
 * 4. A single agent run processes the combined prompt
 */

import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("coalesce");

// Configuration
const DEFAULT_WINDOW_MS = 1500; // 1.5 second window
const MAX_WINDOW_MS = 5000; // Never wait more than 5 seconds
const MAX_MESSAGES_PER_BATCH = 10; // Cap to prevent abuse

export type CoalesceMessage = {
  text: string;
  images?: Array<{ type: string; data: string }>;
  timestamp: number;
  senderId?: string;
  senderName?: string;
};

type CoalesceWindow = {
  sessionKey: string;
  messages: CoalesceMessage[];
  startedAt: number;
  timer: NodeJS.Timeout;
  resolve: (messages: CoalesceMessage[]) => void;
};

const activeWindows = new Map<string, CoalesceWindow>();

export type CoalesceConfig = {
  /** Enable/disable coalescing */
  enabled?: boolean;
  /** Window duration in milliseconds */
  windowMs?: number;
  /** Maximum messages to batch */
  maxMessages?: number;
  /** Session keys to exclude from coalescing */
  excludePatterns?: RegExp[];
};

const defaultConfig: Required<CoalesceConfig> = {
  enabled: true,
  windowMs: DEFAULT_WINDOW_MS,
  maxMessages: MAX_MESSAGES_PER_BATCH,
  excludePatterns: [],
};

let globalConfig: Required<CoalesceConfig> = { ...defaultConfig };

/**
 * Configure coalescing behavior.
 */
export function configureCoalescing(config: CoalesceConfig): void {
  globalConfig = {
    enabled: config.enabled ?? defaultConfig.enabled,
    windowMs: Math.min(config.windowMs ?? defaultConfig.windowMs, MAX_WINDOW_MS),
    maxMessages: config.maxMessages ?? defaultConfig.maxMessages,
    excludePatterns: config.excludePatterns ?? defaultConfig.excludePatterns,
  };
  log.debug(`coalescing configured: windowMs=${globalConfig.windowMs} maxMessages=${globalConfig.maxMessages}`);
}

/**
 * Check if a session should skip coalescing.
 */
function shouldSkipCoalescing(sessionKey: string): boolean {
  if (!globalConfig.enabled) {
    return true;
  }
  
  // Skip for subagent sessions (need immediate processing)
  if (sessionKey.includes("subagent:")) {
    return true;
  }
  
  // Check exclude patterns
  for (const pattern of globalConfig.excludePatterns) {
    if (pattern.test(sessionKey)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Submit a message for potential coalescing.
 * 
 * @returns Promise that resolves with the coalesced messages when the window closes
 */
export function coalesceMessage(
  sessionKey: string,
  message: CoalesceMessage,
): Promise<CoalesceMessage[]> {
  // Skip coalescing if disabled or excluded
  if (shouldSkipCoalescing(sessionKey)) {
    return Promise.resolve([message]);
  }
  
  const existing = activeWindows.get(sessionKey);
  
  if (existing) {
    // Add to existing window
    existing.messages.push(message);
    log.debug(`coalesce: added message to window session=${sessionKey} count=${existing.messages.length}`);
    
    // Close window if max messages reached
    if (existing.messages.length >= globalConfig.maxMessages) {
      log.debug(`coalesce: max messages reached, closing window session=${sessionKey}`);
      closeWindow(sessionKey);
    }
    
    // Return the same promise
    return new Promise((resolve) => {
      const originalResolve = existing.resolve;
      existing.resolve = (msgs) => {
        originalResolve(msgs);
        resolve(msgs);
      };
    });
  }
  
  // Start new window
  return new Promise((resolve) => {
    const window: CoalesceWindow = {
      sessionKey,
      messages: [message],
      startedAt: Date.now(),
      timer: setTimeout(() => closeWindow(sessionKey), globalConfig.windowMs),
      resolve,
    };
    
    activeWindows.set(sessionKey, window);
    log.debug(`coalesce: started window session=${sessionKey} windowMs=${globalConfig.windowMs}`);
  });
}

/**
 * Close a coalesce window and return accumulated messages.
 */
function closeWindow(sessionKey: string): void {
  const window = activeWindows.get(sessionKey);
  if (!window) {
    return;
  }
  
  clearTimeout(window.timer);
  activeWindows.delete(sessionKey);
  
  const duration = Date.now() - window.startedAt;
  log.debug(`coalesce: closed window session=${sessionKey} messages=${window.messages.length} duration=${duration}ms`);
  
  window.resolve(window.messages);
}

/**
 * Force-close a window immediately (e.g., on disconnect).
 */
export function flushCoalesceWindow(sessionKey: string): void {
  closeWindow(sessionKey);
}

/**
 * Combine coalesced messages into a single prompt.
 */
export function combineMessages(messages: CoalesceMessage[]): {
  text: string;
  images: Array<{ type: string; data: string }>;
} {
  if (messages.length === 0) {
    return { text: "", images: [] };
  }
  
  if (messages.length === 1) {
    return {
      text: messages[0].text,
      images: messages[0].images ?? [],
    };
  }
  
  // Combine multiple messages
  const allImages: Array<{ type: string; data: string }> = [];
  const textParts: string[] = [];
  
  for (const msg of messages) {
    if (msg.text.trim()) {
      textParts.push(msg.text.trim());
    }
    if (msg.images) {
      allImages.push(...msg.images);
    }
  }
  
  // Join with newlines, preserving the order
  const combinedText = textParts.join("\n\n");
  
  return {
    text: combinedText,
    images: allImages,
  };
}

/**
 * Check if there's an active coalesce window for a session.
 */
export function hasActiveWindow(sessionKey: string): boolean {
  return activeWindows.has(sessionKey);
}

/**
 * Get the number of pending messages in a session's window.
 */
export function getPendingCount(sessionKey: string): number {
  return activeWindows.get(sessionKey)?.messages.length ?? 0;
}

/**
 * Get coalescing statistics.
 */
export function getCoalesceStats(): {
  activeWindows: number;
  config: Required<CoalesceConfig>;
} {
  return {
    activeWindows: activeWindows.size,
    config: { ...globalConfig },
  };
}

/**
 * Clear all active windows (for shutdown/testing).
 */
export function clearAllWindows(): void {
  for (const sessionKey of activeWindows.keys()) {
    closeWindow(sessionKey);
  }
}
