#!/usr/bin/env node
/**
 * OpenAI-compatible Piper TTS Server
 *
 * Exposes /v1/audio/speech endpoint compatible with OpenAI's TTS API.
 * Uses Piper TTS for local, offline text-to-speech.
 *
 * Usage:
 *   PIPER_VOICES_DIR=/path/to/voices piper-server --port 8767
 *
 * Environment:
 *   PIPER_VOICES_DIR - Directory containing Piper voice models (default: ~/.local/share/piper-voices)
 *   PIPER_BIN - Path to piper binary (default: auto-detect)
 *   PORT - Server port (default: 8767)
 */

import Fastify from "fastify";
import { spawn } from "node:child_process";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, createWriteStream, readdirSync } from "node:fs";
import { mkdir, rm, rename } from "node:fs/promises";
import { tmpdir, homedir, platform, arch } from "node:os";
import { join, basename, dirname } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

const DEFAULT_PORT = 8767;
const DEFAULT_VOICES_DIR = join(homedir(), ".local", "share", "piper-voices");
const DEFAULT_VOICE = "en_US-ryan-medium";

// Voice name mappings (OpenAI voice -> Piper voice)
const VOICE_MAP = {
  // Default mappings for OpenAI voice names
  alloy: "en_US-amy-medium",
  echo: "en_US-ryan-medium",
  fable: "en_GB-alan-medium",
  onyx: "en_US-ryan-low",
  nova: "en_US-amy-low",
  shimmer: "en_US-lessac-medium",
  sage: "en_US-joe-medium",
  coral: "en_US-kusal-medium",
  ash: "en_US-libritts_r-medium",
};

// Piper release info
const PIPER_VERSION = "2023.11.14-2";
const PIPER_RELEASES = {
  "linux-x64": `https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_x86_64.tar.gz`,
  "linux-arm64": `https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_aarch64.tar.gz`,
  "darwin-x64": `https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_macos_x64.tar.gz`,
  "darwin-arm64": `https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_macos_aarch64.tar.gz`,
};

function getPlatformKey() {
  const p = platform();
  const a = arch();
  if (p === "linux" && a === "x64") {
    return "linux-x64";
  }
  if (p === "linux" && (a === "arm64" || a === "aarch64")) {
    return "linux-arm64";
  }
  if (p === "darwin" && a === "x64") {
    return "darwin-x64";
  }
  if (p === "darwin" && a === "arm64") {
    return "darwin-arm64";
  }
  return null;
}

async function downloadFile(url, destPath) {
  console.log(`Downloading: ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status}`);
  }

  await mkdir(dirname(destPath), { recursive: true });
  const fileStream = createWriteStream(destPath);
  await pipeline(Readable.fromWeb(res.body), fileStream);
  console.log(`Downloaded to: ${destPath}`);
}

async function extractTarGz(tarPath, destDir) {
  console.log(`Extracting: ${tarPath} -> ${destDir}`);
  await mkdir(destDir, { recursive: true });
  execSync(`tar -xzf "${tarPath}" -C "${destDir}"`, { stdio: "inherit" });
}

async function ensurePiperBinary(voicesDir) {
  const piperDir = join(voicesDir, "piper");
  const piperBin = join(piperDir, "piper", "piper");

  if (existsSync(piperBin)) {
    return piperBin;
  }

  const platformKey = getPlatformKey();
  if (!platformKey) {
    throw new Error(`Unsupported platform: ${platform()}/${arch()}`);
  }

  const url = PIPER_RELEASES[platformKey];
  const tarPath = join(tmpdir(), `piper-${platformKey}.tar.gz`);

  console.log("Piper binary not found. Downloading...");
  await downloadFile(url, tarPath);
  await extractTarGz(tarPath, piperDir);
  await rm(tarPath, { force: true });

  // Make executable
  execSync(`chmod +x "${piperBin}"`, { stdio: "inherit" });

  console.log(`Piper installed at: ${piperBin}`);
  return piperBin;
}

async function downloadVoice(voiceName, voicesDir) {
  // Parse voice name: lang_REGION-name-quality
  const match = voiceName.match(/^([a-z]{2}_[A-Z]{2})-(.+)-(low|medium|high|x_low)$/);
  if (!match) {
    throw new Error(`Invalid voice name format: ${voiceName}. Expected: lang_REGION-name-quality`);
  }

  const [, langRegion, name, quality] = match;
  const lang = langRegion.split("_")[0]; // e.g., "en" from "en_US"
  const voiceDir = join(voicesDir, voiceName);
  const onnxPath = join(voiceDir, `${voiceName}.onnx`);
  const jsonPath = join(voiceDir, `${voiceName}.onnx.json`);

  if (existsSync(onnxPath) && existsSync(jsonPath)) {
    return { onnxPath, jsonPath };
  }

  console.log(`Voice "${voiceName}" not found. Downloading...`);

  // URL format: https://huggingface.co/rhasspy/piper-voices/resolve/main/{lang}/{lang_REGION}/{name}/{quality}/{voice}.onnx
  const baseUrl = `https://huggingface.co/rhasspy/piper-voices/resolve/main/${lang}/${langRegion}/${name}/${quality}`;
  const onnxUrl = `${baseUrl}/${voiceName}.onnx`;
  const jsonUrl = `${baseUrl}/${voiceName}.onnx.json`;

  await mkdir(voiceDir, { recursive: true });
  await downloadFile(onnxUrl, onnxPath);
  await downloadFile(jsonUrl, jsonPath);

  console.log(`Voice "${voiceName}" installed.`);
  return { onnxPath, jsonPath };
}

function resolveVoiceName(voice) {
  // If it's an OpenAI voice name, map it
  if (VOICE_MAP[voice]) {
    return VOICE_MAP[voice];
  }
  // Otherwise assume it's a Piper voice name
  return voice;
}

async function synthesize(text, voiceName, piperBin, voicesDir) {
  const resolvedVoice = resolveVoiceName(voiceName);
  const { onnxPath } = await downloadVoice(resolvedVoice, voicesDir);

  return new Promise((resolve, reject) => {
    const chunks = [];

    const piper = spawn(piperBin, ["--model", onnxPath, "--output-raw"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    piper.stdout.on("data", (chunk) => chunks.push(chunk));
    piper.stderr.on("data", (data) => {
      // Piper logs to stderr, only log errors
      const msg = data.toString();
      if (msg.includes("Error") || msg.includes("error")) {
        console.error("Piper:", msg);
      }
    });

    piper.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Piper exited with code ${code}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    piper.on("error", reject);

    // Send text to piper
    piper.stdin.write(text);
    piper.stdin.end();
  });
}

// Convert raw PCM to WAV
function pcmToWav(pcmBuffer, sampleRate = 22050, channels = 1, bitsPerSample = 16) {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcmBuffer.length;
  const headerSize = 44;

  const wav = Buffer.alloc(headerSize + dataSize);

  // RIFF header
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVE", 8);

  // fmt chunk
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16); // chunk size
  wav.writeUInt16LE(1, 20); // PCM format
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  wav.write("data", 36);
  wav.writeUInt32LE(dataSize, 40);
  pcmBuffer.copy(wav, 44);

  return wav;
}

// Convert WAV to MP3 using ffmpeg
async function wavToMp3(wavBuffer) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      "ffmpeg",
      [
        "-f",
        "wav",
        "-i",
        "pipe:0",
        "-f",
        "mp3",
        "-ab",
        "48k",
        "-ar",
        "24000",
        "-ac",
        "1",
        "pipe:1",
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    const chunks = [];
    ffmpeg.stdout.on("data", (chunk) => chunks.push(chunk));
    ffmpeg.stderr.on("data", () => {}); // Ignore ffmpeg logs

    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    ffmpeg.on("error", reject);
    ffmpeg.stdin.write(wavBuffer);
    ffmpeg.stdin.end();
  });
}

async function main() {
  const port = parseInt(process.env.PORT || DEFAULT_PORT.toString(), 10);
  const voicesDir = process.env.PIPER_VOICES_DIR || DEFAULT_VOICES_DIR;
  let piperBin = process.env.PIPER_BIN;

  // Ensure voices directory exists
  mkdirSync(voicesDir, { recursive: true });

  // Download piper if needed
  if (!piperBin) {
    piperBin = await ensurePiperBinary(voicesDir);
  }

  console.log(`Piper binary: ${piperBin}`);
  console.log(`Voices directory: ${voicesDir}`);

  const fastify = Fastify({ logger: false });

  // Health check
  fastify.get("/health", async () => ({ status: "ok" }));

  // OpenAI-compatible speech endpoint
  fastify.post("/v1/audio/speech", async (request, reply) => {
    console.log(`[${new Date().toISOString()}] TTS REQUEST RECEIVED`);
    const { model, input, voice, response_format = "mp3", speed = 1.0 } = request.body || {};
    console.log(
      `  model=${model}, voice=${voice}, format=${response_format}, input_len=${input?.length}`,
    );

    if (!input) {
      return reply.code(400).send({ error: { message: "Missing input text" } });
    }

    const voiceName = voice || DEFAULT_VOICE;

    try {
      console.log(`TTS: voice=${voiceName}, format=${response_format}, len=${input.length}`);

      const pcmBuffer = await synthesize(input, voiceName, piperBin, voicesDir);
      const wavBuffer = pcmToWav(pcmBuffer);

      let outputBuffer;
      let contentType;

      if (response_format === "wav") {
        outputBuffer = wavBuffer;
        contentType = "audio/wav";
      } else if (response_format === "pcm") {
        outputBuffer = pcmBuffer;
        contentType = "audio/pcm";
      } else {
        // Default to MP3
        outputBuffer = await wavToMp3(wavBuffer);
        contentType = "audio/mpeg";
      }

      reply.header("Content-Type", contentType);
      reply.header("Content-Length", outputBuffer.length);
      return reply.send(outputBuffer);
    } catch (err) {
      console.error("TTS error:", err.message);
      return reply.code(500).send({ error: { message: err.message } });
    }
  });

  // Streaming speech endpoint (for voice gateway)
  fastify.post("/v1/audio/speech/stream", async (request, reply) => {
    console.log(`[${new Date().toISOString()}] TTS STREAM REQUEST RECEIVED`);
    const { text, voice, speed = 1.0 } = request.body || {};
    console.log(`  voice=${voice}, input_len=${text?.length}`);

    if (!text) {
      return reply.code(400).send({ error: { message: "Missing text" } });
    }

    const voiceName = voice || DEFAULT_VOICE;
    const resolvedVoice = resolveVoiceName(voiceName);

    try {
      const { onnxPath } = await downloadVoice(resolvedVoice, voicesDir);

      // Stream raw PCM audio (16-bit, 22050Hz mono)
      reply.header("Content-Type", "audio/pcm");
      reply.header("Transfer-Encoding", "chunked");
      reply.raw.flushHeaders();

      const piper = spawn(piperBin, ["--model", onnxPath, "--output-raw"], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      piper.stdout.on("data", (chunk) => {
        reply.raw.write(chunk);
      });

      piper.stderr.on("data", (data) => {
        const msg = data.toString();
        if (msg.includes("Error") || msg.includes("error")) {
          console.error("Piper stream error:", msg);
        }
      });

      piper.on("close", (code) => {
        if (code !== 0) {
          console.error(`Piper stream exited with code ${code}`);
        }
        reply.raw.end();
      });

      piper.on("error", (err) => {
        console.error("Piper stream spawn error:", err);
        reply.raw.end();
      });

      // Send text to piper
      piper.stdin.write(text);
      piper.stdin.end();

      // Don't return - let the stream complete
      return reply;
    } catch (err) {
      console.error("TTS stream error:", err.message);
      return reply.code(500).send({ error: { message: err.message } });
    }
  });

  // List available voices
  fastify.get("/v1/voices", async () => {
    const voices = [];

    // Add mapped OpenAI voices
    for (const [openaiVoice, piperVoice] of Object.entries(VOICE_MAP)) {
      voices.push({ id: openaiVoice, piper_voice: piperVoice, type: "openai_mapped" });
    }

    // Add installed Piper voices
    if (existsSync(voicesDir)) {
      for (const dir of readdirSync(voicesDir)) {
        if (dir === "piper") {
          continue;
        }
        const onnxPath = join(voicesDir, dir, `${dir}.onnx`);
        if (existsSync(onnxPath)) {
          voices.push({ id: dir, type: "piper_installed" });
        }
      }
    }

    return { voices };
  });

  await fastify.listen({ port, host: "0.0.0.0" });
  console.log(`Piper TTS server running at http://0.0.0.0:${port}`);
  console.log(`OpenAI-compatible endpoint: http://localhost:${port}/v1/audio/speech`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
