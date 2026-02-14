# Piper TTS Server

OpenAI-compatible TTS server using [Piper](https://github.com/rhasspy/piper) for local, offline text-to-speech.

## Features

- **OpenAI API Compatible**: Drop-in replacement for `/v1/audio/speech` endpoint
- **Auto-download**: Automatically downloads Piper binary and voice models on first use
- **Voice Mapping**: Maps OpenAI voice names (alloy, echo, etc.) to Piper voices
- **Multiple Formats**: Supports mp3, wav, and pcm output
- **Cross-platform**: Works on Linux (x64/arm64) and macOS (x64/arm64)

## Quick Start

```bash
cd scripts/piper-server
pnpm install
pnpm start
```

The server starts at `http://localhost:8767`.

## Usage with OpenClaw

Add to your `openclaw.json`:

```json
{
  "env": {
    "vars": {
      "OPENAI_TTS_BASE_URL": "http://localhost:8767/v1"
    }
  },
  "messages": {
    "tts": {
      "auto": "tagged",
      "provider": "openai",
      "openai": {
        "model": "piper",
        "voice": "en_US-ryan-medium"
      }
    }
  }
}
```

## API Endpoints

### POST /v1/audio/speech

OpenAI-compatible TTS endpoint.

```bash
curl -X POST http://localhost:8767/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"input": "Hello world!", "voice": "en_US-ryan-medium"}' \
  -o output.mp3
```

**Request body:**

- `input` (required): Text to synthesize
- `voice`: Voice name (default: `en_US-ryan-medium`)
- `model`: Ignored (for OpenAI compatibility)
- `response_format`: `mp3`, `wav`, or `pcm` (default: `mp3`)
- `speed`: Ignored (for OpenAI compatibility)

### GET /v1/voices

List available voices.

### GET /health

Health check endpoint.

## Voices

### OpenAI Voice Mappings

| OpenAI Voice | Piper Voice         |
| ------------ | ------------------- |
| alloy        | en_US-amy-medium    |
| echo         | en_US-ryan-medium   |
| fable        | en_GB-alan-medium   |
| onyx         | en_US-ryan-low      |
| nova         | en_US-amy-low       |
| shimmer      | en_US-lessac-medium |

### Direct Piper Voices

Use any Piper voice directly by name:

- `en_US-ryan-medium` (male, American)
- `en_US-amy-medium` (female, American)
- `en_GB-alan-medium` (male, British)
- `de_DE-thorsten-medium` (male, German)

See all voices: https://rhasspy.github.io/piper-samples/

## Environment Variables

| Variable           | Default                       | Description            |
| ------------------ | ----------------------------- | ---------------------- |
| `PORT`             | `8767`                        | Server port            |
| `PIPER_VOICES_DIR` | `~/.local/share/piper-voices` | Voice models directory |
| `PIPER_BIN`        | (auto)                        | Path to piper binary   |

## Systemd Service

Install as a user service:

```bash
cp piper-server.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now piper-server
```

## Requirements

- Node.js 18+
- ffmpeg (for MP3 output)

## License

MIT
