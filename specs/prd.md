---
id: prd
phase: 2
agent: PM
status: Approved
created: "2026-04-24"
updated: "2026-04-24"
version: "1.0.1"
approved_by: "Samuel Combey"
approval_date: "2026-04-24"
upstream_refs:
  - specs/challenger-brief.md
  - specs/product-brief.md
  - specs/requirements-responses.md
  - specs/codebase-context.md
  - specs/typescript-rewrite-plan.md
dependencies:
  - product-brief
risk_level: medium
owners:
  - Samuel Combey
sha256: null
---

# Product Requirements Document (PRD)

> **Phase:** 2 -- Planning
> **Agent:** The PM
> **Status:** Approved (post-Pit-Crew integration, v1.0.1)
> **Created:** 2026-04-24
> **Approval date:** 2026-04-24
> **Approved by:** Samuel Combey
> **Upstream:** [`specs/product-brief.md`](product-brief.md) · [`specs/challenger-brief.md`](challenger-brief.md) · [`specs/codebase-context.md`](codebase-context.md)

---

## PM Execution Note — Compressed Elicitation + KU-04 Spike Integration

Per Samuel Combey's "keep going" directive (documented in Challenger Brief § Elicitation Override), Phase 2 proceeds in compressed-elicitation mode with Pit Crew review as the compensating rigor layer. The KU-04 pre-Phase-2 gating spike completed in the same turn as this PRD's initial draft (see `specs/insights/product-brief-insights.md` entry `2026-04-24T22:00:00Z`): **QUALIFIED verdict**. Must Have #2 is refined here accordingly — the requirement shifts from universal `.d.ts` emission to *machine-readable return-type shapes*, of which `.d.ts` is one valid mechanism and inline `@returns {{shape}}` JSDoc is another.

All 7 Must Haves from `specs/product-brief.md` flow through into this PRD's epics and stories. Each epic traces to at least one Phase 0 validation criterion. Acceptance criteria use Gherkin format per `agents.pm.acceptance_criteria_format`. Prioritization uses MoSCoW per `agents.pm.prioritization`. Stories use the `As a / I want / so that` form per `agents.pm.story_format`.

---

## Product Overview

**Product:** jumpstart-mode v2.0 — the TypeScript-rewritten spec-driven agentic coding framework.

**Release scope:** full strangler-fig migration from JavaScript to TypeScript across the existing v1.1.14 codebase (159 lib modules + 5,359-line CLI dispatcher + 808-line headless runner + 512-line holodeck + 84 tests), culminating in a 2.0.0 cutover that flips the package to ESM-only, Node ≥24 (Active LTS), typed public surface, production-quality CI gates, and preserved backward-compatible behavior for all 120+ CLI subcommands and stdin/stdout JSON microservice envelopes.

**Primary personas** (from `specs/product-brief.md`):
- **Persona 1 — Samuel Combey, Sole Maintainer** (High)
- **Persona 2 — Claude Code Agent, AI Coding Assistant Consumer** (High)
- **Persona 3 — NPX Consumer, combined medium-impact downstream user** (Medium)

**MVP boundary:** production-quality typed rewrite with zero behavioral regression; no new CLI commands, no new agent personas, no marketplace-protocol changes, no `docs_site/` rewrite. Detailed in-scope / out-of-scope in `specs/product-brief.md` § Scope Recommendation.

---

## Epics

Six epics. Each traces to ≥ 1 Phase 0 validation criterion or a non-negotiable constraint.

| Epic | Name | Primary Persona | Tier | Traces to |
|------|------|-----------------|------|-----------|
| **E1** | Baseline Tooling & CI Foundation | Samuel Combey | Must | Non-negotiable: production-quality floor |
| **E2** | Contract-Drift Detection Infrastructure | Samuel Combey, AI Agents | Must | VC1 (contract-drift detection), VC2 (machine-readable surface) |
| **E3** | Module Port — Strangler-Fig Migration | Samuel Combey | Must | MH1 (typed modules), MH4 (ESM unification), MH6 (incremental releases) |
| **E4** | CLI Behavioral Contract Preservation | NPX Consumer, AI Agents | Must | Non-negotiable: CLI contract preserved |
| **E5** | 2.0 Cutover & RC Soak | NPX Consumer, AI Agents | Must | MH4 (ESM-only at 2.0), MH6 (cutover) |
| **E6** | Known-Unknown Resolutions & Release-Support Artifacts | Samuel Combey | Should | KU-03, KU-Q-01, KU-Q-04, CHANGELOG.md |

### E1 — Baseline Tooling & CI Foundation

**Description:** Establishes the TypeScript tooling, lint/format/coverage infrastructure, and CI gates that every subsequent epic depends on. Zero behavioral change to user-facing surface.

**Primary persona:** Samuel Combey (all changes are developer-facing).

**Tier:** Must Have. Without E1, no other epic can be built to the production-quality floor.

### E2 — Contract-Drift Detection Infrastructure

**Description:** Builds the test harness + CI gates that detect cross-module contract drift before merge — the mechanized version of the SimulationTracer 12-vs-4 bug. Also establishes the machine-readable return-type-shape requirement for AI-agent consumers (refined per KU-04 spike).

**Primary personas:** Samuel Combey (gets CI detection of drift), AI Coding Assistant Consumer (gets machine-readable shapes).

**Tier:** Must Have.

### E3 — Module Port — Strangler-Fig Migration

**Description:** The actual port of 159 lib modules + CLI dispatcher + runners from JS to TS, in dependency-ordered batches (leaves first, `cli.js` last), with each port PR shipping a 1.x patch or minor release under zero-behavior-change discipline.

**Primary persona:** Samuel Combey.

**Tier:** Must Have. This is the core deliverable.

### E4 — CLI Behavioral Contract Preservation

**Description:** Defines the requirements, acceptance criteria, and CI gates that guarantee every existing CLI command, flag, exit code, stdout/stderr shape, and stdin/stdout microservice envelope continues to work unchanged. The specific test technique (snapshot diff, fixture replay, or both) is Architect's decision in Phase 3.

**Primary personas:** NPX Consumer, AI Coding Assistant Consumer.

**Tier:** Must Have. Non-negotiable constraint inherited from Phase 0.

### E5 — 2.0 Cutover & RC Soak

**Description:** The semver-major cutover: flip `"type": "module"`, bump `engines.node` to `>= 24`, redirect `bin` entries to `dist/`, publish `2.0.0-rc.x` on npm `next` tag, soak ≥ 2 weeks with zero filed issues and manual smoke-test parity across all 4 AI coding assistants, then promote to `latest`.

**Primary personas:** NPX Consumer, AI Coding Assistant Consumer.

**Tier:** Must Have. Delivers the public-facing release.

### E6 — Known-Unknown Resolutions & Release-Support Artifacts

**Description:** Housekeeping epic covering unresolved known unknowns from prior phases (npm publish rights verification, semver discipline decision, downstream consumer communication plan) plus release-support artifacts the Analyst / Product Brief surfaced (CHANGELOG.md with retroactive 1.1.14 entry).

**Primary persona:** Samuel Combey.

**Tier:** Should Have. None of these block the rewrite itself; all are required before the 2.0 cutover ships.

---

## User Stories

Format: `As a [persona], I want [capability] so that [outcome].` Acceptance Criteria: Gherkin (Given / When / Then, atomic clauses). Sizes are relative complexity (XS / S / M / L / XL), not duration.

### E1 — Baseline Tooling & CI Foundation

**E1-S1 — TypeScript configuration (`tsconfig.json`)** — Priority: Must · Size: S · Depends on: none.
As **Samuel Combey**, I want a `tsconfig.json` with strict mode, `allowJs: true`, and `NodeNext` module resolution, so that I can begin incrementally porting `bin/lib/*.js` to `.ts` without breaking the existing JS runtime.
**Acceptance Criteria:**
- Given a fresh repo checkout, When I run `npx tsc --noEmit`, Then it exits 0 against the current JS codebase.
- Given the tsconfig, When I examine it, Then `strict: true` is set.
- Given the tsconfig, When I examine it, Then `allowJs: true` is set.
- Given the tsconfig, When I examine it, Then `module: "NodeNext"` is set.
- Given the tsconfig, When I examine it, Then `paths` is configured to resolve `@lib/*` to `bin/lib-ts/*` before `bin/lib/*` (strangler alias).

**E1-S2 — Build tooling configuration** — Priority: Must · Size: S · Depends on: E1-S1. **[ARCHITECT DECISION REQUIRED — blocks T2.1 / T5.1 / T5.2]**: specific build tool (tsdown / tsup / plain tsc) to be selected by Architect in Phase 3 via Context7-verified research; plan §4 recommends tsdown with commander / citty as the CLI framework, but the final choice is Architect's call and must be recorded in `specs/decisions/adr-build-tool.md`.

As **Samuel Combey**, I want a TypeScript build configuration that produces CommonJS-compatible output to `dist/` with declaration files, preserving shebang lines on CLI entry points, so that the package can eventually publish the compiled output as the primary distribution surface.
**Acceptance Criteria:**
- Given a ported `bin/lib-ts/foo.ts` module, When I run the build command, Then `dist/lib/foo.js` and `dist/lib/foo.d.ts` are produced.
- Given a CLI entry-point file with a `#!/usr/bin/env node` shebang, When I build, Then the shebang is preserved on the emitted `.js` output.
- Given a production build, When I inspect output, Then source maps are present for every emitted file.
- Note: specific build tool (tsdown / tsup / tsc) is an Architect decision in Phase 3.

**E1-S3 — Biome lint + format configuration** — Priority: Must · Size: S · Depends on: none.
As **Samuel Combey**, I want Biome v2 configured with strict lint rules and consistent formatting across both JS and TS files, so that every PR passes a uniform automated style and correctness check regardless of whether it touches legacy JS or ported TS.
**Acceptance Criteria:**
- Given a committed `biome.json`, When I run `npx biome check`, Then it exits 0 on the current codebase.
- Given the config, When I examine the rule set, Then `suspicious/noExplicitAny` is enabled as an **error** (not warning) globally.
- Given the config, When I examine the scope, Then both `.js` and `.ts` files are included in lint + format passes.
- Given a file with a single `any` type, When I run `npx biome check`, Then it fails with a clear error message citing the line.

**E1-S4 — Coverage ratchet baseline + enforcement script** — Priority: Must · Size: M · Depends on: none.
As **Samuel Combey**, I want a per-file coverage baseline committed to the repo and a CI script that fails any PR dropping coverage on any file by > 0.5 percentage points, so that coverage only moves up, never down, during the strangler-fig migration.
**Acceptance Criteria:**
- Given a fresh `npm test --coverage` run on v1.1.14, When the run completes, Then `tests/coverage-baseline.json` is committed with per-file line/branch/function percentages.
- Given a PR that reduces coverage on any one file by > 0.5 pp, When CI runs `scripts/check-coverage-ratchet.mjs`, Then the job fails with a message naming the offending file and the delta.
- Given a PR that increases coverage, When CI runs, Then the script auto-updates the baseline in the same commit (or the PR author updates it).
- Given the script, When executed locally, Then exit code is 0 on no-regression and non-zero on regression.

**E1-S5 — CI workflow expansion** — Priority: Must · Size: S · Depends on: E1-S1 through S4.
As **NPX Consumer**, I want the existing `quality.yml` workflow to trigger on `bin/**`, `src/**`, `package.json`, and `install.sh` changes — not only `specs/`, `.jumpstart/`, `tests/` — so that every source change is gated by CI.
**Acceptance Criteria:**
- Given a PR that modifies only `bin/lib/io.js`, When it opens, Then `quality.yml` runs.
- Given a PR that modifies only `package.json`, When it opens, Then `quality.yml` runs.
- Given the updated workflow, When I inspect it, Then the Node version matrix includes **Node 22 + Node 24** (both supported during 1.x; only 24 after 2.0 cutover).

**E1-S6 — TypeScript-specific CI workflow** — Priority: Must · Size: S · Depends on: E1-S1, E1-S3, E1-S4.
As **Samuel Combey**, I want a `.github/workflows/typescript.yml` that runs `tsc --noEmit`, `biome check`, and the coverage ratchet on every PR, so that each port PR has a dedicated TypeScript quality gate independent of the legacy `quality.yml`.
**Acceptance Criteria:**
- Given a PR with a type error in a ported TS file, When CI runs, Then the `typescript.yml` job fails with the `tsc` error output visible in the PR check.
- Given a PR that lints clean, passes types, and holds coverage, When CI runs, Then the job completes in ≤ 90 seconds.
- Given the workflow, When examined, Then it runs on Node 24 minimum.

**E1-S7 — Holodeck baseline e2e CI gate** — Priority: Must · Size: S · Depends on: E1-S5.
As **Samuel Combey**, I want `node bin/holodeck.js --scenario baseline` run on every PR via a dedicated `.github/workflows/e2e.yml`, so that behavioral regressions in the framework itself are caught before merge.
**Acceptance Criteria:**
- Given a PR that regresses `SimulationTracer` or any lib module holodeck depends on, When CI runs, Then `e2e.yml` fails with the scenario summary output.
- Given a PR on a clean codebase, When CI runs, Then the holodeck baseline job completes within 60 seconds.
- Note: ecommerce scenario's pre-existing handoff-validation failures remain deferred and are NOT CI-gated at this phase.

**E1-S8 — npm audit gate** — Priority: Must · Size: XS · Depends on: E1-S5.
As **Samuel Combey**, I want CI to block PRs on new `high` or `critical` npm audit advisories, so that supply-chain regressions are surfaced at PR time, not after merge.
**Acceptance Criteria:**
- Given a PR that introduces a high-severity transitive vulnerability, When CI runs, Then the job fails with the advisory output.
- Given the current 3 known findings (yaml moderate, picomatch high, vite high), When CI runs, Then it either passes (if audit-level is `high` only) or documents the known findings inline (if audit-level is `low` or `moderate`).
- Given the CI config, When inspected, Then `npm audit --audit-level=high` is the enforcement level.

**E1-S9 — PR template enforcing zero-behavior-change** — Priority: Should · Size: XS · Depends on: none.
As **Samuel Combey**, I want `.github/pull_request_template.md` to require an explicit checkbox *"This PR changes zero user-visible behavior (or: behavior change is intentional and documented in CHANGELOG)"*, so that scope-creep is surfaced at PR authorship.
**Acceptance Criteria:**
- Given a new PR opened from a branch, When GitHub populates the description, Then the template appears with a mandatory checkbox.
- Given a PR with the checkbox unchecked, When merged, Then no CI gate blocks (honor-system), but the reviewer can cite the missing check in review comments.

**E1-S10 — Dependabot configuration** — Priority: Should · Size: XS · Depends on: none.
As **Samuel Combey**, I want `.github/dependabot.yml` configured to open weekly grouped npm-ecosystem updates, so that dependency maintenance is automated without drowning review cycles in noise.
**Acceptance Criteria:**
- Given a committed `dependabot.yml`, When a new minor-version dependency upgrade is available, Then a PR is opened on schedule (weekly).
- Given the config, When inspected, Then updates are grouped by major version family (dev-deps vs runtime).

### E2 — Contract-Drift Detection Infrastructure

**E2-S1 — Cross-module contract integration test harness** — Priority: Must · Size: L · Depends on: none.
As **Samuel Combey**, I want a test harness (`tests/test-public-surface.test.js`) that, for each `bin/lib/<name>.js`, parses its JSDoc-derived or `.d.ts`-derived signature and scans every `require()` / `import` + call site across the repo, failing if any call shape doesn't match the declared signature — so that the SimulationTracer-class contract-drift bug is caught automatically at test time.
**Acceptance Criteria:**
- Given the current v1.1.14 codebase, When I run the harness, Then it reports zero drift incidents (baseline establishes green).
- Given a synthetic test fixture where one lib module renames an exported function but callers still use the old name, When the harness runs, Then it fails with file:line references to both the declaration and the broken call sites.
- Given a PR that modifies an exported function signature, When the harness runs, Then it identifies all call sites that need updating, even across files the PR didn't touch.
- Given the committed synthetic fixture at `tests/fixtures/contract-drift/simulation-tracer-vs-holodeck/` (replicates the pre-fix 4-method-vs-12-call divergence — **fixture files committed as part of this story, NOT a live historical git-ref checkout**), When the harness runs against it, Then it reports exactly 8 missing-method drift incidents with file:line references to both the declaration gap and each unmatched call site.
- Given the harness's initial run against the current v1.1.14 `main`, When it completes, Then it emits `.jumpstart/metrics/drift-catches.json` with `{ run_id, pr_number?, catches_count, catches[] }` — the VC1 catch-log surface.
- **Analysis method explicit** (per Pit Crew QA): AST-based static analysis using the `typescript` compiler API for TS files, `@babel/parser` or equivalent for JS-only paths. Call-site scanning via AST walk over `bin/lib/**/*.{js,ts}`. No runtime reflection, no dynamic imports.
- Note: initial implementation works against JSDoc-derived signatures during strangler phase; as modules port to TS, the harness consumes `.d.ts` instead. Both modes must be supported during the migration.

**E2-S2 — `tsc --noEmit` CI gate** — Priority: Must · Size: XS · Depends on: E1-S1, E1-S6.
As **Samuel Combey**, I want `npx tsc --noEmit` to run in CI on every PR, so that type errors in any ported TS file block merge.
**Acceptance Criteria:**
- Given a PR with a `.ts` file containing a type mismatch, When CI runs, Then the job fails with `tsc` error output identifying the file and line.
- Given a PR touching only `.js` files (strangler-compat mode), When CI runs, Then `tsc --noEmit` still runs via `allowJs: true` and flags any `// @ts-check`-enabled JSDoc mismatches.

**E2-S3 — `no-any-in-public-API` enforcement script** — Priority: Must · Size: S · Depends on: E1-S3, E2-S2.
As **Samuel Combey**, I want `scripts/check-public-any.mjs` to AST-walk every emitted `.d.ts` file in `dist/` and fail CI on any `TSAnyKeyword` in an exported position, so that production-quality is enforced mechanically — not by reviewer vigilance.
**Acceptance Criteria:**
- Given a ported TS file where an exported function returns `any`, When CI runs the script, Then it fails and names the file + exported symbol.
- Given a ported TS file where `any` appears only in private / internal positions (not exported), When the script runs, Then it passes.
- Given the script is run standalone via `node scripts/check-public-any.mjs`, When no offending exports exist, Then exit code is 0.

**E2-S4 — Machine-readable return-type shape linter** — Priority: Must · Size: M · Depends on: E2-S1, E2-S3.
As **Claude Code Agent**, I want every exported function with a return object containing > 2 fields or optional branches to declare its return shape in a machine-readable form (inline JSDoc `@returns {{ field: type }}` **or** typed TS return signature), so that I can invoke lib modules correctly on the first try (per KU-04 spike finding).
**Acceptance Criteria:**
- Given a TS function `export function f(): { a: string; b: number; c?: boolean }`, When the linter runs, Then it passes (TS signature is explicit).
- Given a JS function with JSDoc `@returns {{ a: string, b: number, c?: boolean }}`, When the linter runs, Then it passes (JSDoc is explicit).
- Given a JS function with JSDoc `@returns {object}` where the actual return has 3+ fields, When the linter runs, Then it fails and references the KU-04 spike finding.
- Given a function returning `void` or a primitive, When the linter runs, Then it skips (threshold is > 2 fields or optional branches).
- Note: this is the refined form of Must Have #2 per the KU-04 QUALIFIED verdict — the requirement is machine-readable shapes, not `.d.ts` specifically.

**E2-S5 — Commit-msg hook enforcing `type:` trailer** — Priority: Must · Size: S · Depends on: none.
As **Samuel Combey**, I want a commit-msg git hook that rejects commits missing a **conventional-commits-style `type:` prefix** in the subject line from the vocabulary `{feat, fix-drift, fix-logic, chore, docs, test, build, ci, refactor, perf}`, so that VC3 (regression-share metric) can be measured automatically without self-tagging honor-system and without exemption classes.

**Acceptance Criteria:**
- Given a commit message subject `chore: bump deps`, When the hook runs, Then it accepts (conventional prefix matches vocabulary).
- Given a commit message subject `feat: port io module to TS`, When the hook runs, Then it accepts.
- Given a commit message subject `update stuff`, When the hook runs, Then it rejects with exit code ≠ 0 and a clear stderr message listing the required vocabulary.
- Given a commit message subject `Merge branch 'foo' into main` (git's default merge commit), When the hook runs, Then it accepts via a `^Merge (branch|pull request|tag)` allowlist pattern — this is the ONLY documented exemption; squash-merge commits from GitHub are required to carry a conventional prefix in their title.
- Given the hook is installed at `.husky/commit-msg` (or equivalent framework), When a new contributor runs `npm install` for the first time, Then the hook is wired automatically via the `prepare` script; verified by committing with an invalid message and observing rejection.
- Given the hook at `.husky/commit-msg`, When tested in CI via `tests/test-commit-msg-hook.test.js`, Then all above cases pass and no exemption class beyond the `Merge ...` allowlist exists.

**VC3 bypass mitigation (per Pit Crew Adversary finding):** The commit-msg hook can be bypassed by `git commit --no-verify`, by GitHub's squash-merge (which generates its own commit title that must also pass), and by `git commit --amend --no-verify`. These bypass paths are addressed by:
- **Merge-commit allowlist:** only the `Merge ...` pattern is exempt. All other commits — including GitHub squash-merge outputs — must carry a valid conventional prefix in their subject. PR title discipline enforces this for squash-merge; GitHub's UI shows the tag-requirement via a linter check (see E2-S5b below).
- **`--no-verify` audit:** a weekly CI cron script (`scripts/audit-no-verify-commits.mjs`) greps `git log main --format='%H %s'` for any commit subject not matching the vocabulary + not matching `^Merge `, emits a list to `.jumpstart/metrics/untagged-commits.json`. An untagged commit count > 0 in the weekly report is a data-quality exception that must be resolved manually (retag or document).
- **Post-hook `--amend`:** the audit script above catches this too — the FINAL subject on `main` is what's audited, not the subject that passed the hook originally.

### E2-S5b — PR-title linter on GitHub (supplements E2-S5)

**E2-S5b** — Priority: Must · Size: XS · Depends on: E2-S5.
As **Samuel Combey**, I want a GitHub Action that validates every PR title against the conventional-commits vocabulary at PR-open time, so that squash-merge outputs carry valid type prefixes without relying on the local commit-msg hook.
**Acceptance Criteria:**
- Given a PR opened with title `Add new feature`, When the `pr-title-lint.yml` workflow runs, Then it fails and comments on the PR requesting a conventional prefix.
- Given a PR title `feat: add new feature`, When the workflow runs, Then it passes silently.

**E2-S7 — `process.exit()` enforcement script** — Priority: Must · Size: XS · Depends on: E3-S9 (at least partially — blocks at CLI dispatcher port).
As **Samuel Combey**, I want a CI gate script `scripts/check-process-exit.mjs` that greps `src/**/*.ts` and `dist/**/*.js` for `process\.exit(`, excluding a documented allowlist of legitimate sites (the single top-level `cli.ts` error handler), failing CI if any other call-site is detected — so that the error-model NFR ("typed error class hierarchy replaces the current ~184 scattered `process.exit()` calls") is mechanically enforced rather than aspirational prose.
**Acceptance Criteria:**
- Given the ported codebase at any post-E3-S9 state, When `scripts/check-process-exit.mjs` runs, Then it exits 0 if and only if the only `process.exit(` call-sites are in the committed allowlist (default: one entry for `src/cli/main.ts`).
- Given a ported module that introduces a new `process.exit(` call outside the allowlist, When CI runs the script, Then it fails with file:line output and the message "Use typed errors (JumpstartError / GateFailureError / ValidationError / LLMError) — see src/errors.ts".
- Given the script is wired into `.github/workflows/typescript.yml`, When inspected, Then a step named `No scattered process.exit` is present and blocking.
- Given the baseline 1.1.14 codebase (still JS), When the script runs, Then it exits 0 because the `src/**` and `dist/**` paths are empty pre-port — the script is dormant until ports land, then progressively enforced.

**E2-S6 — Weekly regression-share metric cron** — Priority: Must · Size: S · Depends on: E2-S5.
As **Samuel Combey**, I want a weekly CI cron that reads the commit history, counts the share of commits tagged `fix-drift` / `fix-logic` vs `feat` / `chore` / `docs`, and writes the ratio to `.jumpstart/metrics/regression-share.json`, so that VC3's ≤ 20 % target is measurable without manual review.
**Acceptance Criteria:**
- Given a scheduled cron fires Monday 00:00 UTC, When it runs, Then `.jumpstart/metrics/regression-share.json` is updated with the last 7 days' ratio.
- Given the JSON, When inspected, Then it contains: `{ week_ending, total_commits, fix_commits, ratio, over_threshold }`.
- Given the ratio exceeds 0.20, When the cron runs, Then the ratio field is still written and `over_threshold: true`. (No auto-failure; this is a dashboard metric, not a gate.)

### E3 — Module Port — Strangler-Fig Migration

Strategy: leaves first, CLI dispatcher last, per the taxonomy in `specs/typescript-rewrite-plan.md` §1 (clusters K, A, C, D, E, B, H, J, I, L, F, G) and §7 (Phase 0 through 9). Each story below ports one cluster — size reflects cluster LOC share.

**E3-S1 — Port L0 leaf utilities (cluster K)** — Priority: Must · Size: M · Depends on: E1 complete.
As **Samuel Combey**, I want the zero-dependency leaf modules (`io.js`, `locks.js`, `timestamps.js`, `hashing.js`, `diff.js`, `versioning.js`, `ambiguity-heatmap.js`, `complexity.js`, `context-chunker.js`, `artifact-comparison.js`) ported to TypeScript in one batch, so that downstream clusters have typed utilities to import.
**Acceptance Criteria:**
- Given each ported `bin/lib-ts/<name>.ts`, When `tsc --noEmit` runs, Then it passes.
- Given each ported module, When the corresponding `tests/test-<name>.test.js` (unchanged) runs, Then it passes (strangler alias resolves the TS port automatically).
- Given the batch, When cross-module contract harness runs, Then zero drift.
- Given per-file coverage measurement, When compared to the committed `tests/coverage-baseline.json`, Then **each ported file is at or above its baseline** (the coverage ratchet's "no regression" rule). If a ported file's baseline is < 100 %, the story does NOT force 100 %; bringing it to 100 % is a separate follow-up story in E1 / Polish if desired.
- Given the CLI, When `node bin/cli.js <any subcommand that touches these modules> --help` runs, Then output is byte-identical to pre-port snapshot.

**E3-S2 — Port L1 configuration & bootstrap (cluster A)** — Priority: Must · Size: M · Depends on: E3-S1. **[ARCHITECT DECISION REQUIRED]**: Identify every `require('./config-yaml.cjs')` / equivalent call-site (use `git grep config-yaml`); specify the migration path (absorb into a typed ESM `config-yaml.ts` with default + named exports vs re-export shim) in `specs/decisions/adr-config-yaml-cjs-elimination.md`. This ADR must be authored before T2.x in Stage 4 begins E3-S2 work.

As **Samuel Combey**, I want `config-yaml.cjs`, `config-loader.js`, `config-merge.js`, and `framework-manifest.js` ported to TS — with the hand-rolled YAML parser in `config-loader.js` deleted in favor of the `yaml` package — so that the mixed CJS/ESM module system seam is resolved for the core config layer.
**Acceptance Criteria:**
- Given the ported modules, When `tsc --noEmit` + tests + holodeck baseline all run, Then all pass.
- Given `config-loader.ts` source, When inspected, Then no hand-rolled YAML parser remains (grep for `parseSimpleYaml`).
- Given `config-yaml.cjs`, When inspected, Then the file is deleted and its AST-preserving YAML-write behavior is absorbed into `config-yaml.ts`.
- Given 10 sample `.jumpstart/config.yaml` files from historical versions (1.0, 1.1.0, 1.1.13), When parsed, Then output matches byte-for-byte (legacy-fixture regression suite).

**E3-S3 — Port L2/C spec integrity & drift detection (cluster C)** — Priority: Must · Size: L · Depends on: E3-S2.
As **Samuel Combey**, I want `validator.js`, `spec-drift.js`, `hashing.js` (already in E3-S1 but co-evolving), `analyzer.js`, `crossref.js`, and `smell-detector.js` ported to TS, so that spec-validation tooling is typed and the JSON-Schema-to-Zod generation path can begin.
**Acceptance Criteria:**
- Given the ported modules, When the full unit test suite runs, Then 83 test files pass (same baseline count).
- Given `node bin/cli.js validate <any artifact>`, When run pre- and post-port, Then output is byte-identical.
- Given the new Zod-generated schemas, When placed under `src/schemas/generated/`, Then they successfully validate at least the 5 sealed spec artifacts (codebase-context, challenger-brief, product-brief, requirements-responses, challenger-log).

**E3-S4 — Port L2/D spec graph & traceability (cluster D)** — Priority: Must · Size: M · Depends on: E3-S3.
As **Samuel Combey**, I want `graph.js`, `traceability.js`, `bidirectional-trace.js`, `impact-analysis.js`, `adr-index.js`, `repo-graph.js` ported to TS, so that the graph/traceability cluster is typed and its outputs are schema-validated.
**Acceptance Criteria:**
- Given every ported `bin/lib-ts/<name>.ts` in cluster D, When `tsc --noEmit` runs, Then it passes.
- Given the existing `tests/test-traceability.test.js` and related cluster-D test files, When they run via the strangler `paths` alias against the ported TS, Then all pass unchanged.
- Given the cross-module contract integration harness (E2-S1), When it runs after this port, Then zero drift is reported.
- Given `node bin/cli.js bidirectional-trace <any artifact>`, When run pre- and post-port, Then stdout/stderr/exit-code are byte-identical.

**E3-S5 — Port L3 LLM/provider, state machine, UX clusters (E + B + H, batch 1)** — Priority: Must · Size: XL · Depends on: E3-S2, E3-S3.
As **Samuel Combey**, I want the LLM provider layer (`llm-provider.js`, `model-router.js`, `cost-router.js`, `context-chunker.js`, `mock-responses.js`, `usage.js`), state machine (`state-store.js`, `approve.js`, `rewind.js`, `next-phase.js`, `ceremony.js`, `focus.js`), and UX/workflow cluster (`dashboard.js`, `timeline.js`, `context-summarizer.js`, `project-memory.js`, `role-views.js`, `promptless-mode.js`, `workshop-mode.js`) ported to TS in a single strangler-fig batch, so that the majority of user-facing command handlers have typed implementations.
**Acceptance Criteria:**
- Given every ported module in clusters E, B, H, When `tsc --noEmit` runs, Then it passes.
- Given the existing per-module tests (`test-llm-provider`, `test-state-store`, `test-timeline`, etc.), When they run via strangler alias, Then all pass unchanged.
- Given `npm run emulate:architect` and `npm run emulate:full`, When executed against the ported codebase, Then their output is byte-identical to the pre-port v1.1.14 baseline capture committed at `tests/golden-masters/emulate/`.
- Given the contract integration harness, When it runs after this port, Then zero drift is reported.
- Given `llm-provider.ts` in mock mode, When subprocess-invoked with a standard fixture, Then its stdout response matches the pre-port mock-response envelope byte-for-byte.

**E3-S6 — Port L4 codebase intelligence, governance, collaboration (J + I + L, batch 2)** — Priority: Must · Size: XL · Depends on: E3-S5.
As **Samuel Combey**, I want the codebase-intelligence cluster (`ast-edit-engine.js`, `codebase-retrieval.js`, `refactor-planner.js`, `safe-rename.js`, `quality-graph.js`, `type-checker.js`), enterprise/governance cluster (~18 modules), and collaboration cluster (~25 modules) ported. These are the bulk of the "low-coupling" long tail.
**Acceptance Criteria:**
- Given every ported module in clusters J, I, L, When `tsc --noEmit` runs, Then it passes.
- Given the existing per-module tests, When they run via strangler alias, Then all pass unchanged.
- Given `node bin/cli.js quality-graph <target>` and ~40 other cluster-I/L subcommands, When run pre- and post-port, Then stdout/stderr/exit-codes are byte-identical (diffed via E4-S2's CI gate).
- Given the contract integration harness, When it runs after this port, Then zero drift is reported.

**E3-S7 — Port L5 skills marketplace (cluster F)** — Priority: Must · Size: L · Depends on: E3-S6.
As **NPX Consumer**, I want `install.js`, `integrate.js`, `registry.js`, `upgrade.js` ported to TS with the same externally-visible behavior, so that `npx jumpstart-mode install skill ignition` produces a byte-identical file tree pre- and post-port.
**Acceptance Criteria (representative):**
- Given a fresh sandbox project, When `npx jumpstart-mode install skill ignition` runs against the post-port codebase, Then the resulting file tree matches the pre-port reference tree byte-for-byte.
- Given `.jumpstart/installed.json` from 10 historical install shapes, When parsed by the ported `install.ts`, Then all shapes parse successfully.

**E3-S8 — Port L6 runners (cluster G)** — Priority: Must · Size: L · Depends on: E3-S7.
As **Samuel Combey**, I want `headless-runner.js`, `holodeck.js`, `tool-bridge.js`, `tool-schemas.js`, `simulation-tracer.js`, `smoke-tester.js`, `regression.js`, `verify-diagrams.js`, `context7-setup.js` ported to TS, with the `bin/lib/holodeck.js` duplicate of `bin/holodeck.js` resolved and the `bin/lib/headless-runner.js` divergence reconciled.
**Acceptance Criteria:**
- Given every ported runner module, When `tsc --noEmit` runs, Then it passes.
- Given `node bin/holodeck.js --scenario baseline`, When run post-port, Then the scenario PASSes and its report JSON shape matches `specs/insights/product-brief-insights.md` E1-S7 reference snapshot byte-for-byte.
- Given `npm run emulate -- --mock`, When executed, Then the headless-runner completes deterministically with the same phase transitions as pre-port baseline.
- Given `bin/lib/holodeck.js`, When the file is inspected after this port, Then **either** the file is deleted (duplicate resolved) **or** documented in `specs/decisions/adr-holodeck-duplication.md` as deliberate with a pointer from both copies.
- Given `bin/lib/headless-runner.js` vs `bin/headless-runner.js`, When diffed after this port, Then the divergence is resolved (either canonicalized to one or ADR-documented as two deliberate variants).

**E3-S9 — Port L7 CLI dispatcher (`bin/cli.js`)** — Priority: Must · Size: XL · Depends on: E3-S1 through S8.
As **Samuel Combey**, I want `bin/cli.js` ported to TS using a modern CLI framework (citty or commander — Architect decides in Phase 3), with its 120+ subcommand dispatcher decomposed into ~30 focused command files of 50-150 lines each, so that the 5,359-line monolithic main function is eliminated and every subcommand has a typed entry.
**Acceptance Criteria:**
- Given the pre-port CLI help output snapshot (120+ subcommands), When compared to post-port help, Then every command name, flag, and description matches byte-for-byte.
- Given every subcommand, When invoked with `--help`, Then exit code 0 and help text matches snapshot (resolves the pre-port `validate --help` file-path quirk — documented in product-brief §Technical Debt — by converting to proper `--help` flag handling).
- Given the CLI test fixtures for all 120+ subcommands, When run, Then all pass.

### E4 — CLI Behavioral Contract Preservation

**E4-S1 — CLI help snapshot baseline** — Priority: Must · Size: S · Depends on: none (can run before any TS ports).
As **NPX Consumer**, I want `tests/golden-masters/cli-help/*.txt` committed for every subcommand's `--help` output at v1.1.14, so that any help-text regression is detectable at PR time.

**E4-S2 — CI snapshot-diff gate** — Priority: Must · Size: S · Depends on: E4-S1, E1-S5.
As **NPX Consumer**, I want CI to diff CLI help output against snapshots on every PR and fail on any difference, so that unintended help regressions are blocked.
**Acceptance Criteria:**
- Given `scripts/diff-cli-help.mjs` and the committed snapshot corpus at `tests/golden-masters/cli-help/*.txt`, When a PR changes CLI help output for any subcommand, Then the script exits non-zero and CI fails with a diff clearly showing file / subcommand / line-level changes.
- Given the snapshot-update workflow (`scripts/capture-cli-snapshots.mjs` + manual commit), When a developer intentionally changes help text, Then they re-run the capture script, commit the updated snapshots, and CI passes on the same PR.
- Given a PR that changes only source files with no help-text impact, When CI runs `scripts/diff-cli-help.mjs`, Then the script exits 0 and the PR is not blocked.
- Given the CI workflow `.github/workflows/quality.yml` (or a dedicated `cli-snapshot.yml`), When inspected, Then it includes a step named `Diff CLI help snapshots` that runs the script and fails the job on non-zero exit.

**E4-S3 — IPC envelope regression test suite** — Priority: Must · Size: M · Depends on: E4-S1.
As **Claude Code Agent**, I want `tests/fixtures/ipc/<module>/in.json` and `out.json` fixtures for every stdin/stdout microservice lib module, plus a test harness that pipes `in.json` into `node bin/lib/<name>.js` and asserts `stdout` matches `out.json`, so that the IPC contract AI-assistants depend on cannot drift silently.

**E4-S4 — Slash-command contract static test** — Priority: Must · Size: S · Depends on: none.
As **NPX Consumer**, I want a static test that enumerates `.jumpstart/agents/*.md`, the `CLAUDE.md` slash-command table, and a committed `contracts/slash-commands.json`, asserting 1:1 match, so that an agent-persona file rename or slash-command path change is blocked at CI.

### E5 — 2.0 Cutover & RC Soak

**E5-S1 — Package flip to ESM-only** — Priority: Must · Size: M · Depends on: E3 complete.
As **NPX Consumer**, I want `package.json` updated to `"type": "module"` with `engines.node: ">=24"` and `bin` entries redirecting to `dist/`, so that the 2.0 release ships as a modern ESM package targeting Active LTS Node.
**Acceptance Criteria:**
- Given the updated `package.json`, When inspected, Then `type: module`, `engines.node: ">=24.0.0"`, `bin.jumpstart-mode: ./dist/cli.js`, `bin.jumpstart: ./dist/bootstrap/init.js`.
- Given an `exports` map, When inspected, Then it includes `"."`, `"./cli"`, `"./schemas"` conditions.

**E5-S2 — 2.0.0-rc.1 build + publish** — Priority: Must · Size: S · Depends on: E5-S1.
As **NPX Consumer**, I want the 2.0 RC published to npm's `next` dist-tag so that early adopters can test opt-in without touching `latest`.
**Acceptance Criteria:**
- Given a clean `dist/` build on the 2.0 branch, When `npm pack` runs, Then the tarball is ≤ 1.5 MB compressed and the bin entries resolve to `dist/cli.js` and `dist/bootstrap/init.js`.
- Given `npm publish --tag next`, When it completes, Then `npm view jumpstart-mode dist-tags.next` reports `2.0.0-rc.1` within 60 seconds.
- Given `npx jumpstart-mode@next --version`, When run on Node ≥ 24 in a fresh sandbox, Then it prints `2.0.0-rc.1` and exit code is 0.
- Given `npx jumpstart-mode@next --version` on Node < 24, When run, Then it fails with a clear engines-mismatch message (not an opaque crash).

**E5-S3 — 2-week RC soak across 4 AI assistants** — Priority: Must · Size: L · Depends on: E5-S2.
As **NPX Consumer**, I want `2.0.0-rc.x` on npm `next` tag soaked for ≥ 14 days with zero filed issues and manual smoke-test parity across Claude Code, Cursor, VS Code Copilot, and Windsurf, so that the `latest` dist-tag promotion is safe.

**E5-S4 — Promote to `latest` dist-tag** — Priority: Must · Size: XS · Depends on: E5-S3.
As **NPX Consumer**, I want `2.0.0` promoted to npm `latest` after successful soak, so that `npx jumpstart-mode` picks up 2.0 by default.
**Acceptance Criteria:**
- Given the 2-week soak window ended with zero filed issues and all 4 AI-assistant smoke tests PASS, When `npm dist-tag add jumpstart-mode@2.0.0 latest` runs, Then `npm view jumpstart-mode dist-tags.latest` reports `2.0.0`.
- Given a fresh `npx jumpstart-mode --version` invocation on Node ≥ 24 in a clean sandbox (no cached packages), When it runs post-promotion, Then it reports `2.0.0`.
- Given the soak window surfaces any blocking issue, When the triage decision is to NOT promote, Then `2.0.0-rc.x` remains on `next` and a remediation plan is documented as an issue before the promotion attempt re-runs.

### E6 — Known-Unknown Resolutions & Release-Support Artifacts

**E6-S1 — KU-04 spike outcome integration** — Priority: Must · Size: XS · Depends on: none. **COMPLETED 2026-04-24** (see `specs/insights/product-brief-insights.md` entry `2026-04-24T22:00:00Z`). Result: QUALIFIED. MH#2 refined and integrated into E2-S4 above.

**E6-S2 — npm publish rights verification (KU-03)** — Priority: Must · Size: XS · Depends on: none. Blocks Phase 8 start.
**Acceptance Criteria:** Given `npm whoami` and `npm owner ls jumpstart-mode` are run, When the results show Samuel Combey is listed as an owner, Then the story closes. When NOT listed, then a follow-up story is opened to coordinate with Jo Otey or adopt a scoped name.

**E6-S3 — Semver discipline decision (KU-Q-01)** — Priority: Must · Size: XS · Depends on: none.
Samuel decides: patch-per-module (1.1.14 → 1.1.15 → …) or minor-per-migration-batch (1.2.0 → 1.3.0 → …). Decision documented as an ADR by Architect in Phase 3.

**E6-S4 — Downstream consumer communication plan (KU-Q-04)** — Priority: Must · Size: S · Depends on: none.
As **NPX Consumer**, I want a short `docs/upgrade-to-2.0.md` covering the Node ≥ 24 bump, ESM-only flip, and any user-facing changes, so that the 2.0 upgrade has clear guidance.

**E6-S5 — CHANGELOG.md authored** — Priority: Should · Size: S · Depends on: none. Includes retroactive 1.1.14 entry (chunker + tracer fixes).

---

## Non-Functional Requirements

### Performance

| ID | Requirement | Threshold | Verification | Notes |
|---|---|---|---|---|
| **NFR-P01** | Full PR CI pipeline (quality.yml + typescript.yml + e2e.yml) wall-clock | ≤ 5 min at P95 | Collected via `gh run list --json durationMs` over rolling 30-PR sample; reported by `scripts/bench-ci.mjs` monthly | Ubuntu runners only; individual-run gate is 7 min fail-fast |
| **NFR-P02** | CLI cold-start (`node bin/cli.js --help`) | ≤ 500 ms at P95 on M1/M2 Mac, warm filesystem | **Local benchmark only** (hardware-dependent, NOT CI-gated); `scripts/bench-cli-startup.mjs` runs 100 invocations and reports P95. **Script is a deliverable of Stage 2 (T2.10) — not yet written at PRD seal time.** | Measured against v1.1.14 baseline BEFORE any port lands, to calibrate |
| **NFR-P03** | Full `npm test` wall-clock | ≤ 10 s median on reference hardware (M1/M2 warm) | `scripts/bench-test.mjs` runs 3 iterations, reports median. Current baseline 3.43 s observed 2026-04-24 | 2-3× headroom above baseline for TS transform + new harness |
| **NFR-P04** | Published tarball size | ≤ 1.5 MB compressed at 2.0 | `npm pack --dry-run` output in CI (wire via `audit.yml`) | Current 1.1.14 is 1.1 MB |

### Security

| ID | Requirement | Threshold | Verification |
|---|---|---|---|
| **NFR-S01** | No hardcoded credentials | 0 secrets detected in `specs/` + `src/` + `bin/` | Existing `bin/lib/secret-scanner.js`, CI-gated |
| **NFR-S02** | Supply-chain audit | 0 high-or-critical advisories on every PR + at 2.0 publish | `npm audit --audit-level=high` in CI (E1-S8) |
| **NFR-S03** | Sandboxed subprocess model preserved | Every `node bin/lib/<name>.js` subprocess invocation carries no ambient privilege escalation; AI-assistants spawn lib modules in isolated process | Manual verification during per-port PR review; automated via the stdin-fixture replay in E4-S3 |
| **NFR-S04** | Marketplace integrity | SHA256 verification on every downloaded ZIP in `install.ts` post-port | Existing `bin/lib/install.js` behavior preserved through port; regression-test harness asserts SHA check runs on every install call |

### Reliability

| ID | Requirement | Threshold | Verification |
|---|---|---|---|
| **NFR-R01** | Test ratchet preserved | 83 test files / 1,930 assertions green on every PR merge | `quality.yml` full-suite run + coverage ratchet (E1-S4) |
| **NFR-R02** | Zero behavior change per port PR | Every non-2.0-cutover PR has byte-identical CLI help + stdin/stdout microservice envelope output vs pre-port state | `scripts/diff-cli-help.mjs` (E4-S2) + IPC envelope regression suite (E4-S3) |
| **NFR-R03** | Holodeck baseline scenario green | `node bin/holodeck.js --scenario baseline` PASS on every PR | `e2e.yml` (E1-S7) CI gate |
| **NFR-R04** | Error model — typed hierarchy replaces scattered exits | Post-E3-S9, the only `process.exit(` call-site in `src/`/`dist/` is the top-level handler in `src/cli/main.ts`; typed errors (`JumpstartError`, `GateFailureError`, `ValidationError`, `LLMError`) carry structured `exitCode` fields at throw sites | `scripts/check-process-exit.mjs` in `typescript.yml` (E2-S7) — new Must Have story added per Pit Crew QA |

### Backwards Compatibility (brownfield)

| ID | Requirement | Threshold | Verification |
|---|---|---|---|
| **NFR-B01** | Config schema forward-compat | `.jumpstart/config.yaml` as of v1.1.14 parses unchanged through 2.0; new `models:` block additions are additive-only | Historical fixtures test suite (10+ variant configs from 1.0, 1.1.0, 1.1.13, 1.1.14) round-trip via ported parser |
| **NFR-B02** | State file shapes | `.jumpstart/state/state.json`, `.jumpstart/installed.json`, `.jumpstart/usage-log.json` continue to parse through 2.0 | Zod `.passthrough()` on schemas + historical-fixtures test |
| **NFR-B03** | IPC envelope | stdin/stdout JSON microservice envelope maintained through 1.x; at 2.0 extended with `"version": 1` field additively | E4-S3 IPC envelope regression suite |
| **NFR-B04** | Agent persona files | `.jumpstart/agents/*.md` filenames, slash-command paths, and structural sections unchanged through 2.0 | E4-S4 slash-command static contract test |

### Observability

| ID | Requirement | Threshold | Verification |
|---|---|---|---|
| **NFR-O01** | Usage logging preserved | `.jumpstart/usage-log.json` format unchanged; new entries append with per-phase agent + token + model tracking | Schema unchanged through port; spot-check in Phase 4 |
| **NFR-O02** | Regression-share metric (VC3) | `.jumpstart/metrics/regression-share.json` updated weekly via CI cron (E2-S6) | E2-S5 + E2-S6 + audit script for `--no-verify` bypass |
| **NFR-O03** | Timeline recording | `bin/lib/timeline.js` module behavior preserved through port; event shapes unchanged | Per-port regression test |
| **NFR-O04** | Drift-catches log (VC1) | `.jumpstart/metrics/drift-catches.json` emitted per CI run of the harness | E2-S1 acceptance criterion |

### Documentation

| ID | Requirement | Threshold | Verification |
|---|---|---|---|
| **NFR-D01** | CHANGELOG.md | Maintained from v2.0 forward with retroactive entries for 1.1.14's chunker + tracer fixes and the rewrite's preparatory commits | Story E6-S5 |
| **NFR-D02** | Machine-readable public surface | `.d.ts` OR inline JSDoc `@returns {{ shape }}` for every exported function with >2 return fields or optional branches | E2-S4 linter |

### Accessibility

Not applicable. This is a CLI framework with no user-facing UI. The `docs_site/` Docusaurus site is out of scope for 2.0 (inherited WCAG whatever Docusaurus defaults to).

---

## Dependencies and Risks

### External Dependencies

| Dependency | Type | Impact if Unavailable | Mitigation | Owner |
|-----------|------|---------------------|------------|-------|
| npm registry | Infrastructure | Cannot publish 2.0 | Publish to alternate registry (GitHub Packages) or fork under `@scombey/jumpstart-mode` | Samuel Combey |
| `npm owner` of `jumpstart-mode` (KU-03) | Organizational | Cannot ship 2.0 under same package name | E6-S2 verification; if not held, coordinate with Jo Otey or fork | Samuel Combey |
| LiteLLM proxy | Service | LLM-calling commands degraded (mock mode still works) | Pin `openai@6.34+` SDK; isolate LLM calls behind one adapter; `.env.example` documents fallback to direct OpenAI SDK | Architect, Phase 3 |
| GitHub Actions | CI platform | Cannot run CI gates | All CI workflows also runnable locally via `npm run` scripts — each gate has a local equivalent | Samuel Combey |

### Risks

| Risk | Type | Impact | Probability | Mitigation | Owner |
|------|------|--------|------------|------------|-------|
| Scope creep during migration | Schedule | XL | **High** | Hard "port PRs change zero behavior" rule + PR template (E1-S9); bugs discovered during port logged as separate issues | Samuel Combey |
| Single-maintainer fatigue | Schedule | High | Medium | Per-phase gates + rollback anchors; agent-team execution spreads cognitive load; 9-12 month realistic timeline (not the 6.5mo stretch) | Samuel Combey |
| Production-quality floor silently eroded | Technical | High | Medium | E1-S3 (Biome noExplicitAny), E2-S3 (public-API `any` gate), E2-S4 (return-shape linter), E1-S4 (coverage ratchet) — mechanical enforcement | CI |
| AI-assistant IPC contract drift | Technical | XL | Medium | E4-S3 (IPC envelope regression tests per-module) + E4-S4 (slash-command static test) | CI |
| Node ≥ 24 engine locks out users | Business | Medium | Low | 1.x minors keep `engines: ">=14"` through migration; only 2.0 flips to ≥ 24; survey / soak period at E5-S3 | PM + Samuel Combey |
| npm publish rights not held | Release | High | Medium | E6-S2 verification in Phase 3; fork option documented | Samuel Combey |
| Rewrite plan's `.d.ts` value overstated (KU-04 was QUALIFIED, not confirmed) | Product | Medium | Low (now measured) | MH#2 refined in E2-S4 to mandate machine-readable return shapes via any mechanism; `.d.ts` is derivative, not load-bearing | PM (this PRD) |
| `tsup` is "no longer actively maintained" per 2026 guidance → `tsdown` picked in plan but still pre-1.0 | Technical | Medium | Low | Architect confirms build-tool choice in Phase 3 via Context7 re-verification; safe fallbacks named | Architect |

---

## Success Metrics

Each Phase 0 validation criterion maps to a measurable metric (VC2 was retired per Pit Crew; VC3 is now the regression-share metric, no longer self-report).

| Validation Criterion | Metric | Target | Measurement Method | Frequency | Baseline |
|-----------------------|--------|--------|--------------------|-----------|----------|
| VC1 — Contract-drift caught before merge | **Count of drift-detection events at PR time** (harness fails on a PR branch → recorded as a positive "catch"); separately, count of drift incidents that reach `main` without a prior PR-time catch (these are the genuine VC1 misses) | **Catches ≥ 95 % of cross-module contract drift at PR time**; post-merge drift ≤ 1 per 6-month window | E2-S1 harness emits a JSON log per CI run to `.jumpstart/metrics/drift-catches.json`; a post-merge auditor script reads 6-month commit history with signature-change pattern detection (AST scan, not just message grep) and correlates against the drift-catches log. | Monthly (catches) + 6-monthly (miss audit) | 1 known drift (SimulationTracer) discovered **post-commit** in v1.1.13 — not caught at PR time because harness didn't exist; baseline = "caught 0 of 1 (0 %)" |
| VC2 — Machine-readable public surface (refined) | % of exported functions with machine-readable return shape (>2 fields or optional branches) | 100 % by end of E3 | E2-S4 linter output | Every PR | Unknown for current codebase; measure at E2-S4 first run |
| VC3 — Regression share in weekly commits | Ratio of `fix-drift`/`fix-logic` vs `feat`/`chore`/`docs` in trailing 7 days | ≤ 0.20 (20 %) | E2-S6 weekly cron writes to `.jumpstart/metrics/regression-share.json`; **auditor script also cross-checks every merge commit against the trailer vocabulary and flags untagged merges as explicit data-quality exceptions** (see VC3 bypass-mitigation notes at E2-S5) | Weekly | Unknown pre-rewrite (no trailer discipline); establishes baseline at E2-S5 merge; first 2 weeks after merge are discarded as calibration window |

**VC1 metric integrity note** (added per Pit Crew Adversary 2026-04-24): the metric was originally written as *"count of `fix-drift` commits reaching main"* — which inverts the signal, because a `fix-drift` commit reaching main can mean *the harness caught drift at PR time and the developer fixed it* (VC1 **succeeding**). The measurement now decouples: (a) **catches** at PR time = VC1 success events, logged by the harness itself into a dedicated JSON artifact; (b) **misses** are drift that reaches main without a prior catch, audited retrospectively by an AST-diff scan against the 6-month history. Success is measured by the catch **rate**, not by the absence of `fix-drift` commits.

---

## Implementation Milestones

Maps to `specs/typescript-rewrite-plan.md` §7 phase structure (with the revised 9-12 month timeline). Each milestone = one or more epic stories reaching demonstrable value.

| # | Milestone | Goal | Stories | Depends On |
|---|-----------|------|---------|------------|
| M0 | **Tooling foundation** | CI gates + lint + coverage ratchet green on v1.1.14 baseline; no behavior change | E1-S1 through S10; E4-S1 | — |
| M1 | **Detection infrastructure** | Cross-module contract harness green on v1.1.14; ratchet + any-gate + return-shape linter in CI | E2-S1 through S6 | M0 |
| M2 | **Leaf + config clusters ported** | `bin/lib/io.ts`, `timestamps.ts`, `hashing.ts`, etc., and config layer ported; tests green; `config-yaml.cjs` eliminated | E3-S1, E3-S2 | M1 |
| M3 | **Spec + graph clusters ported** | Spec integrity + graph/traceability clusters in TS | E3-S3, E3-S4 | M2 |
| M4 | **Feature clusters batch 1** | LLM/provider, state, UX ported | E3-S5 | M2 |
| M5 | **Feature clusters batch 2** | Codebase intel, governance, collaboration ported | E3-S6 | M3, M4 (codebase-intel cluster imports from M3's spec/graph cluster; not only M4's LLM/state cluster) |
| M6 | **Marketplace ported** | `install.ts`, `upgrade.ts`, `registry.ts`, `integrate.ts` in TS; byte-identical install output | E3-S7 | M5 |
| M7 | **Runners ported** | Holodeck + headless in TS; duplicates reconciled | E3-S8 | M6 |
| M8 | **CLI dispatcher ported** | `bin/cli.js` → `src/cli/main.ts` + ~30 command files; snapshot diff green | E3-S9; E4-S2, S3, S4 | M7 |
| M9 | **2.0 cutover** | `"type": "module"`, Node ≥ 24, `dist/` bin entries, 2.0.0-rc.1 on `next` tag | E5-S1, S2 | M8 |
| M10 | **RC soak + `latest` promotion** | 2 weeks clean soak + manual 4-assistant smoke-test + promotion | E5-S3, S4 | M9 |
| M11 | **Housekeeping** | KU resolutions + CHANGELOG.md + docs/upgrade-to-2.0.md | E6-S1 through S5 | M0 (parallel with other milestones) |

---

## Task Breakdown

Tasks decompose Must Have stories into developer-actionable items. Format: `[ID] [P?] [Story] Description (files)`. `[P]` marks tasks runnable in parallel.

### Stage 1 — Setup (M0)

- T1.1 [P] [E1-S1] Write `tsconfig.json` with strict + allowJs + paths alias (file: `tsconfig.json`)
- T1.2 [P] [E1-S3] Write `biome.json` with noExplicitAny error + JS/TS scope (file: `biome.json`)
- T1.3 [P] [E6-S5] Scaffold `CHANGELOG.md` with 1.1.14 retroactive entry (file: `CHANGELOG.md`)
- T1.4 [P] [E1-S9] Write `.github/pull_request_template.md` (file: `.github/pull_request_template.md`)
- T1.5 [P] [E1-S10] Write `.github/dependabot.yml` (file: `.github/dependabot.yml`)
- T1.6 [E1-S1] Install `typescript`, `@types/node`, `@biomejs/biome` as devDeps (files: `package.json`, `package-lock.json`)

### Stage 2 — Foundational (M0)

- T2.1 [E1-S2] Add build-tool config (specific tool TBD by Architect — tsdown / tsup / plain tsc) (files: `<build-tool>.config.ts`, `package.json` `scripts.build`)
- T2.2 [E1-S4] Capture coverage baseline and write `scripts/check-coverage-ratchet.mjs` (files: `tests/coverage-baseline.json`, `scripts/check-coverage-ratchet.mjs`)
- T2.3 [E1-S5] Expand `quality.yml` path filter + Node version matrix (file: `.github/workflows/quality.yml`)
- T2.4 [P] [E1-S6] Write `typescript.yml` CI workflow (file: `.github/workflows/typescript.yml`)
- T2.5 [P] [E1-S7] Write `e2e.yml` CI workflow with holodeck baseline (file: `.github/workflows/e2e.yml`)
- T2.6 [P] [E1-S8] Add npm audit gate to CI (file: `.github/workflows/quality.yml` or dedicated `audit.yml`)
- T2.7 [P] [E4-S1] Generate and commit CLI help snapshots (directory: `tests/golden-masters/cli-help/`)
- T2.8 [P] [E4-S4] Write slash-command contract test (files: `contracts/slash-commands.json`, `tests/test-slash-command-contract.test.js`)
- T2.9 [E2-S5] Write commit-msg hook + install via Husky or equivalent (files: `.husky/commit-msg`, `package.json` `scripts.prepare`, `tests/test-commit-msg-hook.test.js`)
- T2.9b [P] [E4-S2] Write CLI help snapshot diff script + CI step (files: `scripts/diff-cli-help.mjs`, `scripts/capture-cli-snapshots.mjs`, update to `.github/workflows/quality.yml`)
- T2.9c [P] [E2-S5b] Write PR-title linter workflow (file: `.github/workflows/pr-title-lint.yml`)
- T2.9d [P] [E2-S5] Write `--no-verify` audit script (file: `scripts/audit-no-verify-commits.mjs` + weekly cron in `.github/workflows/metrics-cron.yml`)
- T2.10 [P] [NFR-P02] Write CLI cold-start benchmark script (file: `scripts/bench-cli-startup.mjs`; captures v1.1.14 baseline before any port lands)
- T2.11 [P] [NFR-P03] Write test-suite wall-clock benchmark (file: `scripts/bench-test.mjs`)
- T2.12 [P] [NFR-P04] Wire `npm pack --dry-run` size check into `.github/workflows/audit.yml`
- **Checkpoint M0:** All Stage 1 + Stage 2 tasks complete; CI green on v1.1.14; no behavior change.

### Stage 3 — Detection Infrastructure (M1)

- T3.1 [E2-S1] Design + implement `tests/test-public-surface.test.js` contract integration harness (file: `tests/test-public-surface.test.js`, helper in `scripts/extract-public-surface.mjs`)
- T3.2 [E2-S1] Run harness against v1.1.14 JS baseline; confirm green (or catch and document any drift found)
- T3.3 [P] [E2-S2] Add `tsc --noEmit` to `typescript.yml` (file: `.github/workflows/typescript.yml`)
- T3.4 [P] [E2-S3] Write `scripts/check-public-any.mjs` (file: `scripts/check-public-any.mjs`)
- T3.5 [E2-S4] Write return-shape linter (file: `scripts/check-return-shapes.mjs`)
- T3.6 [E2-S6] Write weekly regression-share cron workflow (file: `.github/workflows/metrics-cron.yml`)
- T3.7 [E2-S7] Write `scripts/check-process-exit.mjs` with allowlist (file: `scripts/check-process-exit.mjs`); wire into `.github/workflows/typescript.yml` as non-blocking until first port lands, then blocking (scripts ships before ports to establish baseline of 0 via empty `src/`)
- T3.8 [P] [E2-S1 synthetic fixture] Commit `tests/fixtures/contract-drift/simulation-tracer-vs-holodeck/` replicating the 4-methods-vs-12-calls divergence (file-pair with minimal surface; documented in the fixture's README)
- **Checkpoint M1:** Harness green on baseline; all gates wired; v1.1.14 CI is strictly stronger than at M0.

### Stage 4 — Module Port Stages (M2 through M8)

Each story E3-S1 through E3-S9 follows the per-port recipe from `specs/typescript-rewrite-plan.md` §5:
1. Port `bin/lib/foo.js` → `bin/lib-ts/foo.ts`; keep CJS `module.exports` shape identical.
2. Run `tests/test-foo.test.js` (unchanged) — must be green via tsconfig `paths` alias.
3. Optionally duplicate test to `test-foo.test.ts` adding `expectTypeOf` assertions (original `.test.js` stays one release as canary).
4. Cross-module contract harness must remain green (catches any drift).
5. Per-file coverage ratchet must not regress.
6. CLI help snapshot + holodeck baseline remain green.
7. Ship in next 1.x release (1.2.0, 1.3.0, … per KU-Q-01 decision).

Specific per-story task breakdowns will be owned by the Architect's implementation plan (Phase 3 output). At the PM level: every port PR must have a Zero-Behavior-Change checkbox affirmation, passing `typescript.yml` + `quality.yml` + `e2e.yml` + coverage ratchet, and a reviewer sign-off.

### Stage 5 — Cutover (M9 + M10)

- T5.1 [E5-S1] Flip `package.json`: `type: module`, `engines.node: ">=24.0.0"`, redirect `bin`, add `exports` map
- T5.2 [E5-S1] Remove `allowJs: true` from `tsconfig.json`; delete remaining `.js` fallbacks
- T5.3 [E5-S2] Build `2.0.0-rc.1` and publish on npm `next` tag
- T5.4 [E5-S3] Document smoke-test protocol for 4 AI assistants; run weekly during 2-week soak
- T5.5 [E5-S4] Promote `2.0.0` to `latest` dist-tag

### Stage 6 — Polish (post M10)

- T6.1 [P] Remove strangler scaffolding (`bin/lib-ts/` → `src/lib/`, final naming cleanup)
- T6.2 [P] Enable `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` in tsconfig
- T6.3 [P] Retire `v1.1.14-baseline` tag as reference once 2.0 soaks cleanly for 30 days
- T6.4 [P] Update documentation site (`docs_site/`) to consume 2.0 API reference (optional; E3 explicitly excludes docs_site rewrite)

---

## Glossary

| Term | Definition |
|------|-----------|
| **Strangler-fig** | Migration pattern where TS replaces JS module-by-module inside the same repo, with both coexisting during the transition. Named after the plant. |
| **Path α / δ / γ** | Challenger-phase options Samuel Combey chose between for the rewrite approach (α chosen: proceed without pre-Phase-0 JSDoc experiment). |
| **Contract drift** | When a module's exported function signature changes and one or more callers don't update in lockstep — typically invisible until runtime. The `SimulationTracer` 12-vs-4 bug is the canonical example. |
| **Dual-mode module** | A `bin/lib/*.js` file that is both importable as a library and runnable as a standalone subprocess (via `node bin/lib/<name>.js`) with JSON-on-stdin/stdout. AI assistants depend on this pattern. |
| **KU-NN** | "Known Unknown" index, tracked across Challenger + Analyst phases. KU-01 resolved (Path α). KU-04 resolved this turn (QUALIFIED). KU-Q-01 → KU-Q-04 are PM-phase follow-ups. |
| **Pit Crew** | Jumpstart's native mechanism for parallel multi-persona review via `/jumpstart.pitcrew` — adopted as the compressed-elicitation rigor substitute in this rewrite workflow. |
| **VC1 / VC2 / VC3** | Validation Criteria from Phase 0 (revised post-Pit-Crew): VC1 contract-drift, VC2 machine-readable surface, VC3 regression-share metric. VC2-original ("30% time reduction") retired. |

---

## Insights Reference

**Companion Document:** [`specs/insights/prd-insights.md`](insights/prd-insights.md)

Key insights that shaped this PRD:

1. **Must Have #2 refinement per KU-04 spike** — the requirement shifted from "emit `.d.ts`" to "machine-readable return-type shapes in any form"; E2-S4 is the operationalization.
2. **The CLI dispatcher port (E3-S9) is the serial bottleneck** — every earlier port benefits from typed leaves, but the 5,359-line monolith itself cannot start until all its dependencies are typed.
3. **E6 is parallel to E3** — the KU resolutions + CHANGELOG work doesn't block the main port effort; can be picked up in spare cycles.
4. **VC3 operationalization via commit-msg hook** — converts a self-report metric into a mechanical one. Single biggest improvement from Pit Crew QA review.
5. **CI gates are the mechanism by which production-quality survives deadline pressure** — Must Have #5 from product-brief decomposes into 6 separate CI jobs (tsc, Biome, coverage ratchet, holodeck baseline, npm audit, public-API `any` scan) + return-shape linter + contract integration harness. Each one is a Must Have story in E1 or E2.

See the insights document for full rationale, epic-boundary alternatives considered, and scope trade-off decisions.

---

## Cross-Reference Links

- Upstream artifacts: [Challenger Brief](challenger-brief.md) · [Challenger Log](challenger-log.md) · [Product Brief](product-brief.md) · [Requirements Responses](requirements-responses.md) · [Codebase Context](codebase-context.md)
- Synthesis document: [TypeScript Rewrite Plan](typescript-rewrite-plan.md) (§2.5 execution model, §4 dependency matrix, §7 phased rollout, Appendix D baseline verification)
- Downstream (not yet produced): `specs/architecture.md` (Phase 3 Architect output), `specs/implementation-plan.md` (Phase 3 Architect output), `specs/decisions/*.md` (ADRs — Phase 3)

## Glossary Reference

Project glossary lives in `.jumpstart/glossary.md`. This PRD's glossary above extends project-specific terms introduced during the rewrite.

---

## Phase Gate Approval

- [x] The PRD has been generated
- [x] The human has reviewed and explicitly approved the PRD
- [x] Every epic has at least one user story
- [x] Every Must Have story has at least 2 acceptance criteria
- [x] Acceptance criteria are specific and testable (no vague qualifiers)
- [x] Non-functional requirements have measurable thresholds
- [x] At least one implementation milestone is defined
- [x] Task breakdown includes Setup, Foundational, and at least one user story stage
- [x] Dependencies and risks have identified mitigations
- [x] Success metrics map to Phase 0 validation criteria

**Approved by:** Samuel Combey
**Approval date:** 2026-04-24
**Status:** Approved

---

## Linked Data

```json-ld
{
  "@context": { "js": "https://jumpstart.dev/schema/" },
  "@type": "js:SpecArtifact",
  "@id": "js:prd",
  "js:phase": 2,
  "js:agent": "PM",
  "js:status": "Approved",
  "js:version": "1.0.0",
  "js:upstream": [
    { "@id": "js:challenger-brief" },
    { "@id": "js:product-brief" },
    { "@id": "js:requirements-responses" },
    { "@id": "js:codebase-context" }
  ],
  "js:downstream": [
    { "@id": "js:architecture" },
    { "@id": "js:implementation-plan" }
  ],
  "js:traces": [
    { "@type": "js:Trace", "js:from": "js:challenger-brief", "js:relation": "validation_criterion", "js:to": "js:prd" },
    { "@type": "js:Trace", "js:from": "js:product-brief", "js:relation": "must_have", "js:to": "js:prd" },
    { "@type": "js:Trace", "js:from": "js:requirements-responses", "js:relation": "informs", "js:to": "js:prd" },
    { "@type": "js:Trace", "js:from": "js:codebase-context", "js:relation": "grounds", "js:to": "js:prd" },
    { "@type": "js:Trace", "js:from": "js:ku-04-spike", "js:relation": "refines", "js:to": "js:prd" },
    { "@type": "js:Trace", "js:from": "js:pit-crew-phase-2-review", "js:relation": "hardens", "js:to": "js:prd" }
  ]
}
```
