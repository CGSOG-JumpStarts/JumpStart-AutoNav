---
id: "adr-007"
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

# ADR-007: IPC Envelope — Additive `"version": 1` Field + Per-Module v0/v1 Fixture Matrix

> **Status:** Accepted · **Date:** 2026-04-24 · **Decision Maker:** The Architect

---

## Context

AI coding assistants (Claude Code, Cursor, VS Code Copilot, Windsurf) consume `bin/lib/*.js` modules as subprocesses via `node bin/lib/<name>.js` with JSON on stdin and JSON on stdout. This is the non-negotiable IPC contract preserved through the rewrite.

The v1.1.14 envelope is shape-implicit: no explicit versioning. Extending the envelope safely (adding new fields, nested objects, or metadata) requires a way to signal which consumers can read which envelope shape.

---

## Decision

**At 2.0, stdin/stdout envelopes gain an additive `"version": 1` field:**

```json
// Input envelope (stdin)
{
  "version": 1,
  "input": {
    "root": ".",
    "global_path": "~/.jumpstart/config.yaml"
  }
}

// Output envelope (stdout, success)
{
  "version": 1,
  "ok": true,
  "timestamp": "2026-04-24T17:00:00Z",
  "result": { /* per-module output shape */ }
}

// Output envelope (stderr, error)
{
  "version": 1,
  "ok": false,
  "timestamp": "2026-04-24T17:00:00Z",
  "error": { "code": "VALIDATION", "message": "...", "details": {} },
  "exitCode": 2
}
```

**Backward compatibility (v0 envelope = pre-2.0):**
- Consumers that send stdin WITHOUT a `"version"` field are treated as v0 and receive a v0-shape stdout response.
- v0-shape response is functionally identical to v1 but omits the `"version"` field and `"timestamp"` in output (matching v1.1.14 behavior).
- v1 consumers receive v1-shape response.

**Per-module fixture matrix** (per Pit Crew QA Finding — Turn 2 commitment):
- Every IPC-eligible `src/lib/<name>.ts` module has committed fixtures at:
  - `tests/fixtures/ipc/<name>/v0/input.json` + `expected-stdout.json` (pre-version-field input)
  - `tests/fixtures/ipc/<name>/v1/input.json` + `expected-stdout.json` (v1 envelope)
- Fixture-replay test (PRD E4-S3, implementation-plan T4.7.4) asserts that running `node dist/lib/<name>.js` with each `input.json` on stdin produces the matching `expected-stdout.json`.
- Without this fixture pair per module, "backward-compat" is an untested claim.

**Forward-compat posture:**
- `"version": 2` would indicate a breaking change to envelope shape; accompanied by a v2 fixture set, v1 consumers continue to work, but v2 introduces new fields or semantics.
- Unknown `"version"` values in input → module responds with `{ "ok": false, "error": { "code": "UNSUPPORTED_VERSION", ... }, "exitCode": 2 }`.

---

## Consequences

### Positive
- AI-assistant consumers upgrade to v1 incrementally; no coordinated flag-day break.
- Envelope evolution has a documented path via version bump.
- Per-module fixture matrix mechanically tests backward-compat — no drift between claim and behavior.

### Negative
- Every IPC-eligible module now carries 2 fixture directories; maintenance surface grows with port count.
- `runIpc()` helper must branch on version at envelope-parse time; small complexity increase in the shared runner.
- Per-module authoring of v0 + v1 fixtures during port adds ~15 min per module; scales across ~60 IPC modules = ~15 hours additional port work.

### Neutral
- v0 envelopes remain "forever supported" by definition (AI-assistant consumers in the wild may never upgrade); this is a long-tail maintenance commitment.

---

## Alternatives Considered

### No versioning; rely on consumers to update
- **Description:** Make envelope changes freely; expect consumers to track.
- **Pros:** Zero new mechanism.
- **Cons:** Any additive change risks breaking consumers; no way to evolve the envelope safely.
- **Reason Rejected:** Defeats the backward-compat posture that is a non-negotiable constraint.

### Tagged-union discriminator on payload type
- **Description:** `{ "type": "request" | "response" | "error", ... }` with full type schema.
- **Pros:** Richer envelope; supports more message types.
- **Cons:** Overkill for stdin/stdout microservices whose consumers are AI agents, not web clients; larger breaking change for current v0 consumers.
- **Reason Rejected:** Too much change for v2.0 first-break; an integer `"version"` field is sufficient.

### Per-module schema URI
- **Description:** `{ "$schema": "https://...", ... }` in each envelope.
- **Pros:** Self-describing.
- **Cons:** Overkill; external URL dependency is a runtime liability; JSON-LD-style overhead not needed.
- **Reason Rejected:** Over-engineered.

---

## References

- [specs/architecture.md ADR-007 + §API Contracts IPC module contract](../architecture.md#architecture-decision-records)
- Pit Crew QA Finding on IPC envelope backward-compat test absence
- [specs/prd.md E4-S3 IPC envelope regression test suite](../prd.md#e4--cli-behavioral-contract-preservation)
- [specs/implementation-plan.md T4.7.4](../implementation-plan.md#stage-47--the-5359-line-monolith)
