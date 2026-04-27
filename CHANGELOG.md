# Changelog

All notable changes to `jumpstart-mode` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — Phase 4 / Developer M0 + M1 + M2 (Tooling + Detection + Leaf Ports)

In progress. M0 establishes the TypeScript toolchain. M1 adds the cross-module contract harness and other detection-infrastructure gates. M2 begins porting leaf utilities into TypeScript using the full 11-step per-module recipe — first port: `bin/lib-ts/io.ts`.

### M2 — T4.1.2 hashing.ts (second leaf port, sub-commit 8)
- `bin/lib-ts/hashing.ts` — pure-TS port of `bin/lib/hashing.js` (6 exports: `hashFile`, `hashContent`, `loadManifest`, `saveManifest`, `registerArtifact`, `verifyAll`). Behavior is byte-identical to the legacy module: same SHA-256 hex output, same manifest schema (`{ version, generated, lastUpdated?, artifacts }`), same throw semantics on fs / JSON-parse failures, same pre-rendered `summary` string format that downstream tools grep.
- New named types added to the public surface: `Manifest`, `ArtifactEntry`, `RegisterResult`, `TamperedArtifact`, `VerifyResult` — they replace the legacy module's untyped object returns.
- `tests/test-hashing.test.ts` — first dedicated test corpus for the module (legacy shipped untested). 17 tests across 5 describe blocks: SHA-256 known vectors (empty + `'abc'`), `hashFile` / `hashContent` parity, `loadManifest` create-on-missing + parse-on-existing, `saveManifest` round-trip + `lastUpdated` mutation, `registerArtifact` first-time / unchanged / changed cases, `verifyAll` clean / tampered / missing / mixed cases pinning the human-readable summary strings verbatim.
- `tsdown.config.ts` adds `bin/lib-ts/hashing.ts`. All 11 verify-baseline gates **PASS**. Test count: **90 / 2028** (+1 file / +17 tests).

### M2 — T4.1.1 io.ts (first leaf-utility port, sub-commit 7)
- `bin/lib-ts/io.ts` — pure-TS port of `bin/lib/io.js` (5 exports: `readStdin`, `writeResult`, `writeError`, `wrapTool`, `parseToolArgs`). Successful-path output is byte-identical to the legacy module: `{ "ok": true, "timestamp": "...", ...result }` for results; `{ "ok": false, "timestamp": "...", "error": { code, message, ...details } }` for errors. Field ordering preserved verbatim so v0 IPC consumers parse identically.
- **Documented behavior change** (the only one): `writeError(exit=true)` and `wrapTool(handler)` no longer call `process.exit(1)` on error. They throw `JumpstartError` instead, per ADR-006's library-body decision tree. The rethrow is opt-in: legacy `bin/lib/io.js` stays untouched, so every existing JS caller still gets the exit-based contract. A caller migrates by switching `require('./io.js')` → `import from '@lib/io'`. The eventual `runIpc()` (M5) catches typed errors and translates them to exit codes (`ValidationError` → 2, `LLMError` → 3, other `JumpstartError` → 99). Tested explicitly: `process.exit` spy must NOT be called when `wrapTool` handles a thrown error.
- `tests/test-io.test.ts` — 16 tests across 5 describe blocks: `writeResult` envelope shape (including pretty-print + caller-field shadowing), `writeError` envelope + no-exit assertion, `readStdin` TTY short-circuit, `parseToolArgs` parity (6 cases), `wrapTool` success + error-throw + `JumpstartError` subclass preservation.
- `tsdown.config.ts` adds `bin/lib-ts/io.ts` to `entry`. `check-dist-exports` verifies the d.mts surface; `check-public-any` confirms zero `any` in exports; `check-return-shapes` clean. Cross-module contract harness reports zero new drift.
- All 11 verify-baseline gates **PASS**. Test count: **89 files / 2011 tests / 4.7s** (+1 file / +16 tests since M1 closeout).

### Added
- `tsconfig.json` with strict mode + `allowJs: true` + NodeNext module resolution + `@lib/*` path alias resolving `bin/lib-ts/*` first then `bin/lib/*` (strangler-fig pattern, see ADR-005).
- `biome.json` v2.4.13 config with `lint/suspicious/noExplicitAny: error`, type-aware linting, JS/TS scope.
- `tsdown.config.ts` pinned at `tsdown@0.21.10` exact (see ADR-001) emitting ESM + `.d.ts` + source maps.
- `bin/lib-ts/_smoke.ts` toolchain canary module (deleted once first real port lands).
- `tests/test-paths-alias-smoke.test.ts` — T1.1 acceptance gate; verifies path-alias resolution + strict-mode compilation.
- `tests/test-build-smoke.test.ts` — T2.1 acceptance gate; verifies tsdown produces `dist/*.mjs` + `.d.mts` + sourcemap and the output is importable.
- New devDependencies: `typescript@^5.6`, `@types/node@^24`, `@biomejs/biome@^2.4.13`, `tsdown@0.21.10`, `json-schema-to-zod@^2.6.0`.
- New npm scripts: `build`, `typecheck`, `lint`, `lint:fix`, `format`, `check:public-any`, `check:process-exit`, `check:coverage-ratchet`, `verify-baseline`.

### Changed
- `vitest.config.js` `include` pattern expanded from `tests/**/*.test.js` to `tests/**/*.test.{js,ts}` to discover ported TS tests under the strangler alias; coverage `include` extended to cover `bin/lib-ts/**/*.ts` and `scripts/**/*.mjs`.
- `yaml` runtime dep bumped from `^2.8.1` to `^2.8.3` (CVE-2026-33532 patched).

### Engineering trail
This release is the first commit set produced by the **Phase 4 / Developer** persona executing `specs/implementation-plan.md`. M0 establishes the TypeScript toolchain without changing any user-visible CLI behavior. Test ratchet preserved: `npm test` reports **85 files / 1937 assertions** green (+2 files, +7 assertions: 3 from `test-paths-alias-smoke.test.ts` + 4 from `test-build-smoke.test.ts`).

### M1 — Pit Crew remediation (sub-commit 6)
Three Pit Crew agents (Reviewer, QA, Adversary) ran in parallel against M1 sub-commits 1+5 and returned **27 findings (9 BLOCKER + 11 HIGH + 7 MED).** Adversary delivered running-code-confirmed exploit POCs for 5 of the BLOCKERs. This sub-commit closes 23 findings; the remaining 4 are deferred with explicit Deviation Log entries.

**Closed (BLOCKERs and HIGHs):**
- `scripts/extract-public-surface.mjs`: SCAN_ROOTS reversed to `['bin/lib-ts','bin/lib']` so TS port wins during dual-existence (Rev B1). Per-call-site instantiation map replaces flat last-write-wins, fixing variable-reassignment false positives (QA 4 / Rev M1) — verified by new `tests/fixtures/contract-drift/reassignment-no-drift/`. TS extractor now mirrors the JS extractor's selective class-property semantics (only callable initializers count as methods, Rev H2) and handles `let x: T; x = new T()` reassignment (Rev H3). DoS guards: 5,000-call-site-per-file cap + parse errors emitted as typed `parse_error` incidents instead of silently skipped (Adv 5). Empty-default-roots false-green guard (QA 3).
- `bin/lib-ts/path-safety.ts`: `assertString` early-guard converts `TypeError` on non-string input into `ValidationError(exitCode 2)` per ADR-006 (QA 1). All `realpathSync` errors (ELOOP, EACCES, ENOTDIR) are wrapped as `ValidationError` instead of bubbling raw (Rev H1 / Adv 4 + 6). TODO references for ADR-012 (secrets-redaction in error messages) and ADR-013 (mandatory `safeReadFile` wrappers for full symlink defense, Adv 3).
- `scripts/check-process-exit.mjs`: layered 6-pattern check defeats the indirection bypasses Adversary's POC confirmed (`process['exit']`, alias `const f = process.exit`, named import, namespace import, destructure). All 5 bypass attempts caught in test (Adv 1). AST-based replacement deferred to M2 alongside the first port (Deviation Log).
- `scripts/count-drift-catches.mjs`: `Object.create(null)` accumulators kill the prototype-pollution exploit Adversary ran (Adv 2). `POISON_KEYS` set for defense-in-depth. Malformed JSON inputs are skipped + warned, not crashed; `status: 'ok' | 'partial' | 'no-inputs'` field distinguishes legitimate clean weeks from upstream-failure weeks (Rev H5). Exit-1 when explicit inputs are all unusable.
- `.github/workflows/metrics-cron.yml`: rollup step reordered to aggregate the snapshots/ directory AFTER the worktree is mounted, so `regression-share.json` reflects the trailing window — not just the single fresh snapshot (Rev B2). Worktree path uses `mktemp -d` to defeat predictable-path race attacks if migration to self-hosted runners ever happens (Adv 7). `git config --local` for scope safety.
- `vitest.config.js`: bin/lib fallback alias added so `@lib/<name>` resolves correctly even for not-yet-ported modules (Rev M2).
- `tsdown.config.ts`: `bin/lib-ts/errors.ts` and `bin/lib-ts/path-safety.ts` added to `entry`; T3.9 Tier 2 dormant tests will activate automatically at M5 instead of needing a follow-up edit (Rev M4).

**Test coverage adds (+58 tests):**
- `tests/test-public-surface.test.ts`: 4 tests (was 2). Drops magic-number floors that would false-fail at M5-M8 (Rev H4'). Set equality for missing-method names (QA 9). Reassignment-no-drift regression canary. Empty-scan handling (QA 3).
- `tests/test-path-safety.test.ts`: 47 tests (was 22). Non-string input gauntlet (QA 1, 6 cases × ValidationError). Empty/dot/tilde policy pinned + documented (QA 2). Layer 1↔Layer 2 parity test across 9 inputs (QA 5). Multi-level round-trip + dot-mid-segment in negative-space (QA 12).
- `tests/test-count-drift-catches.test.ts` (NEW, 7 tests): smoke + math (50% regression-share for 2-run mix), multi-input directory walk, malformed-JSON skip, no-inputs exit-1, prototype-pollution defense for `toString`/`__proto__`/`constructor`/`prototype` keys.

**Deferred with Deviation Log entries:**
- AST-based check-process-exit replacement (M2 alongside first port)
- ADR-013 `safeReadFile`/`safeStat` family for full symlink defense (M5 with IPC port)
- Boundary-root case-sensitivity edge case (folded into ADR-013)
- Dead-code branch in path-safety boundary-realpath catch (intentional — becomes reachable when `runIpc` envelope is misconfigured)

`verify-baseline.mjs` reports **11/11 PASS** post-remediation. Test count: **88 files / 1995 tests / 4.0s** (+1 file, +34 tests since sub-commit 5).

### M1 — Detection coverage completion (T3.6 + T3.7, sub-commit 5)
- `scripts/check-return-shapes.mjs` (T3.6) — AST linter using TypeScript Compiler API. Walks `dist/**/*.d.ts`, flags exported functions/methods whose return type is an inline object literal with **>2 fields** that should be a named type instead. Unwraps `Promise<T>` / `Awaited<T>` so async functions get checked against their resolved shape. Dormant on M1's tiny dist (only `_smoke.d.mts`); activates as ports add fatter return shapes.
- `scripts/count-drift-catches.mjs` (T3.7 input aggregator) — rollup of one or more contract-harness drift reports (`drift-catches.json`) into a `regression-share.json` summary with windowStart/windowEnd, totalRuns, totalIncidents, runsWithIncidents, regressionShare ratio, incidents-by-type, top-10 most-drifted classes.
- `.github/workflows/metrics-cron.yml` (T3.7 cron) — Mondays 06:30 UTC. Checks out main, runs the harness, runs the rollup, publishes snapshots to a long-lived `metrics` branch (creates it if absent), and uploads the same JSONs as a 365-day workflow artifact. Runs after Dependabot's 06:00 cycle so weekly version-bump churn is settled before metrics snapshot.
- New npm script: `check:return-shapes`.
- `verify-baseline.mjs` now runs **11 gates** (was 10), all PASS.

### M1 — Path-safety primitives (T3.9 Blocker for M2, sub-commit 4)
- `bin/lib-ts/path-safety.ts` — Zod-refinement-based `safePathSchema(boundaryRoot)` factory + `assertInsideRoot(p, root, opts?)` helper. Both throw `ValidationError` with `exitCode: 2` per ADR-006. Defends against: `..` traversal, absolute paths, sneaky `./a/../b`, null-byte injection (U+0000 truncation attack), Windows drive-letter paths (`C:\\…`) and backslash traversal — even on POSIX hosts where `\\` is a regular filename character — and (with `followSymlinks: true`) symlinks resolving outside the boundary. Layer 1 (Zod) is lexical; layer 2 (helper) optionally follows symlinks.
- `bin/lib-ts/errors.ts` — minimal typed-error hierarchy per ADR-006 (`JumpstartError` base + `ValidationError` exitCode 2). `GateFailureError` and `LLMError` will land at port time alongside the modules that throw them.
- `tests/fixtures/security/path-traversal/` — 7 committed fixtures (relative-traversal, absolute-path, sneaky-traversal, null-byte, Windows-traversal, symlink-outside, prefix-collision). Exceeds ADR-009's ≥6 minimum. Null-byte fixture uses JSON ` ` escape so editors don't strip the byte.
- `tests/test-path-safety.test.ts` — Tier 1 unit tests (NOT dormant). 22 tests: fixture replay (×2 layers), negative-space "must allow" (×2 layers), error-shape contract. The Tier 2 subprocess replay tests against `dist/lib/path-safety.js` activate at port time once `bin/lib-ts/ipc.ts` lands.
- `scripts/check-process-exit.mjs` strengthened — now strips line/block comments before regex-matching so docstrings that legitimately reference `process.exit()` (e.g. ADR-006 commentary in `errors.ts`) don't false-positive. Comment removal preserves line numbers + column offsets so violation reports stay accurate.
- New runtime dep: `zod@^4.3.6`. Adds ~50 packages but powers all schema-validation IPC envelopes per Schema Direction A.

### M1 — Detection Infrastructure (T3.1 + T3.2 + T3.3 Blocker, sub-commit 3)
- `scripts/extract-public-surface.mjs` — AST-based cross-module contract harness. TypeScript Compiler API for `.ts`, `@babel/parser` (+ `@babel/traverse`) for `.js`. Walks `bin/lib/**` + `bin/lib-ts/**` (or any explicit `--root=…`), records class declarations, `new ClassName(...)` instantiations, and `var.method(...)` call sites, then cross-references them. Reports `missing_method` drift with `file:line` + snippet. Output: `.jumpstart/metrics/drift-catches.json` (gitignored — rolled up by T3.7's metrics-cron).
- `tests/test-public-surface.test.ts` — T3.3 acceptance gate. Asserts ZERO drift on current main (159 files / 4,741 call sites), and EXACTLY 8 incidents on the synthetic fixture, with the 8 missing-method names anchored to the v1.1.13 SimulationTracer divergence.
- `tests/fixtures/contract-drift/simulation-tracer-vs-holodeck/` — T3.2 synthetic drift fixture. `tracer.js` declares 4 methods; `holodeck.js` calls 12. Committed file-pair (NOT a git-ref checkout, per implementation-plan T3.2 explicit requirement).
- `verify-baseline.mjs` now includes a `contract-harness` gate that runs the extractor with `HARNESS_FAIL_ON_DRIFT=1`. Total verify-baseline gates: **10/10 PASS** on M1 close-out.
- New devDependencies: `@babel/parser@^7.29.2`, `@babel/traverse@^7.29.0`, `@babel/types@^7.29.0`.
- New npm script: `check:dist-exports` was added in M0 sub-commit 2; the contract harness has no public npm script (it's invoked directly via `node scripts/extract-public-surface.mjs`).

### Pit Crew remediation (sub-commit 2)
After the first M0 sub-commit (b9f1bb7) the Pit Crew (Reviewer + QA + Adversary) ran against the foundation and surfaced eight false-green claims. This sub-commit closes them:
- `biome.json`: invalid rule key `noConsoleLog` → corrected to `noConsole`. `useBiomeIgnoreFolder` warning resolved by simplifying folder-ignore syntax. `files.includes` narrowed to TS-only sources so legacy `bin/lib/*.js` isn't blocked by the new strict `--error-on-warnings` gate.
- `tests/test-build-smoke.test.ts`: TS1470 (`import.meta` not allowed in CJS-compiled output) fixed by resolving paths from `process.cwd()` until M9's ESM flip; missing parameter type annotation added.
- `tests/test-paths-alias-smoke.test.ts`: was importing via relative path while claiming to test the `@lib/*` alias. Now imports `from '@lib/_smoke'`. Vitest's `resolve.alias` mirrors `tsconfig.paths` so the alias is exercised at runtime AND typecheck.
- `scripts/check-process-exit.mjs`: `ROOTS` now scans `bin/lib-ts/` (strangler ports) + `src/` (2.0 layout). `dist/` removed — generated, gitignored, and would create a circular gate. Match semantics changed from `endsWith` (smuggleable) to `path.normalize` exact-match `Set` lookup.
- `.github/workflows/pr-title-lint.yml`: `revert` type added; GitHub auto-generated `Revert "..."` titles allowlisted.
- `tests/coverage-baseline.json`: committed (164 lines). Ratchet now active. `@vitest/coverage-v8@^3.2.4` added; `vitest.config.js` adds `json-summary` reporter.
- `scripts/verify-baseline.mjs`: now executed; all 6 gates report PASS. Output: `.jumpstart/state/baseline-verification.json`.
- `scripts/check-dist-exports.mjs`: new build-output integrity gate (QA's missing-gate finding) — verifies every entry in `tsdown.config.ts` produces both `.mjs` and `.d.mts` and that the d.ts mentions every exported symbol in the source.

---

## [1.1.14] — 2026-04-24

### Fixed
- **Critical: `bin/lib/context-chunker.js` infinite loop.** `chunkContent()` could get stuck when `overlapChars >= (end - start)` at the tail; for `'x'.repeat(200000)` with the default model, `start` stabilized at 194,880 and the `while` loop ran forever, exhausting the shared vitest worker pool and OOMing the entire `npm test` run. Fixed by ensuring `start` always advances ≥ 1 char per iteration AND terminating the moment `end` reaches `content.length`. ([commit `92daf04`](https://github.com/scombey/JumpStart-AutoNav/commit/92daf04))
- **Critical: `bin/lib/simulation-tracer.js` missing 8 of 12 methods that `bin/holodeck.js` calls.** The class defined only `startPhase`, `endPhase`, `logArtifact`, `logLLMCall`, `logToolInterception`, `logUserProxyExchange`, `getReport`, `generateReport`, `setTimeline`, `getLLMUsageSummary`, `getConversationTranscript`. Holodeck additionally called `logError`, `logWarning`, `logSubagentVerified`, `logDocumentCreation`, `logCostTracking`, `logHandoffValidation`, `printSummary`, `saveReport` — all missing. Holodeck e2e scenarios crashed on the first phase validation error and had never run end-to-end before this fix. The class is now extended with all 12 methods and `getReport()` includes the `success` field that `runAllScenarios()` reads. ([commit `92daf04`](https://github.com/scombey/JumpStart-AutoNav/commit/92daf04))

### Added
- 15 tests pinning the Holodeck tracer API contract in `tests/test-headless.test.js` so this class of API drift cannot recur silently.

### Verified
- `npm test`: 83 files / 1930 tests / 3.43s (was OOM mid-suite).
- `node bin/holodeck.js --scenario baseline`: PASS end-to-end (first time ever in 1.1.13).

### Engineering trail
v1.1.14 is the **rewrite-baseline** release — `git tag v1.1.14-baseline` marks the point from which the TypeScript rewrite (in progress, see `Unreleased` above) is measured. Released ahead of any TypeScript work to ensure a clean baseline. 4 commits: `92daf04`, `f9902e0`, `8ebb29b`, `a065970`.
