/**
 * Voice streaming module for real-time voice conversations.
 *
 * This module provides:
 * - WebSocket-based voice streaming endpoint
 * - Integration with Piper TTS for streaming audio (22050 Hz, 16-bit PCM)
 * - VAD (Voice Activity Detection) for turn management
 * - Barge-in support (interrupt when user speaks)
 */

import type { IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { OpenClawConfig } from "../config/config.js";
import { logVerbose } from "../globals.js";

// Use console for warn/error since globals.ts doesn't export logWarn/logError
const logWarn = (msg: string) => console.warn(`[voice] ${msg}`);
const logError = (msg: string) => console.error(`[voice] ${msg}`);

// Piper TTS server URL (default port 8767)
const PIPER_STREAM_URL =
  process.env.PIPER_STREAM_URL || "http://127.0.0.1:8767/v1/audio/speech/stream";

export interface VoiceStreamConfig {
  piperStreamUrl: string;
  defaultVoice: string;
  sampleRate: number;
}

export interface VoiceSession {
  id: string;
  clientWs: WebSocket;
  isGenerating: boolean;
  shouldInterrupt: boolean;
  voice: string;
  createdAt: number;
}

type VoiceClientMessage =
  | { type: "config"; voice?: string }
  | { type: "text"; text: string; voice?: string }
  | { type: "interrupt" }
  | { type: "ping" };

type VoiceServerMessage =
  | { type: "audio_start"; voice: string }
  | { type: "audio_end"; duration: number }
  | { type: "response_text"; text: string }
  | { type: "error"; message: string }
  | { type: "pong" };

const activeSessions = new Map<string, VoiceSession>();

/**
 * Get default voice configuration.
 */
export function getVoiceConfig(cfg?: OpenClawConfig): VoiceStreamConfig {
  return {
    piperStreamUrl: PIPER_STREAM_URL,
    defaultVoice: "en_US-ryan-medium",
    sampleRate: 22050,
  };
}

/**
 * Create a voice streaming session.
 */
function createSession(clientWs: WebSocket): VoiceSession {
  const id = `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const session: VoiceSession = {
    id,
    clientWs,
    isGenerating: false,
    shouldInterrupt: false,
    voice: "en_US-ryan-medium",
    createdAt: Date.now(),
  };
  activeSessions.set(id, session);
  logVerbose(`Voice session created: ${id}`);
  return session;
}

/**
 * Destroy a voice session.
 */
function destroySession(session: VoiceSession): void {
  activeSessions.delete(session.id);
  logVerbose(`Voice session destroyed: ${session.id}`);
}

/**
 * Strip markdown formatting for TTS.
 * Removes asterisks, underscores, backticks, etc. that would be spoken literally.
 */
function stripMarkdownForTTS(text: string): string {
  return text
    // Remove bold/italic markers: **text**, *text*, __text__, _text_
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    // Remove inline code: `text`
    .replace(/`([^`]+)`/g, "$1")
    // Remove strikethrough: ~~text~~
    .replace(/~~([^~]+)~~/g, "$1")
    // Remove markdown links: [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Remove standalone asterisks/underscores
    .replace(/[*_~`]/g, "")
    // Clean up extra whitespace
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Stream TTS audio to client via HTTP streaming (Piper).
 */
async function streamTTSToClient(
  session: VoiceSession,
  text: string,
  config: VoiceStreamConfig,
): Promise<void> {
  if (session.shouldInterrupt) {
    logVerbose(`TTS interrupted before start: ${session.id}`);
    return;
  }

  session.isGenerating = true;
  const voice = session.voice || config.defaultVoice;
  
  // Strip markdown for clean TTS
  const ttsText = stripMarkdownForTTS(text);

  try {
    // Notify client that audio is starting
    sendToClient(session, { type: "audio_start", voice });

    const response = await fetch(config.piperStreamUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: ttsText, voice, speed: 1.0 }),
    });

    if (!response.ok) {
      throw new Error(`Piper stream error: ${response.status}`);
    }

    if (!response.body) {
      throw new Error("No response body");
    }

    const reader = response.body.getReader();
    let totalBytes = 0;
    let leftoverByte: number | null = null; // Buffer for odd-byte alignment

    while (true) {
      if (session.shouldInterrupt) {
        logVerbose(`TTS interrupted during streaming: ${session.id}`);
        reader.cancel();
        break;
      }

      const { done, value } = await reader.read();
      if (done) {
        // Send any remaining leftover byte (shouldn't happen with valid audio)
        if (leftoverByte !== null) {
          logWarn(`Audio stream ended with leftover byte - this shouldn't happen`);
        }
        break;
      }

      // Build chunk with proper 16-bit alignment
      let chunk: Buffer;
      if (leftoverByte !== null) {
        // Prepend leftover byte from previous chunk
        chunk = Buffer.alloc(1 + value.length);
        chunk[0] = leftoverByte;
        chunk.set(value, 1);
        leftoverByte = null;
      } else {
        chunk = Buffer.from(value);
      }

      // Ensure even byte count for 16-bit audio alignment
      if (chunk.length % 2 !== 0) {
        leftoverByte = chunk[chunk.length - 1];
        chunk = chunk.subarray(0, chunk.length - 1);
      }

      // Send audio chunk as binary
      if (session.clientWs.readyState === WebSocket.OPEN && chunk.length > 0) {
        session.clientWs.send(chunk, { binary: true });
        totalBytes += chunk.length;
      }
    }

    const duration = totalBytes / (config.sampleRate * 2); // 16-bit = 2 bytes
    sendToClient(session, { type: "audio_end", duration });
    logVerbose(`TTS complete: ${duration.toFixed(2)}s, ${totalBytes} bytes`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError(`TTS streaming error: ${message}`);
    sendToClient(session, { type: "error", message });
  } finally {
    session.isGenerating = false;
    session.shouldInterrupt = false;
  }
}

/**
 * Send JSON message to client.
 */
function sendToClient(session: VoiceSession, message: VoiceServerMessage): void {
  if (session.clientWs.readyState === WebSocket.OPEN) {
    session.clientWs.send(JSON.stringify(message));
  }
}

/**
 * Handle incoming client message.
 */
async function handleClientMessage(
  session: VoiceSession,
  data: RawData,
  config: VoiceStreamConfig,
  onTextMessage?: (text: string, session: VoiceSession) => Promise<string | null>,
): Promise<void> {
  try {
    const message = JSON.parse(data.toString()) as VoiceClientMessage;

    switch (message.type) {
      case "config":
        if (message.voice) {
          session.voice = message.voice;
          logVerbose(`Voice updated to ${message.voice} for session: ${session.id}`);
        }
        break;

      case "text":
        if (!message.text?.trim()) {
          break;
        }

        // If callback provided, get LLM response first
        let responseText = message.text;
        if (onTextMessage) {
          const llmResponse = await onTextMessage(message.text, session);
          if (llmResponse) {
            responseText = llmResponse;
            // Send response text to client for transcript
            sendToClient(session, { type: "response_text", text: responseText });
          }
        }

        // Use voice from message or session default
        if (message.voice) {
          session.voice = message.voice;
        }

        // Stream TTS
        // HTTP streaming avoids WS-to-WS binary corruption
        await streamTTSToClient(session, responseText, config);
        break;

      case "interrupt":
        if (session.isGenerating) {
          session.shouldInterrupt = true;
          logVerbose(`Interrupt requested for session: ${session.id}`);
        }
        break;

      case "ping":
        sendToClient(session, { type: "pong" });
        break;

      default:
        logWarn(`Unknown voice message type: ${(message as any).type}`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Invalid message";
    logError(`Voice message error: ${msg}`);
    sendToClient(session, { type: "error", message: msg });
  }
}

/**
 * Attach voice streaming WebSocket handler to an HTTP server.
 *
 * Usage:
 * ```ts
 * const wss = attachVoiceStreamHandler(server, cfg, async (text, session) => {
 *   // Process with LLM and return response text
 *   return await getLLMResponse(text);
 * });
 * ```
 */
export function attachVoiceStreamHandler(
  server: import("node:http").Server,
  cfg: OpenClawConfig,
  onTextMessage?: (text: string, session: VoiceSession) => Promise<string | null>,
): WebSocketServer {
  const config = getVoiceConfig(cfg);

  // Simple setup - dedicated server, no conflicts
  // Disable perMessageDeflate to prevent binary audio corruption
  const wss = new WebSocketServer({
    server,
    path: "/voice/stream",
    perMessageDeflate: false,
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const session = createSession(ws);
    logVerbose(`Voice client connected: ${session.id} from ${req.socket.remoteAddress}`);

    ws.on("message", (data: RawData) => {
      handleClientMessage(session, data, config, onTextMessage);
    });

    ws.on("close", () => {
      destroySession(session);
    });

    ws.on("error", (error) => {
      logError(`Voice WS error: ${error.message}`);
      destroySession(session);
    });

    // Send initial config
    ws.send(
      JSON.stringify({
        type: "connected",
        sessionId: session.id,
        config: {
          sampleRate: config.sampleRate,
          channels: 1,
          sampleWidth: 2,
          defaultVoice: config.defaultVoice,
        },
      }),
    );
  });

  logVerbose(`Voice stream handler attached at /voice/stream`);
  return wss;
}

/**
 * Get active voice sessions count.
 */
export function getActiveVoiceSessionCount(): number {
  return activeSessions.size;
}

/**
 * Cleanup stale sessions older than maxAge (default 1 hour).
 */
export function cleanupStaleSessions(maxAgeMs: number = 60 * 60 * 1000): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [id, session] of activeSessions) {
    if (now - session.createdAt > maxAgeMs) {
      session.clientWs.close();
      destroySession(session);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logVerbose(`Cleaned up ${cleaned} stale voice sessions`);
  }

  return cleaned;
}
