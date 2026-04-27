# Changelog

All notable changes to `jumpstart-mode` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — Phase 4 / Developer M0 + M1 + M2 (Tooling + Detection + Leaf Ports)

In progress. M0 establishes the TypeScript toolchain. M1 adds the cross-module contract harness and other detection-infrastructure gates. M2 begins porting leaf utilities into TypeScript using the full 11-step per-module recipe — first port: `bin/lib-ts/io.ts`.

### M2 — T4.1.10 config-merge.ts (sub-commit 17)
- `bin/lib-ts/config-merge.ts` — pure-library port of `bin/lib/config-merge.js` (5 exports preserved verbatim: `flattenYaml`, `mergeConfigs`, `readConfig`, `writeConfig`, `writeConflictsFile`). The three-way-merge logic that drives `bin/upgrade.js`'s "framework version bump preserves user customizations" workflow is preserved bit-for-bit so upgrade-time semantics don't drift.
- **Note on `flattenYaml`**: legacy ships its own indentation-based YAML flattener returning `Record<string, rawValueString>` with dotted-key paths. This is DIFFERENT from `parseSimpleYaml` (which T4.1.9 deleted) — `flattenYaml` returns RAW VALUE STRINGS, not type-coerced values. The merge math depends on string equality (`oldValue !== newValue`), so we preserve `flattenYaml` verbatim.
- The 4 protected prefixes (`hooks.`, `project.name`, `project.description`, `project.approver`) are NEVER overwritten — pinned by tests so a future refactor can't accidentally strip them.
- New named types: `ConfigConflict`, `MergeResult`.
- `tests/test-config-merge.test.ts` — 15 tests across 7 describe blocks: `flattenYaml` (5 cases including raw-string preservation + deep nesting), three-way-merge adopt/preserve/conflict branches, protected-prefix invariants, new-keys block, `readConfig`/`writeConfig` round-trip, `writeConflictsFile` structured output.
- All 11 verify-baseline gates **PASS**. Test count: **104 / 2254** (+1 file / +15 tests).

### M2 — T4.1.9 config-loader.ts (sub-commit 16)
- `bin/lib-ts/config-loader.ts` — pure-TS port of `bin/lib/config-loader.js`. **Deletes the hand-rolled `parseSimpleYaml` from the public surface** per T4.1.9's explicit mandate; the module now uses the unified `yaml` package via `parse()`. Exports trimmed: `loadConfig`, `deepMerge`, `ConfigLoaderInputSchema` (legacy: `loadConfig`, `parseSimpleYaml`, `deepMerge`). The only surviving caller of legacy `parseSimpleYaml` is `bin/lib/next-phase.js`, which imports directly from `bin/lib/config-loader.js` (relative path, strangler-fig-protected) and is unaffected.
- New named types: `ConfigLoaderInput`, `OverrideApplied`, `ProfileApplied`, `LoadedConfig`.
- **Behavior parity preserved**: project-wins-over-global merge order, missing-global-config silent fallthrough, malformed-project-config → legacy `{ error, config: {}, sources }` envelope shape (NOT a thrown error), ceremony-profile expansion via dynamic import to `bin/lib/ceremony.js` (preserves the legacy soft-fail when ceremony.js is unreachable).
- `ConfigLoaderInputSchema` (Zod) — first ADR-009 path-safety enforcement at the IPC envelope boundary: `root` gated by `safePathSchema(process.cwd())`, `global_path` validated to resolve inside `os.homedir()` (with `~` expansion) plus null-byte rejection.
- `tests/test-config-loader.test.ts` — 20 tests across 5 describe blocks: `deepMerge` (4 cases), yaml-package parsing replaces parseSimpleYaml (multiline strings + lists), merge order (project-wins + override-tracking), error fallthroughs (missing/malformed), `ConfigLoaderInputSchema` ADR-009 path-traversal rejection (6 cases), ceremony soft-fail.
- **Documented deferral** (Deviation Log): the IPC entry block (`if (isDirectRun(import.meta.url)) { await runIpc(...) }`) is NOT wired here yet — strangler-phase tsconfig classifies `.ts` as CommonJS so `import.meta.url` + top-level `await` are both rejected by tsc. Legacy `bin/lib/config-loader.js` continues to serve the IPC subprocess contract until M9 retires it. The canonical pattern becomes available for every ported module simultaneously when `package.json` flips to `"type": "module"`.
- All 11 verify-baseline gates **PASS**. Test count: **103 / 2239** (+1 file / +20 tests).

### M2 — T4.1.8 ipc.ts + config-yaml.ts (config-cluster opener, sub-commit 15)
The architecturally significant pair: the shared subprocess runner (the second of two ADR-006 process.exit allowlisted sites) and the first config-layer port. Together they unlock M5's IPC fixture activation and the M3+ config-loader/config-merge ports.

- `bin/lib-ts/ipc.ts` (NEW, T4.1.8 deliverable #1) — the canonical IPC adapter referenced by `specs/architecture.md §IPC module contract`. Exports `isDirectRun(import.meta.url)` (subprocess-only path guard) + `runIpc<TIn, TOut>(handler, schema?)` (the runner). Behavior:
  - Reads stdin via `io.readStdin`, accepts either v0 (raw payload) or v1 (`{"version":1,"input":...}`) envelopes per ADR-007. Same handler answers both versions.
  - Validates input via the supplied Zod schema if any; missing schema is the strangler-phase escape hatch (callers add schemas as their input shapes formalize).
  - Translates typed errors to exit codes per ADR-006: `ValidationError → 2`, `LLMError → 3`, `JumpstartError → 99 (or .exitCode)`, untyped Error → 99.
  - **Owns one of the two allowlisted `process.exit()` sites**. The check-process-exit gate's allowlist already names this file.
- `bin/lib-ts/config-yaml.ts` (NEW, T4.1.8 deliverable #2) — pure-library port of `bin/lib/config-yaml.cjs` (5 exports verbatim: `parseConfigDocument`, `writeConfigDocument`, `updateBootstrapAnswers`, `setWorkflowCurrentPhase`, `getWorkflowSettings`). Preserves the `yaml` package's `Document` AST per T4.1.8 spec — `doc.setIn([...path], value)` keeps comments, blank lines, and key ordering across round-trips (ADR-003). Throws the legacy error-message shapes (`Config file not found:` and `Invalid YAML in <path>:`) verbatim for grep-compat.
- `tests/test-ipc.test.ts` (NEW, 13 tests) covers `isDirectRun` across argv shapes + `runIpc` v0/v1 envelope handling, typed-error → exit-code mapping (4 cases), and Zod schema validation success + failure paths.
- `tests/test-config-yaml.test.ts` (NEW, 15 tests) — Document round-trip preservation (comments + key order), `updateBootstrapAnswers` skip-rules + idempotency, `setWorkflowCurrentPhase` always-changed semantics, `getWorkflowSettings` `auto_handoff !== false` truthiness + null-current_phase fallback.
- New named types added across both modules: `IpcHandler`, `BootstrapUpdateResult`, `BootstrapUpdates`, `PhaseUpdateResult`, `WorkflowSettings`.
- `tsdown.config.ts` adds both new entries; `check-dist-exports` verifies the d.mts surface.
- All 11 verify-baseline gates **PASS**. Test count: **102 / 2219** (+2 files / +28 tests).

### M2 — Pit Crew remediation (sub-commit 14)

Three Pit Crew agents (Reviewer, QA, Adversary) reviewed the 7-port leaf-utility cluster as a coherent set. **30 findings: 7 BLOCKER/CRITICAL, 13 HIGH, 9 MED, 1 LOW.** Adversary delivered 8 confirmed running-code exploits. This sub-commit closes 22 findings; 8 deferred via Deviation Log.

**Confirmed-exploit fixes (3 CRITICAL + Adv-4 + Adv-5 + Adv-6 + Adv-7 + Adv-9 = 8 fixes):**
- `bin/lib-ts/locks.ts` — **Adv-1** lock-stealing/DoS via path-collision: lock filenames now derived from a SHA-256 prefix instead of the irreversible `[/\\]→__, ..→_` map. `lock.file` is checked on every read so even hash collisions can't alias-steal a lock. Atomic O_EXCL acquire (writeFileSync `flag: 'wx'`) closes the QA-F7 TOCTOU window. Lock type refactored as a discriminated union (Rev-H1) — corrupt entries no longer lie about having `agent`/`pid` fields.
- `bin/lib-ts/versioning.ts` — **Adv-2** YAML break-out: `injectVersion` now gates `version` against `SEMVER_REGEX` and rejects malformed inputs. The frontmatter regex is anchored with `^...$` + `m` flag (Rev-H2) so it only matches a real `version:` field, never a substring inside another field's value.
- `bin/lib-ts/diff.ts` — **Adv-3** arbitrary file disclosure: every `change.path` now goes through `assertInsideRoot(path, resolvedRoot, …)` before any `fs.*` read. The thrown `ValidationError` (exitCode 2) replaces the silent contents-leak.
- `bin/lib-ts/io.ts` — **Adv-4** EPIPE preserves contract: `wrapTool`'s catch block wraps the inner `writeError` call in its own try/catch so a broken stderr pipe doesn't drop the typed-throw contract; the `JumpstartError` rethrow ALWAYS reaches `runIpc`. **Adv-9** envelope shadow: `writeError` now spreads `details` BEFORE `code`/`message` so `details.code = 'OK'` can't shadow the canonical args.
- `bin/lib-ts/hashing.ts` — **Adv-5** manifest read-modify-write race: `registerArtifact` now serializes via the locks module's `acquireLock` primitive (lock filename derived from the manifest path). 50 concurrent forked subprocesses no longer lose 32 entries.
- `bin/lib-ts/context-chunker.ts` — **Adv-6** quadratic blow-up: `chunkContent` rejects `overlap >= max_tokens` at parameter-validation time. The v1.1.14 forward-progress fix is preserved; the new guard prevents a 1MB no-newline payload from producing 100k chunks (~1GB report).
- `bin/lib-ts/timestamps.ts` — **Adv-7** unbounded `result.invalid`: `audit` caps the array at 1,000 entries with a `truncated: true` flag. A 1M-line malicious markdown can no longer produce a 110MB rollup that crashes downstream consumers.

**Blocker remediation (BLOCKERs not in the exploit list):**
- `tests/test-leaf-parity.test.ts` (NEW, 11 tests) — **QA-F1**: side-by-side TS↔JS byte-identical parity check for every M2 port (hashing, timestamps, diff, context-chunker, artifact-comparison, ambiguity-heatmap, complexity, versioning). The "byte-identical" claim is now verified, not just asserted.
- `tests/fixtures/ipc/{timestamps,locks,diff,complexity}/v{0,1}/{input,expected-stdout}.json` (16 NEW fixture files) + `tests/test-ipc-fixtures.test.ts` (NEW, 16 tests) — **QA-F2 / Rev-B2**: per-module port recipe step 11 catch-up. v0 fixtures captured from the live legacy CLI driver; v1 fixtures encode the future `runIpc()` envelope shape per ADR-007. Replay test pipes input.json → `node bin/lib/<name>.js`, asserts byte-identical stdout against expected-stdout.json. v1 SHAPE (not byte-identical content) is locked now; the byte-identical comparison activates at M5 when `runIpc` lands.
- `tests/test-io.test.ts` extended — **QA-F3**: 5 `readStdin` tests (TTY short-circuit, malformed JSON → `JumpstartError`, stdin error event, whitespace-only → `{}`, well-formed JSON parse). Plus a `withTTY()`-style afterEach restorer (**QA-F5**) so worker-pool reuse no longer pollutes other tests with `process.stdin.isTTY = true`.
- `specs/decisions/adr-013-fs-safe-wrappers.md` (NEW, stub) — **Rev-B1**: closes the dangling `ADR-013` references in `hashing.ts`, `path-safety.ts`, and the Deviation Log. The full ADR will be accepted in M5 alongside `bin/lib-ts/ipc.ts`.

**HIGH-tier additional regression tests:**
- `tests/test-versioning.test.ts` — Adv-2 injection rejection (3 cases) + Rev-H2 substring-clobber prevention + Rev-H3 sentinel-file security test (actively proves the rm clause didn't execute, not just that the tag was created).
- `tests/test-diff.test.ts` — Adv-3 path-traversal rejection (2 cases) + ADR-006 ValidationError contract pin + QA-F8 hunk-flush-after-3-unchanged-lines test.
- `tests/test-io.test.ts` — Adv-4 EPIPE preserves typed throw + Rev-H4 non-Error message coercion + Adv-9 envelope shadow guard.
- `tests/test-hashing.test.ts` — QA-F6 1MB SHA-256 known vector + non-ASCII multibyte determinism check.
- `tests/test-locks.test.ts` — QA-F7 concurrent-acquire serialization + Adv-1 hash-collision defense (2 cases) + hash-based filename shape pin.
- `tests/test-context-chunker.test.ts` — Adv-6 reject-overlap-≥-max test + tightened upper-bound on the v1.1.14 fallback path.

**Deviation Log entries (8 deferrals):**
Cross-port error-contract canonicalization (M1/Rev-M1 → T4.1.8 design), 4 docstring/comment-accuracy items (Rev M2-M5 → M3 sweep), Adv-8 duplicate-header collapse (spec-quality discussion → M3), Adv-10 `readStdin` AbortSignal (→ T4.1.8 with `runIpc` timeout policy), QA-F9 fake-timer adoption (→ M3 cross-port), boundary-realpath dead-code (intentional, kept for documented future case).

**verify-baseline.mjs: 11/11 PASS.** Test count: **100 / 2191 / 5.07s** (+9 files / +49 tests since `d99378b`).

### M2 — T4.1.7 batch (4 leaf ports, sub-commit 13)
Four pure-library ports landed together (the spec calls T4.1.7 a batch since the modules share the same recipe and have no inter-dependencies):
- `bin/lib-ts/ambiguity-heatmap.ts` — vague-language + missing-constraint scanner. 5 exports (`scanAmbiguity`, `scanFile`, `generateHeatmap`, `VAGUE_TERMS`, `MISSING_CONSTRAINT_PATTERNS`). Vocabulary lists preserved verbatim. 12 tests.
- `bin/lib-ts/complexity.ts` — adaptive planning depth calculator (`quick` / `standard` / `deep`). 4 exports (`calculateComplexity` + 3 vocab constants). Score weighting and depth thresholds preserved verbatim (≥50 deep / ≥20 standard / else quick). 9 tests.
- `bin/lib-ts/context-chunker.ts` — context-window chunker. 4 exports (`estimateTokens`, `chunkContent`, `chunkImplementationPlan`, `MODEL_CONTEXT_LIMITS`). **Critical: the v1.1.14 forward-progress fix is preserved verbatim and pinned by 4 dedicated tests** (200k-char input terminates; overlap > chunk-size doesn't loop; every chunk has length > 0; last chunk reaches content.length). The pre-fix bug previously OOMed the test pool.
- `bin/lib-ts/artifact-comparison.ts` — section-level diff for spec versions. 5 exports (`compareArtifacts`, `compareFiles`, `getArtifactHistory`, `extractSections`, `CHANGE_CATEGORIES`). 11 tests.
- All 4 ports' legacy CLI driver blocks (where present) stay in JS until M5. New named types added across all 4 modules replace the legacy untyped object returns.
- All 11 verify-baseline gates **PASS**. Test count: **98 / 2142** (+4 files / +43 tests).

### M2 — T4.1.6 versioning.ts (sixth leaf port, sub-commit 12)
- `bin/lib-ts/versioning.ts` — pure-library port of `bin/lib/versioning.js` (5 exports: `generateTag`, `getNextVersion`, `createVersionTag`, `injectVersion`, `listVersions`). Tag scheme `spec/<artifact>/vX.Y.Z` preserved verbatim. Frontmatter injection rules preserved.
- **Documented security improvement** vs legacy: legacy interpolated user-controlled `artifactName` / `version` / `message` into a shell command string via `child_process.execSync` with backtick templates — command-injection risk. The port uses the array-args form of `child_process.execFileSync` so inputs pass to git directly without shell interpretation. Result-shape is byte-identical for legitimate inputs; malicious shell-metacharacter inputs that would have escaped the legacy quoting now pass through to git as literal strings. Test pinned by an explicit "evil tag-message preserves intent without shelling out" assertion.
- `tests/test-versioning.test.ts` — 18 tests, with hermetic per-test `git init` in tmpdir so the suite never touches the project's own tags. Coverage: tag generation, frontmatter injection (4 branches), version-bumping (5 branches: empty, no-git, multi-tag, highest-not-most-recent, malformed-skipped), tag creation (default-message, error fallthrough, security-evil-message), tag listing (empty, no-git, structured parse).
- New named types: `CreateTagResult`, `VersionEntry`.
- All 11 verify-baseline gates **PASS**. Test count: **94 / 2099** (+1 file / +18 tests).

### M2 — T4.1.5 diff.ts (fifth leaf port, sub-commit 11)
- `bin/lib-ts/diff.ts` — pure-library port of `bin/lib/diff.js` (2 exports: `unifiedDiff`, `generateDiff`). Behavior parity verified by 15 unit tests covering: `unifiedDiff` header + hunk shape, `generateDiff` create / modify / delete / aggregate branches including the modify-falls-back-to-disk path, `change.new ?? change.content` precedence, `Math.max(0, …)` net counting, and the empty-input zero-summary case.
- New named types: `Change` discriminated union, `DiffEntry`, `DiffSummary`, `GenerateDiffResult`, `GenerateDiffInput`. The previously-untyped object returns now have full TS shapes.
- Limitation preserved verbatim: this is NOT an LCS-optimal diff. Lines are compared positionally; sufficient for "preview before commit" use cases (matches what existing consumers have always seen).
- All 11 verify-baseline gates **PASS**. Test count: **93 / 2081** (+1 file / +15 tests).

### M2 — T4.1.4 locks.ts (fourth leaf port, sub-commit 10)
- `bin/lib-ts/locks.ts` — pure-library port of `bin/lib/locks.js` (4 functions: `acquireLock`, `releaseLock`, `lockStatus`, `listLocks`). Behavior parity verified by 15 unit tests covering: lock-file shape on disk (`{ file, agent, acquired_at, pid }` with trailing newline), conflict refusal, corrupt-lock fix-by-clobber on acquire, corrupt-lock-removed on release, agent-mismatch refusal, missing-dir auto-create, list with mixed valid + corrupt entries, status round-trip.
- New named types: `Lock`, `LockResult`, `LockStatusResult`, `ListLocksResult`.
- Legacy CLI driver kept in JS until M5 `runIpc`. Default locks dir preserved (`.jumpstart/state/locks`); legacy lock-path sanitization rules preserved verbatim (`/` and `\` → `__`, `..` → `_`).
- All 11 verify-baseline gates **PASS**. Test count: **92 / 2066** (+1 file / +15 tests).

### M2 — T4.1.3 timestamps.ts (third leaf port, sub-commit 9)
- `bin/lib-ts/timestamps.ts` — pure-library port of `bin/lib/timestamps.js` (3 functions + 1 regex constant: `now`, `validate`, `audit`, `ISO_UTC_REGEX`). Behavior parity verified by 23 unit tests covering every documented branch in `validate()` (empty, non-string, offset notation, garbage, future, past, ms-precision) plus `audit()` body-line + frontmatter scanning with all the legacy skip rules (`{{template}}`, bracketed placeholders, `Pending`, `N/A`, empty).
- New named types: `ValidateResult`, `AuditResult`, `AuditInvalidEntry` replace the legacy module's untyped objects.
- The legacy module's CLI driver (the `if (process.argv[1].endsWith('timestamps.js'))` block) is intentionally NOT ported; `bin/lib/timestamps.js` continues to handle subprocess invocations until M5's `runIpc` lands.
- One documented JSON-output micro-difference: legacy emitted `"warning": null` for past timestamps; the TS port omits the key entirely (optional-undefined idiom). Both shapes round-trip to a falsy `warning` field — net behavior unchanged for any consumer using `result.warning ?? null`.
- All 11 verify-baseline gates **PASS**. Test count: **91 / 2051** (+1 file / +23 tests).

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
