---
id: "adr-012"
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

# ADR-012: Secrets Redaction in `usage-log.json` and `state/timeline.json`

> **Status:** Accepted · **Date:** 2026-04-24 · **Decision Maker:** The Architect

---

## Context

`.jumpstart/usage-log.json` and `.jumpstart/state/timeline.json` are append-only local logs tracking CLI invocations + phase-gate activity. Both record metadata derived from `process.argv`, including command names, flags, and positional arguments.

If a user invokes the CLI with a secret as an argument — e.g., `jumpstart-mode configure --api-key sk-abc123xyz` — that secret lands in `usage-log.json` as part of the invocation record. On re-open, log export, or accidental commit of `.jumpstart/state/*.json` to version control, the secret leaks.

Pit Crew QA Security Audit SEC-006: **MEDIUM severity**. The existing `bin/lib/secret-scanner.js` module scans artifacts (spec `.md` files) for credential patterns, but NOT log-write paths. The gap is specifically that the secret-scanner isn't invoked before persisting argv-derived fields.

---

## Decision

**`src/lib/timeline.ts` and `src/lib/usage.ts` log-write paths MUST invoke a secrets-scanning + redaction step BEFORE persisting any `argv`-derived field.**

Implementation:

```typescript
import { scanForSecrets, type SecretMatch } from "./secret-scanner.js";

/**
 * Redacts secrets from a string or structured object prior to log-write.
 * Returns a new value with detected credentials replaced by `[REDACTED:<pattern-name>]`.
 */
export function redactSecrets<T>(value: T): T {
  if (typeof value === "string") {
    const matches = scanForSecrets(value);
    if (matches.length === 0) return value;
    let redacted = value;
    for (const match of matches) {
      redacted = redacted.slice(0, match.start) +
                 `[REDACTED:${match.patternName}]` +
                 redacted.slice(match.end);
    }
    return redacted as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map(redactSecrets) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactSecrets(v);
    }
    return out as unknown as T;
  }
  return value;
}

// Applied at every log write:
export function logTimelineEvent(event: TimelineEvent) {
  const redacted = redactSecrets(event);
  appendToTimelineFile(redacted);
}
```

**Pattern catalog** (exact list from existing `secret-scanner.js` extended):
- OpenAI API keys (`sk-[a-zA-Z0-9]{20,}`)
- Anthropic API keys (`sk-ant-[a-zA-Z0-9-]{20,}`)
- GitHub tokens (`ghp_[a-zA-Z0-9]{36,}`, `github_pat_[a-zA-Z0-9_]{82,}`)
- Generic high-entropy strings in fields named `api_key`, `token`, `secret`, `password`, `auth`, `bearer`
- AWS access keys (`AKIA[0-9A-Z]{16}`) + secret keys (40-char base64)
- Generic `--api-key ...`, `--token ...`, `--password ...` argv patterns

**Format**: `[REDACTED:<pattern-name>]` — the pattern name identifies WHAT was matched but never reveals any part of the original secret.

**End-to-end test** (Turn 2):
- `tests/fixtures/security/secrets-redaction/` with seeded fixtures:
  - CLI invocation with `--api-key sk-fake-value-do-not-use` → log entry contains `[REDACTED:openai-api-key]`, NOT `sk-fake-...`
  - CLI invocation with a normal arg `--target ./specs/foo.md` → log entry contains `./specs/foo.md` unchanged
  - Timeline event with nested object `{ auth: { token: "ghp_fakevalue" } }` → persisted as `{ auth: { token: "[REDACTED:github-token]" } }`
- CI gate: assert `grep -r "sk-[a-zA-Z0-9]{20,}" .jumpstart/state/*.json .jumpstart/usage-log.json` returns no matches after test run.

**Recursive structures**: `redactSecrets` walks nested objects and arrays; no depth limit (cycles not expected in log events; if they appear, a `WeakSet` cycle-detector is added).

---

## Consequences

### Positive
- Closes the MEDIUM-severity secret-leak vector through local logs.
- Uses the existing `secret-scanner.js` pattern library; no new regex duplication.
- Redaction is end-to-end testable via seeded secrets.
- Format `[REDACTED:<pattern-name>]` preserves the log's diagnostic value (pattern name indicates what kind of credential) without leaking content.

### Negative
- Every log-write path adds a redaction pass; O(N) on event size but N is small (events are small JSON).
- False negatives possible: any secret not matching a pattern escapes redaction. Mitigation: pattern catalog maintained as a live document, expanded when new patterns are observed.
- False positives possible: legitimate strings that match a high-entropy regex get redacted. Acceptable cost (false positive = degraded debug output; false negative = secret leak).

### Neutral
- Logs remain readable; only matched secrets are redacted, not entire records.
- The `secret-scanner.js` module is already ported in cluster C (M3) — ADR-012 adds a call site in cluster H (M4 timeline/usage modules).

---

## Alternatives Considered

### Strip all argv from logs (conservative)
- **Description:** Don't log argv at all; only log subcommand name.
- **Pros:** Zero secret leak risk by construction.
- **Cons:** Loses the diagnostic value of "what invocation led to this outcome?" which is exactly what usage-log + timeline exist to capture.
- **Reason Rejected:** Over-corrects; redaction preserves the debugging use case.

### Allowlist-based: only log specific safe fields
- **Description:** Maintain a per-command allowlist of argv fields that are safe to log.
- **Pros:** Positive-security posture.
- **Cons:** Maintenance burden scales with subcommand count (120+); new fields get added and forgotten.
- **Reason Rejected:** Blocklist-based redaction with a good pattern catalog is simpler and catches the common cases.

### Encrypt logs at rest
- **Description:** Encrypt `.jumpstart/usage-log.json` with a user-supplied key.
- **Pros:** Even a file exfiltration doesn't leak secrets.
- **Cons:** Key management complexity; encryption-at-rest is out of scope for a developer tooling CLI; downstream tooling reading the logs would need the key.
- **Reason Rejected:** Over-engineered; blocklist redaction is proportionate.

---

## References

- [specs/architecture.md ADR-012 + §Security SEC-006](../architecture.md#specific-high-severity-mitigations-per-pit-crew-qa-security-audit-integrated-turn-1)
- Pit Crew QA Security Audit Part 2 Finding 4 (MEDIUM severity)
- Existing `bin/lib/secret-scanner.js` — pattern catalog source
- [specs/implementation-plan.md T4.3.3 (H cluster port — timeline, usage, project-memory)](../implementation-plan.md#stage-43--llm--state--ux-clusters-30-modules)
