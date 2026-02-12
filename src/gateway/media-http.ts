/**
 * HTTP handler for serving media files (TTS audio, etc.)
 * Only serves files from allowed temp directories for security.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const MEDIA_PATH_PREFIX = "/media/";

// Only allow serving files from these temp directory prefixes
const ALLOWED_PREFIXES = [
  path.join(tmpdir(), "tts-"),
  path.join(tmpdir(), "openclaw-media-"),
];

const MIME_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".opus": "audio/opus",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
};

function isAllowedPath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  return ALLOWED_PREFIXES.some((prefix) => resolved.startsWith(prefix));
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

/**
 * Handle GET /media/* requests to serve TTS audio files.
 * File path is base64url-encoded after /media/.
 */
export function handleMediaHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const url = new URL(req.url ?? "/", "http://localhost");
  
  if (!url.pathname.startsWith(MEDIA_PATH_PREFIX)) {
    return false;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Method Not Allowed");
    return true;
  }

  // Extract and decode the file path (base64url encoded)
  const encodedPath = url.pathname.slice(MEDIA_PATH_PREFIX.length);
  if (!encodedPath) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Missing file path");
    return true;
  }

  let filePath: string;
  try {
    // Decode base64url (replace - with + and _ with /)
    const base64 = encodedPath.replace(/-/g, "+").replace(/_/g, "/");
    filePath = Buffer.from(base64, "base64").toString("utf-8");
  } catch {
    res.statusCode = 400;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Invalid file path encoding");
    return true;
  }

  // Security: only allow files from temp TTS directories
  if (!isAllowedPath(filePath)) {
    res.statusCode = 403;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Access denied");
    return true;
  }

  // Check file exists and get size
  let stat;
  try {
    stat = statSync(filePath);
    if (!stat.isFile()) {
      throw new Error("Not a file");
    }
  } catch {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("File not found");
    return true;
  }

  const mimeType = getMimeType(filePath);
  res.statusCode = 200;
  res.setHeader("Content-Type", mimeType);
  res.setHeader("Content-Length", stat.size);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=300");

  if (req.method === "HEAD") {
    res.end();
    return true;
  }

  const stream = createReadStream(filePath);
  stream.pipe(res);
  stream.on("error", () => {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
    }
    res.end("Error reading file");
  });

  return true;
}

/**
 * Convert a local file path to a /media/ URL.
 * Returns null if the path is not in an allowed directory.
 */
export function filePathToMediaUrl(filePath: string): string | null {
  if (!isAllowedPath(filePath)) {
    return null;
  }
  // Base64url encode the path
  const encoded = Buffer.from(filePath, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${MEDIA_PATH_PREFIX}${encoded}`;
}
