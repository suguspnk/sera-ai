# Security Audit Report - sera-ai (OpenClaw Fork)

**Date:** 2026-02-08  
**Version:** 2026.2.6-3  
**Auditor:** Sera (AI Assistant)

---

## Executive Summary

The sera-ai codebase inherits OpenClaw's security architecture, which includes several good security practices but has areas for improvement. This audit identified **3 critical**, **5 high**, and **7 medium** priority findings.

---

## Findings

### 🔴 CRITICAL

#### C1: `eval()` Usage in Browser Tools

**Location:** `src/browser/pw-tools-core.interactions.ts`

```typescript
var candidate = eval("(" + fnBody + ")");
```

**Risk:** Remote code execution if `fnBody` is attacker-controlled.
**Recommendation:** Replace with `new Function()` with strict input validation, or use a sandboxed evaluator like `vm2` or `isolated-vm`.

#### C2: Shell Command Execution (1,247 instances)

**Locations:** Multiple files using `exec`, `spawn`, `execSync`, `spawnSync`
**Risk:** Command injection if user input flows into shell commands.
**Current Mitigation:** Some sanitization exists in `src/plugins/commands.ts`
**Recommendation:**

- Audit all 1,247 exec calls for input sources
- Prefer array-based spawn over shell strings
- Implement strict command allowlisting

#### C3: Gateway Token in Environment Variables

**Location:** `src/node-host/runner.ts`, systemd service
**Risk:** Token exposed in process listings, logs, and environment dumps.
**Recommendation:** Use file-based token storage with strict permissions (mode 0600).

---

### 🟠 HIGH

#### H1: No CORS/Helmet Protection

**Finding:** No CORS headers or security headers (helmet) found in gateway HTTP server.
**Location:** `src/gateway/server-http.ts`
**Risk:** Potential for CSRF, clickjacking, and cross-origin attacks.
**Recommendation:** Add helmet middleware with CSP, HSTS, X-Frame-Options.

#### H2: No Rate Limiting on API Endpoints

**Finding:** Only Discord API rate limits are handled (reactively).
**Risk:** DoS attacks, brute force, resource exhaustion.
**Recommendation:** Implement rate limiting on:

- Gateway WebSocket connections
- Tool execution endpoints
- Authentication attempts

#### H3: Sensitive Data in Logs

**Finding:** Tokens passed through various functions may be logged.
**Risk:** Token leakage in log files.
**Recommendation:** Implement log redaction for sensitive patterns (tokens, passwords, API keys).

#### H4: Path Traversal Risk

**Finding:** Multiple `fs.read*` operations without path canonicalization checks.
**Locations:** `src/plugins/discovery.ts`, `src/memory/manager.ts`
**Risk:** Reading files outside intended directories.
**Recommendation:** Validate all paths resolve within expected directories using `path.resolve()` and prefix checks.

#### H5: No JWT/Session Expiry

**Finding:** Gateway tokens appear to be static/long-lived.
**Risk:** Token compromise has unlimited exposure window.
**Recommendation:** Implement token rotation and expiry mechanisms.

---

### 🟡 MEDIUM

#### M1: Prompt Injection Protection (Partial)

**Finding:** Good patterns in `src/security/external-content.ts` but not universally applied.
**Current State:**

- ✅ SUSPICIOUS_PATTERNS detection
- ✅ External content wrapping
- ⚠️ Not applied to all input sources
  **Recommendation:** Ensure ALL external inputs (Discord, WhatsApp, webhooks) route through `wrapExternalContent()`.

#### M2: Plugin Security Model

**Finding:** Plugins can register tools with broad capabilities.
**Location:** `src/plugins/`
**Risk:** Malicious plugins could execute arbitrary code.
**Recommendation:**

- Plugin signature verification
- Capability-based permissions
- Sandbox plugin execution

#### M3: No Input Validation Schema

**Finding:** Many tool parameters lack strict validation beyond TypeBox types.
**Risk:** Malformed input causing unexpected behavior.
**Recommendation:** Add runtime validation with detailed error messages.

#### M4: Credentials in Config Files

**Finding:** Tokens stored in JSON config files.
**Location:** `~/.openclaw/clawdbot.json`
**Risk:** Config file access exposes all credentials.
**Recommendation:**

- Use OS keychain where available
- Encrypt sensitive config sections

#### M5: No Audit Logging

**Finding:** No structured audit trail for security-relevant events.
**Risk:** Difficult to detect/investigate breaches.
**Recommendation:** Implement structured audit logging for:

- Authentication events
- Tool executions
- Configuration changes
- Permission changes

#### M6: Insecure Default Permissions

**Finding:** Some files created without explicit permissions.
**Risk:** Other users on shared systems could read sensitive data.
**Recommendation:** Always specify mode 0600 for sensitive files.

#### M7: Missing HTTPS Enforcement

**Finding:** HTTP URLs allowed for some services (Signal, Canvas).
**Risk:** Man-in-the-middle attacks on local network.
**Recommendation:** Default to HTTPS with option to explicitly allow HTTP for localhost only.

---

## Existing Security Strengths

✅ **Prompt injection awareness** - `external-content.ts` has good patterns  
✅ **Allowlist/Denylist system** - Plugins and tools can be restricted  
✅ **Command argument sanitization** - `sanitizeArgs()` in commands.ts  
✅ **Untrusted content handling** - Channel metadata marked as untrusted  
✅ **Security audit module** - `src/security/audit.ts` exists  
✅ **Windows ACL checks** - Platform-specific security for Windows

---

## Improvement Proposals

### Proposal 1: Security Middleware Layer

Create `src/security/middleware.ts`:

- Rate limiting (per-session, per-IP)
- Request validation
- Security headers
- Audit logging

### Proposal 2: Secrets Management

Create `src/security/secrets.ts`:

- OS keychain integration (keytar)
- Encrypted file fallback
- Token rotation support
- Never log secrets

### Proposal 3: Enhanced Exec Safety

Create `src/security/exec-guard.ts`:

- Command allowlist validation
- Input sanitization pipeline
- Execution context isolation
- Audit trail for all exec

### Proposal 4: Universal Input Sanitization

Extend `src/security/external-content.ts`:

- Apply to ALL channel inputs
- Add content length limits
- Unicode normalization
- Homoglyph detection

### Proposal 5: Runtime Security Monitor

Create `src/security/monitor.ts`:

- Track suspicious patterns in real-time
- Alert on anomalous behavior
- Auto-block repeated injection attempts
- Security event dashboard

---

## Recommended Priority

1. **Immediate (This Week):**
   - C1: Remove/secure eval usage
   - H1: Add security headers
   - H2: Implement rate limiting

2. **Short-term (This Month):**
   - C2: Audit exec calls
   - C3: Secure token storage
   - H3: Log redaction
   - M5: Audit logging

3. **Medium-term (This Quarter):**
   - H4: Path traversal fixes
   - H5: Token expiry
   - M1-M7: Remaining medium issues

---

## Conclusion

The sera-ai codebase has a reasonable security foundation but needs hardening for production use. The critical `eval()` usage and extensive shell execution are the highest priority items. Implementing the proposed security middleware layer would address multiple findings simultaneously.
