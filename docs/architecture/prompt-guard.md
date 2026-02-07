# Prompt Guard Architecture

Sera-ai includes a multi-layer prompt injection defense system that protects against attacks from various content sources.

## Overview

```
┌─────────────────────────────────────────────────────┐
│                 Input Sources                        │
├───────────┬──────────┬──────────┬──────────┬────────┤
│  User Msg │ Web Fetch│  Email   │  Files   │  API   │
└─────┬─────┴────┬─────┴────┬─────┴────┬─────┴───┬────┘
      │          │          │          │         │
      ▼          ▼          ▼          ▼         ▼
┌─────────────────────────────────────────────────────┐
│              Prompt Guard Scanner                    │
│  • Pattern matching (multi-language)                 │
│  • Invisible character detection                     │
│  • Trust score calculation                           │
│  • Severity classification                           │
└────────────────────────┬────────────────────────────┘
                         │
            ┌────────────┴────────────┐
            │                         │
            ▼                         ▼
    ┌──────────────┐         ┌──────────────┐
    │    SAFE      │         │  SUSPICIOUS  │
    │   Continue   │         │  Log + Warn  │
    │              │         │  or Block    │
    └──────────────┘         └──────────────┘
```

## Threat Levels

| Level    | Description                | Default Action |
| -------- | -------------------------- | -------------- |
| SAFE     | Normal content             | Allow          |
| LOW      | Minor suspicious pattern   | Log only       |
| MEDIUM   | Clear manipulation attempt | Warn + Log     |
| HIGH     | Dangerous invisible chars  | Block + Log    |
| CRITICAL | Injection pattern detected | Block + Notify |

## Trust Scores

Content trust is calculated based on source:

| Source        | Base Trust | Notes                          |
| ------------- | ---------- | ------------------------------ |
| user_message  | 0.9        | Direct from authenticated user |
| file_content  | 0.6        | Depends on path                |
| email_subject | 0.5        | More visible                   |
| api_response  | 0.5        | Depends on API                 |
| email_body    | 0.4        | Common attack vector           |
| clipboard     | 0.4        | Unknown origin                 |
| pdf_extract   | 0.4        | Can be crafted                 |
| web_fetch     | 0.3        | Anyone can publish             |
| image_ocr     | 0.3        | Easily manipulated             |
| unknown       | 0.2        | Treat with caution             |

## Detection Capabilities

### 1. Invisible Character Detection

Detects 40+ invisible Unicode characters including:

- Zero-width spaces (U+200B)
- Right-to-left override (U+202E) - **DANGEROUS**
- Left-to-right override (U+202D) - **DANGEROUS**
- Byte order mark (U+FEFF)
- Various directional formatting characters

### 2. Multi-Language Pattern Detection

Detects injection attempts in:

- English: "ignore all previous instructions"
- Korean: "이전 지시 무시해"
- Japanese: "前の指示を無視して"
- Chinese: "忽略之前的指令"

### 3. Attack Vector Coverage

**Direct Injection:**

- Instruction override attempts
- Role manipulation
- System impersonation
- Jailbreak attempts
- Secret/credential requests

**Indirect Injection:**

- Web content with hidden instructions
- Email phishing patterns
- File content injection via comments
- Base64 encoded payloads

## Usage

### TypeScript API

```typescript
import {
  scanContent,
  scanContentSync,
  guardContent,
  formatScanSummary,
} from "./security/prompt-guard.js";

// Synchronous scan (fast, inline patterns only)
const result = scanContentSync(content, "web_fetch");

if (result.threatLevel === "CRITICAL") {
  console.log("Blocked:", result.detections);
}

// Async scan (uses Python scanner if available)
const fullResult = await scanContent(content, "email_body", {
  sender: "user@example.com",
});

// Guard with automatic blocking
const guarded = await guardContent(content, "web_fetch", {
  blockOnCritical: true,
  blockOnHigh: false,
});

if (guarded.blocked) {
  return { error: guarded.blockReason };
}
```

### Integration with External Content

The `wrapExternalContent` function automatically scans content:

```typescript
import { wrapExternalContent } from "./security/external-content.js";

// Content is scanned, invisible chars removed, annotations added
const wrapped = wrapExternalContent(emailBody, {
  source: "email",
  sender: "user@example.com",
  subject: "Help request",
});
```

## Python Scanner

When the Python scanner is available (`~/clawd/skills/prompt-guard/scripts/content_scanner.py`), the TypeScript module delegates to it for more comprehensive detection. The Python scanner includes:

- 40+ invisible character definitions
- Expanded multi-language patterns
- Source-specific attack patterns (web, email, file)
- Automatic logging to `memory/content-scan-log.md`

## CLI Usage

```bash
# Add to PATH
export PATH="$HOME/clawd/skills/prompt-guard/scripts:$PATH"

# Scan text
guard scan "Hello world"

# Scan web content
curl -s https://example.com | guard web https://example.com

# Scan email
echo "Email body" | guard email "Subject" "sender@example.com"

# Scan file
guard file /path/to/document.txt

# View stats
guard stats
```

## Configuration

The scanner can be configured via `~/clawd/skills/prompt-guard/config.yaml`:

```yaml
prompt_guard:
  sensitivity: medium # low, medium, high, paranoid
  block_on_critical: true
  block_on_high: false
  warn_on_medium: true

  trusted_paths:
    - "/home/user/workspace/"

  logging:
    enabled: true
    path: memory/content-scan-log.md
```

## Security Logging

All detections are logged to `memory/security-log.md` with:

- Timestamp
- Threat level
- Source type
- Detection patterns matched
- Fingerprint for deduplication

## Files

```
src/security/
├── prompt-guard.ts       # TypeScript scanner
├── prompt-guard.test.ts  # Tests (24 tests)
├── external-content.ts   # Content wrapping (uses prompt-guard)
└── external-content.test.ts

~/clawd/skills/prompt-guard/scripts/
├── guard                 # CLI wrapper
├── detect.py             # Core detection engine
├── content_scanner.py    # Multi-source scanner
├── guard_hooks.py        # Integration hooks
└── test_guard.py         # Python tests (25 tests)
```
