# Codebase Context -- Insights Log

> **Phase:** Pre-0 -- Reconnaissance
> **Agent:** The Scout
> **Parent Artifact:** [`specs/codebase-context.md`](../codebase-context.md)
> **Created:** 2026-04-24
> **Last Updated:** 2026-04-24

---

## About This Document

This is the Scout's living notebook for the reconnaissance pass on the `jumpstart-mode` codebase (2026-04-24). Entries capture observations, decisions, ambiguities, and things that surprised me during the scan. Timestamps are ISO 8601 UTC per `bin/lib/timestamps.js`.

---

## Entries

### 🔍 Scout is reconnaissance-ing its own framework

**Timestamp:** `2026-04-24T17:00:00Z`

This is an unusual reconnaissance: the system under scan IS the jumpstart framework. Ordinarily the Scout documents a consumer's codebase; here the Scout is documenting the framework that defines the Scout agent persona itself. The protocol still applies, but several conventions created for scanning consumer projects (e.g., excluding `.jumpstart/` as framework scaffolding) need interpretation: these files ARE the codebase from the perspective of this repository. I applied the documented exclusions faithfully — scout's mandate is to document the consumer-facing codebase, not its own persona files — but the fact that `.jumpstart/agents/scout.md` is part of the rewritten product has been noted for downstream agents (Challenger, Analyst, PM, Architect) to consider.

→ Related to [Technology Stack](../codebase-context.md#technology-stack)

---

### 🔍 Module system is mixed by necessity, not by design

**Timestamp:** `2026-04-24T17:05:00Z`

The codebase has three coexisting module styles:

1. **Pure CommonJS** — `'use strict'; const fs = require('fs'); module.exports = {...}` — ~120 files.
2. **ESM with createRequire shim** — `import { createRequire } from 'module'; const require = createRequire(import.meta.url); export function foo() {...}` — ~38 files.
3. **Explicit `.cjs`** — one file: `bin/lib/config-yaml.cjs`, which uses the `yaml` package's `Document` AST for comment-preserving writes.

The shim pattern is not aesthetic — it exists because `bin/cli.js` is CommonJS (`require('./lib/foo.js')`), so lib modules that want ESM syntax internally must still be CJS-loadable externally. `createRequire` lets them pull in CJS deps inside their otherwise-ESM code. This is load-bearing glue. Removing any one piece requires considering the others.

→ See [Module System](../codebase-context.md#module-system)

---

### 🔍 Load-bearing "dual-mode" pattern: library-plus-microservice

**Timestamp:** `2026-04-24T17:10:00Z`

Several files in `bin/lib/` operate in two modes simultaneously. As imports, they export functions (`module.exports = { loadConfig, ... }`). As direct scripts (`node bin/lib/config-loader.js`), they read JSON from stdin, call the exported function, and write JSON to stdout. This is the contract AI coding assistants use — `CLAUDE.md` documents slash commands that the assistant implements by spawning these lib modules with JSON payloads.

This makes the lib modules' file paths part of the public contract, not implementation detail. Any refactor that changes a path (including a file rename or directory move) is a breaking change to external consumers.

→ Related to [Reference Implementations](../codebase-context.md#reference-implementations-golden-paths)

---

### 🔍 Duplicate files in `bin/` and `bin/lib/`

**Timestamp:** `2026-04-24T17:15:00Z`

`diff -q` reveals:
- `bin/holodeck.js` and `bin/lib/holodeck.js` are byte-identical.
- `bin/headless-runner.js` and `bin/lib/headless-runner.js` differ.

Neither duplication is documented anywhere I could find. The `bin/` versions are the ones the `package.json` "bin" section (implicitly, via scripts) and `npm run test:e2e` reference. The `bin/lib/` versions appear to be orphans (for holodeck) or a divergent earlier version (for headless-runner). I did not attempt to reconcile — the Scout describes; it doesn't prescribe. Downstream agents should treat this as a question to resolve.

→ See [Structural Observations](../codebase-context.md#structural-observations)

---

### 🔍 Hand-rolled YAML parser co-exists with `yaml` dependency

**Timestamp:** `2026-04-24T17:20:00Z`

`bin/lib/config-loader.js` contains an in-file `parseSimpleYaml()` function (~60 lines of stack-based indentation parsing). The `yaml` package is already a direct dependency and is used correctly in `bin/lib/config-yaml.cjs` for the AST-preserving write path. Why two parsers exist is not documented. The hand-rolled one does not handle multi-line values, block scalars, or lists the way the real parser does.

→ See [Coding Patterns](../codebase-context.md#coding-patterns)

---

### 🔍 184 `process.exit()` call sites

**Timestamp:** `2026-04-24T17:25:00Z`

Error handling is distributed: `process.exit(<code>)` is called from many lib modules directly, not only at CLI entry points. There is no typed error class, no `Result<T,E>` pattern. A gate failure in one module can terminate the entire CLI invocation from anywhere in the call stack. This is consistent with the dual-mode library-plus-microservice contract — when each module is runnable as a subprocess, `process.exit()` is the natural way to signal an outcome — but it also means the modules are difficult to compose as library functions without each call site wrapping.

→ See [Code Quality Observations](../codebase-context.md#code-quality-observations)

---

### 🔍 Tests are behaviorally pinned at module granularity

**Timestamp:** `2026-04-24T17:30:00Z`

84 `*.test.js` files exist at `tests/` top level. Each file uses `createRequire(import.meta.url)` + `require('../bin/lib/<name>.js')` to pull in one specific lib module. There is a near-1:1 mapping between lib modules and their test file. This is a valuable structural property: any refactor keeping the same module paths would keep the existing tests relevant as behavioral pins.

`tests/test-agent-intelligence.test.js` is explicitly excluded in `vitest.config.js` with the comment *"Aggregate test that imports 20+ modules; covered by individual test files"* — this is the only deliberate exclusion.

→ See [Testing Patterns](../codebase-context.md#testing-patterns)

---

### 🔍 E2E scenarios via holodeck Golden Master fixtures

**Timestamp:** `2026-04-24T17:35:00Z`

`bin/holodeck.js` runs complete simulated project lifecycles against fixtures under `tests/e2e/scenarios/`. Two scenarios exist today:

- `baseline/` — minimal, only the `01-challenger` phase.
- `ecommerce/` — five phases: challenger, analyst, pm, architect, developer.

The runner validates phase artifacts against JSON Schemas in `.jumpstart/handoffs/`, verifies subagent traces in insights files, and produces per-scenario JSON reports under `tests/e2e/reports/`. At reconnaissance time, the `baseline` scenario passes; `ecommerce` reports 3 handoff-validation failures: two missing schema files (`challenger-to-analyst.schema.json`, `analyst-to-pm.schema.json`) and one content-drift failure where the architect fixture does not express the `project_type`, populated `components`, and populated `task_list` that `architect-to-dev.schema.json` requires.

These are observations about the fixture set's current state. The Scout does not prescribe repairs.

→ See [Test Coverage Observations](../codebase-context.md#test-coverage-observations)

---

### 🔍 `docs_site/` is the only TypeScript in the repository

**Timestamp:** `2026-04-24T17:40:00Z`

`docs_site/` is a Docusaurus 3.9 site with `docusaurus.config.ts`, `sidebars.ts`, and a `tsconfig.json` that extends `@docusaurus/tsconfig`. React 19 is used for custom components. The `tsconfig.json` is marked *"This file is not used in compilation. It is here just for a nice editor experience."* — i.e., TypeScript provides IDE support but produces no compiled output. All runtime JavaScript in `bin/` is written as JavaScript, not compiled from TypeScript.

A separate `docs_site/scripts/sync-agent-data.js` script is run (not by the main CLI) to pull agent persona data into the site's pages.

→ See [Technology Stack](../codebase-context.md#technology-stack)

---

### 🔍 No formal linter, no formatter, no bundler

**Timestamp:** `2026-04-24T17:45:00Z`

There is no `.eslintrc.*`, no `eslint.config.*`, no `.prettierrc`, no `biome.json`, no `tsup.config.*`, no `rollup.config.*`, no `webpack.config.*` at repo root. Scripts in `package.json` run JavaScript files directly via `node`. The only build-like script is `prepublishOnly: node bin/cli.js --help`, which is a smoke check rather than a build. `docs_site/` has its own build step (`docusaurus build`) for the static site only.

→ See [Technology Stack](../codebase-context.md#technology-stack)

---

### 🔍 `.github/workflows/quality.yml` path filter omits `bin/**`

**Timestamp:** `2026-04-24T17:50:00Z`

The sole CI workflow triggers on PR or push-to-main when `specs/**`, `.jumpstart/**`, or `tests/**` change. It does not trigger when `bin/**` changes. Therefore a PR touching only source code in `bin/lib/` does not run CI. The workflow itself references Node 20, runs `npm ci`, and executes five staged test invocations (four individual test files, then a batched full-suite run). The batched run specifically excludes `test-agent-intelligence.test.js` with a comment about OOM avoidance. The workflow was disabled at the GitHub Actions layer on the observed fork (the UI showed "Workflows aren't being run on this forked repository") until the human enabled it during reconnaissance.

→ See [Directory Purposes](../codebase-context.md#directory-purposes)

---

### 🔍 LiteLLM proxy architecture is the intended LLM topology

**Timestamp:** `2026-04-24T17:55:00Z`

`.env.example` advertises three keys: `LITELLM_BASE_URL`, `LITELLM_API_KEY`, `OPENAI_API_KEY`. `bin/lib/llm-provider.js` uses the `openai` npm SDK with a configurable `baseURL`, defaulting to `http://localhost:4000` (the LiteLLM proxy's default). The MODEL_REGISTRY in that file lists OpenAI, Anthropic, and Google Gemini model IDs — routed through a single OpenAI-compatible client because LiteLLM translates the wire format upstream. Direct `OPENAI_API_KEY` usage exists as a fallback path. This is an important topology decision: downstream agents evaluating LLM integration should treat "LiteLLM is the gateway" as the current-state assumption.

→ See [External Integrations](../codebase-context.md#external-integrations)

---

### 🔍 Young repository, small contributor surface

**Timestamp:** `2026-04-24T18:00:00Z`

Git log shows 21 commits on `main` over 2.5 months (2026-02-10 → 2026-04-24). The `package.json` author field lists a single person. Recent commits include version bumps and the chunker/tracer fixes landed during this reconnaissance session itself. This is a young, single-maintainer-scale codebase despite the substantial surface area (~70K LOC of JavaScript). Downstream agents should calibrate their "legacy" framing accordingly — few external consumers are publicly visible; breaking changes may be tractable to coordinate.

→ See [Project Overview](../codebase-context.md#project-overview)

---

### 🔍 `npm audit` surfaces three CVE-class items at reconnaissance time

**Timestamp:** `2026-04-24T18:05:00Z`

`npm audit` reports three advisories: `yaml` (moderate, stack overflow via deeply nested input), `picomatch` (high, POSIX character-class method injection, transitive), `vite` (high, path traversal in Optimized Deps, transitive). The transitive advisories come via `vitest`. The direct one (`yaml`) is within the currently pinned range (`^2.8.1`). No action taken at the Scout layer; downstream agents decide remediation.

→ See [Security Observations](../codebase-context.md#security-observations)

---

### 🔍 `src/` and `tests/e2e/.tmp/`, `tests/e2e/reports/` are user/build output roots

**Timestamp:** `2026-04-24T18:10:00Z`

`src/` at repo root is a placeholder (`.gitkeep` only) — the framework installs this as a target for consumer code. The `.gitignore` excludes `tests/e2e/.tmp/` and `tests/e2e/reports/*.json`, which are produced by holodeck runs. `jumpstart-mode-1.1.14.tgz` is in the working tree but gitignored via `*.tgz`. These files are not part of the source corpus; they are build/runtime artifacts.

→ See [Repository Structure](../codebase-context.md#repository-structure)

---

### ❓ Open questions flagged for downstream agents

**Timestamp:** `2026-04-24T18:15:00Z`

Questions surfaced during reconnaissance that the Scout deliberately does not answer:

1. Are `bin/holodeck.js` / `bin/lib/holodeck.js` duplicates intentional (e.g., for publish-tree vs dev-time use), or accidental?
2. Is `bin/headless-runner.js` / `bin/lib/headless-runner.js` divergence a deliberate fork or an incomplete refactor?
3. Is the hand-rolled YAML parser in `config-loader.js` kept for a specific reason (performance, zero-dep variant for downstream modules) or is it vestigial?
4. Should `docs_site/` be treated as part of the product (customer-facing content) or as a separate artifact with its own release cadence?
5. Is the `src/` empty-scaffold convention still load-bearing, or could the directory be removed without affecting consumer installs?
6. Should `.github/workflows/quality.yml` trigger on `bin/**` changes? (Current filter omits it.)

These belong to the Challenger, Analyst, or Architect to resolve — the Scout records them for follow-up.

---

### 💡 Decision: scope of "original codebase" for scout exclusions

**Timestamp:** `2026-04-24T18:20:00Z`

Applied the documented exclusion list (`agents.scout.exclude_jumpstart_paths`) but INCLUDED pre-existing `.github/workflows/` and `.github/hooks/` content. The hooks directory contains `autonav.json` and per-agent files that appear to have been authored for this repo (not installed by JumpStart as a scaffolding overlay), and the workflow at `.github/workflows/quality.yml` clearly references the repo's own tests. Treating these as part of the codebase (rather than framework scaffolding) is the faithful reading of the scout protocol.

→ See [Repository Structure](../codebase-context.md#repository-structure)

---

### 💡 Decision: list the in-session edits as current state, not as recommendations

**Timestamp:** `2026-04-24T18:25:00Z`

During this session (before the Scout was formally invoked), two bug fixes were applied in-place to the live codebase: (1) a forward-progress fix in `bin/lib/context-chunker.js` and (2) the tracer repair in `bin/lib/simulation-tracer.js`. The codebase-context artifact reflects the POST-FIX state because that is the actual current state of the files. The Scout describes what it sees; it does not annotate "this was recently fixed." Historical context is captured in `specs/typescript-rewrite-plan.md` Appendix D and the git log (commits `92daf04`, `f9902e0`, `734a1a3`).

→ See [Project Overview](../codebase-context.md#project-overview)

---

### ⚠️ Assumption that should be validated

**Timestamp:** `2026-04-24T18:30:00Z`

The Scout describes the CLI as "120+ subcommands" based on a count of `subcommand === '…'` branches in the dispatcher's main function. This may undercount (if dispatch uses a table or hashmap elsewhere) or overcount (if some branches are aliases or no-ops). Before an Architect uses this number to scope work, validate via `node bin/cli.js --help` diff or direct source inspection. The number is directionally correct (large; monolithic) but not treat-as-canonical-precise.

→ See [Key Files Reference](../codebase-context.md#key-files-reference)

---

### 📊 Volumetrics summary

**Timestamp:** `2026-04-24T18:35:00Z`

Quick reference:
- 21 commits; 2.5-month age.
- ~70K JavaScript LOC total (including docs_site plugins).
- `bin/` — 165 files; `bin/lib/` — 159 modules.
- `tests/` — 84 test files; 1,930 assertions under vitest.
- `bin/cli.js` — 5,359 lines, single-file dispatcher.
- `bin/bootstrap.js` — 234 lines, ESM.
- `bin/holodeck.js` — 512 lines; `bin/headless-runner.js` — 808 lines.
- 5 runtime deps + 1 devDep (vitest).
- `docs_site/` — 51 files, Docusaurus + React 19 + Tailwind.
- `README.md` — 51 KB (user-facing).
- `install.sh` — 17 KB bash alternative installer.

---

## Cross-references

- [Repository Structure](../codebase-context.md#repository-structure)
- [Technology Stack](../codebase-context.md#technology-stack)
- [External Integrations](../codebase-context.md#external-integrations)
- [Technical Debt and Observations](../codebase-context.md#technical-debt-and-observations)
- [TypeScript rewrite plan synthesis](../typescript-rewrite-plan.md) — retained as a reference document; will be superseded phase-by-phase by the canonical jumpstart workflow artifacts (`challenger-brief.md`, `product-brief.md`, `prd.md`, `architecture.md`, `implementation-plan.md`)
