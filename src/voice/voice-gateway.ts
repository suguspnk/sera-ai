/**
 * Voice gateway integration - connects voice streaming to the main gateway.
 *
 * This file provides the integration point between the voice streaming module
 * and the OpenClaw gateway. It handles the LLM processing for voice messages
 * using the gateway's OpenAI-compatible HTTP endpoint.
 *
 * Runs on a SEPARATE port (default 18790) to avoid WebSocket upgrade conflicts.
 */

import { createServer, type Server as HttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import { loadConfig, resolveGatewayPort } from "../config/config.js";
import { logVerbose } from "../globals.js";

const VOICE_PORT = parseInt(process.env.VOICE_PORT || "18790", 10);
const VOICE_SSL_CERT = process.env.VOICE_SSL_CERT || join(homedir(), ".openclaw/certs/lima-openclaw.tailcc9ed4.ts.net.crt");
const VOICE_SSL_KEY = process.env.VOICE_SSL_KEY || join(homedir(), ".openclaw/certs/lima-openclaw.tailcc9ed4.ts.net.key");

const logWarn = (msg: string) => console.warn(`[voice] ${msg}`);
const logError = (msg: string) => console.error(`[voice] ${msg}`);
import { attachVoiceStreamHandler, type VoiceSession } from "./voice-stream.js";

// Conversation history per voice session
const conversationHistory = new Map<
  string,
  Array<{ role: "system" | "user" | "assistant"; content: string }>
>();

/**
 * Call the gateway's OpenAI-compatible endpoint for chat completion.
 */
async function callGatewayLLM(
  text: string,
  voiceSessionId: string,
  cfg: OpenClawConfig,
): Promise<string | null> {
  try {
    // Get or create conversation history
    let history = conversationHistory.get(voiceSessionId);
    if (!history) {
      history = [
        {
          role: "system" as const,
          content:
            "You are a helpful voice assistant. Keep responses concise and conversational, suitable for spoken delivery. Aim for 1-3 sentences unless more detail is explicitly requested. Do not use markdown formatting (no asterisks, underscores, or backticks) as your responses will be spoken aloud.",
        },
      ];
      conversationHistory.set(voiceSessionId, history);
    }

    // Add user message
    history.push({ role: "user" as const, content: text });

    // Keep history manageable (last 20 messages + system)
    if (history.length > 21) {
      history = [history[0], ...history.slice(-20)];
      conversationHistory.set(voiceSessionId, history);
    }

    // Get gateway port
    const port = resolveGatewayPort(cfg);
    const url = `http://127.0.0.1:${port}/v1/chat/completions`;

    // Get auth token from config
    const token = cfg.gateway?.auth?.token || cfg.gateway?.auth?.password || "";

    logVerbose(`Voice calling gateway LLM at ${url}`);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        model: cfg.agent?.model || "default",
        messages: history,
        max_tokens: 1024,
        stream: false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logError(`Gateway LLM error: ${response.status} - ${error}`);
      return "I'm having trouble connecting right now. Please try again.";
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const assistantMessage =
      data.choices?.[0]?.message?.content?.trim() || "I'm not sure how to respond to that.";

    // Add to history
    history.push({ role: "assistant" as const, content: assistantMessage });

    return assistantMessage;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    logError(`Voice LLM call failed: ${msg}`);
    return "I encountered an error processing your request. Please try again.";
  }
}

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
export function startVoiceGateway(_httpServer: HttpServer, options?: VoiceGatewayOptions): void {
  const cfg = loadConfig();

  // Check if voice is enabled (TTS must be configured)
  const ttsConfig = cfg.messages?.tts;
  if (!ttsConfig?.provider) {
    logVerbose("Voice gateway not started: TTS not configured");
    return;
  }

  try {
    // Check if SSL certs are available for secure voice connections
    const useSSL = existsSync(VOICE_SSL_CERT) && existsSync(VOICE_SSL_KEY);
    
    const requestHandler = (req: any, res: any) => {
      // Simple health check
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", service: "voice", ssl: useSSL }));
        return;
      }
      res.writeHead(404);
      res.end(`Voice WebSocket server - connect via ${useSSL ? "wss" : "ws"}://`);
    };

    // Create HTTPS server if certs available, otherwise HTTP
    const voiceServer = useSSL
      ? createHttpsServer(
          {
            cert: readFileSync(VOICE_SSL_CERT),
            key: readFileSync(VOICE_SSL_KEY),
          },
          requestHandler,
        )
      : createServer(requestHandler);

    if (useSSL) {
      logVerbose(`Voice server using SSL with cert: ${VOICE_SSL_CERT}`);
    }

    // Use provided handler or default to gateway's OpenAI-compatible endpoint
    const messageHandler = options?.onUserMessage
      ? async (text: string, session: VoiceSession) => {
          return options.onUserMessage!(text, session.id);
        }
      : async (text: string, session: VoiceSession) => {
          logVerbose(`Voice message from ${session.id}: ${text}`);
          return callGatewayLLM(text, session.id, cfg);
        };

    const wss = attachVoiceStreamHandler(voiceServer, cfg, messageHandler);

    voiceServer.listen(VOICE_PORT, "0.0.0.0", () => {
      const protocol = useSSL ? "wss" : "ws";
      logVerbose(`Voice gateway started on port ${VOICE_PORT} (${useSSL ? "HTTPS/WSS" : "HTTP/WS"})`);
      console.log(`[voice] Voice WebSocket available at ${protocol}://localhost:${VOICE_PORT}/voice/stream`);
    });

    voiceServer.on("error", (err) => {
      logError(`Voice server error: ${err.message}`);
    });
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
