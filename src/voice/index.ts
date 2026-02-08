/**
 * Voice module for real-time voice conversations.
 *
 * This module is completely separate from the text messaging path.
 * It only activates when a client connects to /voice/stream WebSocket.
 */

export {
  attachVoiceStreamHandler,
  getVoiceConfig,
  getActiveVoiceSessionCount,
  cleanupStaleSessions,
  type VoiceStreamConfig,
  type VoiceSession,
} from "./voice-stream.js";

export {
  startVoiceGateway,
  isVoiceStreamingAvailable,
  type VoiceGatewayOptions,
} from "./voice-gateway.js";
