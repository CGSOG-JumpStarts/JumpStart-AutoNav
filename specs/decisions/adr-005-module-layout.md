---
id: "adr-005"
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

# ADR-005: Module Layout — Strangler Intermediate + 2.0 Collapse to `src/`

> **Status:** Accepted · **Date:** 2026-04-24 · **Decision Maker:** The Architect

---

## Context

The rewrite uses strangler-fig migration: v1.x releases ship both original JS (`bin/lib/*.js`) and ported TS (path-aliased) so tests, CLI behavior, and AI-assistant IPC contracts don't break while individual modules port over. At 2.0 cutover, everything is TS and the original `bin/` tree is retired.

Two tensions:
1. Tests in `tests/test-<name>.test.js` currently `require('../bin/lib/<name>.js')`. For the strangler alias to resolve the TS port transparently, the port file must live at a path the alias can target.
2. The `src/` tree is the canonical TypeScript source location post-2.0; putting port files directly in `src/` during strangler phase conflicts with the `bin/` tree staying live.

Pit Crew Reviewer MF-4 flagged this as a contradiction between PRD E1-S1 (which said `paths: { "@lib/*": ["bin/lib-ts/*", "bin/lib/*"] }`) and architecture.md's Project Structure (which showed only `src/lib/`). Both are correct, at different phases.

---

## Decision

**Strangler-phase layout (v1.x releases):**
- Ported TS files live at `bin/lib-ts/<name>.ts` — NEW directory alongside `bin/lib/*.js`.
- `tsconfig.json` path alias: `"@lib/*": ["bin/lib-ts/*", "bin/lib/*"]` — resolver picks TS port when present, falls back to JS when not.
- `tsdown` emits `dist/lib/<name>.js` + `dist/lib/<name>.d.ts` from `bin/lib-ts/<name>.ts`.
- Tests (`tests/test-<name>.test.js`) continue importing via `require('../bin/lib/<name>.js')`. The build system makes the emitted JS available at the original path during strangler, OR tests are updated to use `@lib/<name>` alias which resolves to the ported TS.

**2.0 cutover layout:**
- `bin/lib-ts/*` → `src/lib/*` (move, not copy).
- `bin/` directory deleted wholesale (including `bin/cli.js`, `bin/lib/*.js`, `bin/lib-ts/*`).
- Path alias updated: `"@lib/*": ["src/lib/*"]` only.
- `package.json` `"bin"` entries flipped from `./bin/cli.js` → `./dist/cli.js`.

**Project Structure in `specs/architecture.md` shows the 2.0-final layout** (`src/lib/*`). The strangler-phase intermediate (`bin/lib-ts/*`) is documented here in this ADR and in the `tsconfig.json` authored by T1.1. Architecture's §Project Structure has a note pointing to this ADR for strangler-phase details.

---

## Consequences

### Positive
- Tests pass unchanged during strangler — no "rewrite tests as we go" pressure.
- Each port PR is tightly scoped to one module; the surrounding code doesn't notice the swap.
- 2.0 cutover becomes a single atomic file-rename + directory delete, not a staged migration.

### Negative
- Two intermediate paths during strangler (`bin/lib-ts/` AND `src/lib/` if anything uses the latter prematurely) is a place confusion can hide. Mitigation: **only `bin/lib-ts/` exists during strangler**; `src/lib/` does NOT exist as a source directory until T5.2 (the rename at cutover). The architecture's §Project Structure shows `src/lib/` as the post-2.0 destination, explicitly annotated.
- Path alias with two-resolution (TS first, JS fallback) requires tsconfig `paths` + tsdown `alias` to be configured in sync; drift between them = resolution surprises. Mitigation: both configured from T1.1 / T2.1 as a paired setup.

### Neutral
- This layout is the same as the Scout-identified 12-cluster taxonomy; no cluster moves cluster during the port, just filenames change extension.

---

## Alternatives Considered

### Port directly to `src/lib/`, update every test import
- **Description:** Create `src/lib/<name>.ts`; update every `tests/test-<name>.test.js` import to `require('../src/lib/<name>.js')` or equivalent.
- **Pros:** Single canonical tree from day 1.
- **Cons:** Every port PR touches 2 files (source + test); reviewer cognitive load ×2; test-import drift between ported and unported modules.
- **Reason Rejected:** Defeats the strangler-fig rule that tests stay untouched during port (the whole point of strangler is that the test contract is the ratchet).

### All-at-once big-bang move to `src/`
- **Description:** Port every module in one PR.
- **Pros:** No intermediate layout.
- **Cons:** Rejected in Phase 0 (Challenger § Strategy) as the "big-bang rewrite" anti-pattern. Incompatible with 9–12 month solo+AI execution model.
- **Reason Rejected:** Not the rewrite strategy.

### Port to `src/` during strangler + test-only alias
- **Description:** Create `src/lib/<name>.ts`; tsconfig alias routes tests to `src/lib/<name>` transparently.
- **Pros:** Cleaner source tree during strangler.
- **Cons:** Requires vitest resolve config to use the tsconfig alias at test time; vitest does this with `vite-tsconfig-paths`, but adds a configuration dependency and test-discovery mechanism that wasn't there before. Also: tests in CJS style using `require()` don't benefit from TS path aliases without additional transform.
- **Reason Rejected:** Marginally cleaner at significantly higher tooling configuration cost. The `bin/lib-ts/` intermediate is simpler and strictly-for-the-duration.

---

## References

- [specs/architecture.md ADR-005 + §Project Structure + §Existing System Context](../architecture.md#architecture-decision-records)
- [specs/prd.md E1-S1 tsconfig paths definition](../prd.md#e1--baseline-tooling--ci-foundation)
- Pit Crew Reviewer MF-4 (path contradiction resolved here)
- [specs/implementation-plan.md T1.1, T4.1.*, T5.2](../implementation-plan.md)
