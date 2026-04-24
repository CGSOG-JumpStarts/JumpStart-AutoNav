---
id: "adr-006"
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
risk_level: high
owners:
  - Samuel Combey
sha256: null
---

# ADR-006: Error Model — Typed Hierarchy with Two Allowlisted `process.exit()` Sites

> **Status:** Accepted
> **Date:** 2026-04-24
> **Decision Maker:** The Architect (Phase 3, Turn 2)

---

## Context

v1.1.14 has **204 scattered `process.exit()` calls** (77 in `bin/lib/`, 113 in `bin/cli.js`, 14 in runners — verified by Pit Crew Adversary against live codebase; the rewrite plan's earlier "184" figure undercounted). Distribution is uneven:

- **IPC-entry-guard exits** (most in `bin/lib/*.js` where each module has `if (require.main === module) { ... process.exit(...) }`): these are already terminating a subprocess invocation. Porting = move into `src/lib/ipc.ts` `runIpc()` helper. **Mechanical.**
- **Library-body exits** (e.g., `bin/lib/io.js`'s `wrapTool()` line 106 calling `process.exit(1)` inside a utility helper): these exit from deep within library code. Porting requires per-site judgment: does `wrapTool()` throw? Does every caller catch and rethrow? Does the IPC entry guard still catch the resulting throw? **NOT mechanical.**
- **CLI dispatcher exits** (113 in `bin/cli.js`): scatter inside `async main()`; most are command-handler error branches. Port = throw typed error; `main()` catches once at top level. Mechanical.

The rewrite replaces all 204 with a **typed error class hierarchy** that allows two things the scattered `process.exit()` pattern does not: (a) library-mode testability (functions throw errors; tests assert on class + fields; no subprocess spawn needed); (b) structured exit-code mapping (each error carries its `exitCode` field).

---

## Decision

**Typed error class hierarchy** in `src/errors.ts`:

```typescript
export class JumpstartError extends Error {
  exitCode: number = 99;
  phase?: number;
  artifact?: string;
}
export class GateFailureError extends JumpstartError {
  exitCode = 1;
  gate: string;
  missing: string[];
}
export class ValidationError extends JumpstartError {
  exitCode = 2;
  schemaId: string;
  issues: import("zod").ZodIssue[];
}
export class LLMError extends JumpstartError {
  exitCode = 3;
  provider: string;
  model: string;
  retryable: boolean;
}
```

**Two allowlisted `process.exit()` catch sites:**

1. `src/cli/main.ts` top-level: wraps the commander program's `.parseAsync()` in try/catch; catches `JumpstartError` subclasses and calls `process.exit(err.exitCode)`; anything else falls through to default Node crash with exit 99.
2. `src/lib/ipc.ts` `runIpc()` subprocess runner: same pattern for modules invoked as `node dist/lib/<name>.js`.

**`scripts/check-process-exit.mjs`** (Phase 0 T3.8) enforces the allowlist mechanically: greps `src/**/*.ts` + `dist/**/*.js` for `process.exit(`; allowlist contains exactly these 2 sites; CI fails on any other occurrence.

**Library-body exit decision tree** (per Pit Crew Adversary Finding 1; wrapTool() starting-point recommendation):

- **Rule:** No library utility function calls `process.exit()` directly. It throws a typed error.
- **Example — `io.js`'s `wrapTool()`**: the starting-point recommendation is for `wrapTool()` itself to throw `JumpstartError`. Callers either let it propagate (subprocess mode → caught by `runIpc()` → `process.exit(err.exitCode)`) or handle it locally (library mode → test asserts on throw; no process exit).
- **Empty-catch lint rule:** Biome's built-in `lint/suspicious/noCatchAssign` + a custom rule banning `try { ... } catch (e) { /* swallowed */ }` without either (a) rethrow, (b) log + rethrow, (c) explicit comment justifying swallow (e.g., `/* safe-ignore: optional resource cleanup */`). Prevents thrown errors from being silently eaten.

---

## Consequences

### Positive
- 204 `process.exit()` calls collapse to 2 allowlisted sites; the other 202 become throws.
- Tests can catch typed errors without subprocess spawning — massive testability improvement.
- Error type narrowing in TypeScript: `if (err instanceof ValidationError) { err.issues /* typed */ }` works without casts.
- Centralized exit-code taxonomy: every error maps to a semantic code (1 = gate failure, 2 = invalid input, 3 = LLM failure, 99 = unknown).

### Negative
- Per-site porting judgment for library-body exits (77 in `bin/lib/`) — not mechanical for all sites. Estimated ~30 minutes of decision time per affected module on average.
- Empty-catch lint rule may flag existing defensive patterns that are legitimate (e.g., retry-then-give-up loops); each flagged site requires explicit annotation.
- Testing infrastructure must grow to assert on error class + fields instead of stderr strings.

### Neutral
- `process.exit()` with a non-zero code remains the subprocess-to-shell contract; the architecture change is WHERE the exit happens (allowlisted 2 sites), not THAT it happens.

---

## Alternatives Considered

### Result<T, E> (functional-style)
- **Description:** Every function returns `{ ok: true; value: T } | { ok: false; error: E }`; no thrown errors.
- **Pros:** Forces every caller to handle the error branch; no hidden control flow.
- **Cons:** Verbose for a CLI whose errors predominantly terminate the invocation; requires chain-style threading through every call site.
- **Reason Rejected:** The exit-code semantics of a CLI make "throw + single top-level catch" the simpler model. Result<T,E> is better for libraries where errors are routinely recoverable.

### Status-quo scattered `process.exit()` (no change)
- **Description:** Each module exits independently.
- **Pros:** No migration work.
- **Cons:** Defeats library-mode testability; can't type-narrow; no structured error info.
- **Reason Rejected:** Baseline verification found that this pattern hid `SimulationTracer` 12-vs-4 drift for months — there's no motivation to preserve it.

### Single catch site (CLI main.ts only, no IPC runner)
- **Description:** Only `src/cli/main.ts` catches; IPC modules somehow bubble errors to it.
- **Pros:** One canonical site.
- **Cons:** IPC modules are invoked as separate processes; there is no shared call stack to bubble to. A single catch site is structurally impossible given the dual-mode library+subprocess pattern.
- **Reason Rejected:** Physical impossibility.

---

## References

- [specs/architecture.md ADR-006 summary](../architecture.md#architecture-decision-records)
- [specs/architecture.md § Security NFR-R04](../architecture.md#nfr-thresholds--explicit-passfail-values-per-pit-crew-reviewer-mf-2)
- Pit Crew Turn 1 Adversary Finding 1 (wrapTool per-site judgment)
- Pit Crew Turn 1 verification — error-hierarchy starting-point recommendation added to this ADR
- [specs/implementation-plan.md T3.8 + T4.1.8 ipc.ts authoring](../implementation-plan.md#milestone-2-m1--contract-drift-detection-infrastructure-stage-3)
- [specs/prd.md E2-S7 process-exit enforcement script](../prd.md#e2--contract-drift-detection-infrastructure)
