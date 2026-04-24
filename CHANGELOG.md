# Changelog

All notable changes to `jumpstart-mode` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — Phase 4 / Developer M0 (Tooling Foundation)

In progress. The TypeScript rewrite's M0 milestone: tooling foundation, no behavior change to existing CLI.

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
This release is the first commit set produced by the **Phase 4 / Developer** persona executing `specs/implementation-plan.md`. M0 establishes the TypeScript toolchain without changing any user-visible CLI behavior. Test ratchet preserved: `npm test` reports 84 files / 1933 assertions green (+1 file, +3 assertions for the new smoke test).

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
