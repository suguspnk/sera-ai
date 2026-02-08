/**
 * Voice gateway integration - connects voice streaming to the main gateway.
 *
 * This file provides the integration point between the voice streaming module
 * and the OpenClaw gateway. It handles the LLM processing for voice messages.
 */

import type { Server as HttpServer } from "node:http";
import type { OpenClawConfig } from "../config/config.js";
import { loadConfig } from "../config/config.js";
import { logVerbose } from "../globals.js";

const logWarn = (msg: string) => console.warn(`[voice] ${msg}`);
import { attachVoiceStreamHandler, type VoiceSession } from "./voice-stream.js";

export interface VoiceGatewayOptions {
  /** Callback to process user text and get LLM response */
  onUserMessage?: (text: string, sessionId: string) => Promise<string | null>;
}

/**
 * Start voice gateway integration.
 *
 * This attaches the voice WebSocket handler to the gateway's HTTP server.
 * The voice endpoint is available at /voice/stream
 *
 * Usage in server.impl.ts:
 * ```ts
 * import { startVoiceGateway } from "../voice/voice-gateway.js";
 *
 * // After httpServer is created:
 * startVoiceGateway(httpServer, {
 *   onUserMessage: async (text, sessionId) => {
 *     // Process with LLM and return response
 *     return await processMessage(text);
 *   }
 * });
 * ```
 */
export function startVoiceGateway(httpServer: HttpServer, options?: VoiceGatewayOptions): void {
  const cfg = loadConfig();

  // Check if voice is enabled (TTS must be configured)
  const ttsConfig = cfg.messages?.tts;
  if (!ttsConfig?.provider) {
    logVerbose("Voice gateway not started: TTS not configured");
    return;
  }

  try {
    const wss = attachVoiceStreamHandler(
      httpServer,
      cfg,
      options?.onUserMessage
        ? async (text: string, session: VoiceSession) => {
            return options.onUserMessage!(text, session.id);
          }
        : undefined,
    );

    logVerbose(`Voice gateway started at /voice/stream`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    logWarn(`Failed to start voice gateway: ${msg}`);
  }
}

/**
 * Check if voice streaming is available.
 */
export function isVoiceStreamingAvailable(): boolean {
  const cfg = loadConfig();
  const kokoroUrl = process.env.KOKORO_WS_URL || "ws://127.0.0.1:8766/ws/tts";

  // Voice is available if TTS is configured
  return Boolean(cfg.messages?.tts?.provider);
}
