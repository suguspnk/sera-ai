/**
 * Voice streaming module for real-time voice conversations.
 *
 * This module provides:
 * - WebSocket-based voice streaming endpoint
 * - Integration with Kokoro TTS for streaming audio
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

const KOKORO_WS_URL = process.env.KOKORO_WS_URL || "ws://127.0.0.1:8766/ws/tts";
const KOKORO_STREAM_URL =
  process.env.KOKORO_STREAM_URL || "http://127.0.0.1:8766/v1/audio/speech/stream";

export interface VoiceStreamConfig {
  kokoroWsUrl: string;
  kokoroStreamUrl: string;
  defaultVoice: string;
  sampleRate: number;
}

export interface VoiceSession {
  id: string;
  clientWs: WebSocket;
  kokoroWs: WebSocket | null;
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
  const ttsConfig = cfg?.messages?.tts;
  return {
    kokoroWsUrl: KOKORO_WS_URL,
    kokoroStreamUrl: KOKORO_STREAM_URL,
    defaultVoice: (ttsConfig as any)?.openai?.voice || "bf_isabella",
    sampleRate: 24000,
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
    kokoroWs: null,
    isGenerating: false,
    shouldInterrupt: false,
    voice: "bf_isabella",
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
  session.kokoroWs?.close();
  activeSessions.delete(session.id);
  logVerbose(`Voice session destroyed: ${session.id}`);
}

/**
 * Stream TTS audio to client via HTTP streaming.
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

  try {
    // Notify client that audio is starting
    sendToClient(session, { type: "audio_start", voice });

    const response = await fetch(config.kokoroStreamUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice, speed: 1.0 }),
    });

    if (!response.ok) {
      throw new Error(`Kokoro stream error: ${response.status}`);
    }

    if (!response.body) {
      throw new Error("No response body");
    }

    const reader = response.body.getReader();
    let totalBytes = 0;

    while (true) {
      if (session.shouldInterrupt) {
        logVerbose(`TTS interrupted during streaming: ${session.id}`);
        reader.cancel();
        break;
      }

      const { done, value } = await reader.read();
      if (done) break;

      // Send audio chunk as binary
      if (session.clientWs.readyState === WebSocket.OPEN) {
        // Convert Uint8Array to Buffer and log first samples
        const buf = Buffer.from(value);
        if (totalBytes === 0 && buf.length >= 20) {
          const samples = [];
          for (let i = 0; i < 20; i += 2) {
            samples.push(buf.readInt16LE(i));
          }
          logVerbose(`First chunk ${buf.length} bytes, first 10 samples: [${samples.join(", ")}]`);
        }
        session.clientWs.send(buf);
        totalBytes += buf.length;
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
 * Stream TTS using WebSocket connection to Kokoro.
 */
async function streamTTSViaWebSocket(
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

  return new Promise((resolve, reject) => {
    try {
      const kokoroWs = new WebSocket(config.kokoroWsUrl);
      session.kokoroWs = kokoroWs;

      kokoroWs.on("open", () => {
        logVerbose(`Kokoro WS connected for session: ${session.id}`);
        sendToClient(session, { type: "audio_start", voice });
        kokoroWs.send(JSON.stringify({ text, voice, speed: 1.0 }));
      });

      kokoroWs.on("message", (data: RawData, isBinary: boolean) => {
        if (session.shouldInterrupt) {
          logVerbose(`TTS interrupted, closing Kokoro WS: ${session.id}`);
          kokoroWs.close();
          return;
        }

        if (isBinary) {
          // Forward audio chunk to client
          if (session.clientWs.readyState === WebSocket.OPEN) {
            session.clientWs.send(data);
          }
        } else {
          // JSON message (completion or error)
          try {
            const msg = JSON.parse(data.toString());
            if (msg.done) {
              sendToClient(session, { type: "audio_end", duration: msg.duration });
              kokoroWs.close();
            } else if (msg.error) {
              sendToClient(session, { type: "error", message: msg.error });
              kokoroWs.close();
            }
          } catch (e) {
            logWarn(`Failed to parse Kokoro message: ${data.toString()}`);
          }
        }
      });

      kokoroWs.on("close", () => {
        session.kokoroWs = null;
        session.isGenerating = false;
        session.shouldInterrupt = false;
        resolve();
      });

      kokoroWs.on("error", (error) => {
        logError(`Kokoro WS error: ${error.message}`);
        sendToClient(session, { type: "error", message: error.message });
        session.kokoroWs = null;
        session.isGenerating = false;
        reject(error);
      });
    } catch (error) {
      session.isGenerating = false;
      reject(error);
    }
  });
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
        if (!message.text?.trim()) break;

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
        // Use HTTP streaming - WebSocket forwarding corrupts binary data
        await streamTTSToClient(session, responseText, config);
        break;

      case "interrupt":
        if (session.isGenerating) {
          session.shouldInterrupt = true;
          session.kokoroWs?.close();
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
