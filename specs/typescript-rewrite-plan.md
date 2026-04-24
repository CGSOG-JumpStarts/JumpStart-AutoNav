---
title: TypeScript Rewrite Plan — jumpstart-mode v1 → v2
status: Draft
version: 0.1.0
date: 2026-04-24
author: Planning synthesis from 5-agent parallel team (code-explorer, code-architect, framework-docs-researcher, pr-test-analyzer, architecture-strategist)
scope: Full rewrite of the jumpstart-mode CLI framework from JavaScript to TypeScript
target_version: 2.0.0
source_version: 1.1.13
strategy: Strangler-fig inside single repo / single package
estimated_timeline: ~6.5 months (28 weeks) with one primary engineer + reviewer
context7_status: Library versions below were web-verified (Context7 MCP was unreachable during planning). Every version MUST be re-verified via Context7 before work begins, per CLAUDE.md mandate.
---

# TypeScript Rewrite Plan — `jumpstart-mode` v1 → v2

## TL;DR

- **Strategy:** Strangler-fig inside the same repo and package. No monorepo, no dual-publish.
- **Cadence:** Ship 1.2, 1.3, 1.4… every 2–4 weeks with zero behavior change. Cut `2.0.0` only at the end to flip `engines.node`, drop CJS fallbacks, and publish `dist/` as the binary source.
- **Stack:** TypeScript 5.6+ strict · ESM-only (post-2.0) · **citty** CLI · **zod v4** with `toJSONSchema()` → regenerates `.jumpstart/schemas/*.json` · **tsdown** build · **@clack/prompts** · **picocolors** · **yaml** kept · **openai** SDK kept (LiteLLM proxy) · **vitest** kept · **Biome** for lint/format · Node `--env-file` replaces `dotenv`.
- **Execution model:** **Jumpstart's own native agents drive** (Scout, Challenger, Analyst, PM, Architect, Developer, Reviewer, Security, QA, Performance, DevOps, Refactor, Tech Writer, etc.) via their native slash commands. `/jumpstart.pitcrew` handles parallel multi-agent roundtables (the framework's native answer to multi-agent teams). External Claude Code sub-agents are retained **only for 4 legitimate gaps**: TS style review, Context7 docs research, state-file schema migrations, agent-native critique. See §2.5.
- **Hard rules:** (1) port PRs change zero behavior; (2) the 90 existing `.test.js` files stay untouched through the port and act as the ratchet; (3) slash-command contract file (`/jumpstart.scout` etc.) is a static test, not a convention; (4) tsconfig `paths` routes `require('../bin/lib/X')` to the TS port when present, silently falls back to JS.
- **Realistic timeline:** ~6.5 months with one primary engineer + reviewer driving the agent teams. Floor ~5 months with two. Non-compressible because the 5.3K-line dispatcher serializes on everything else and the 2.0 RC soak is required.

---

## 1. What We're Rewriting (the actual shape)

| Dimension | Reality |
|---|---|
| Runtime code | ~43K LOC JS · 159 modules in `bin/lib/` · 5,359-line monolithic `bin/cli.js` · 808-line headless runner · 512-line holodeck e2e runner |
| Module system | Mixed. ~120 CJS, ~38 ESM-with-`createRequire`-shim, 1 genuine `.cjs` (`config-yaml.cjs`) — all because `cli.js` is CJS and dispatches into both styles |
| CLI surface | ~120 distinct command entry points dispatched from one `async main()` with 147 `subcommand === '...'` branches |
| Data assets (must keep shipping untouched) | `.jumpstart/agents/*.md` (23 persona files), `.jumpstart/templates/`, `.jumpstart/schemas/*.schema.json`, `.jumpstart/config.yaml`, `.jumpstart/roadmap.md`, `.github/`, `AGENTS.md`, `CLAUDE.md`, `.cursorrules` |
| Tests | ~90 `test-*.test.js` files + `tests/e2e/` holodeck scenarios + `tests/golden-masters/` + 465 `createRequire` imports pulling in `bin/lib/*` |
| External consumers | End users via `npx` · AI assistants (Claude Code, Cursor, VS Code Copilot, Windsurf) that read shipped markdown · programmatic callers shelling out to `node bin/lib/*.js` over JSON stdin/stdout |
| Dead-code finds | Hand-rolled `parseSimpleYaml()` in `bin/lib/config-loader.js` duplicates what `yaml` already does · duplicate frontmatter parser in `validator.js` · duplicate story/task ID extractors across `spec-drift.js` and `traceability.js` · `holodeck.js` uses CJS `require()` on ESM-shimmed modules (silent interop hazard) |

### 12 functional clusters (from inventory)

| Cluster | ~LOC share | Coupling | Port order |
|---|---|---|---|
| K — CLI wiring & I/O infrastructure (`io.js`, `locks.js`, `timestamps.js`, `diff.js`, `versioning.js`) | 6% | Medium | **L0** leaves |
| A — Configuration & bootstrap (`config-yaml.cjs`, `config-loader.js`, `config-merge.js`, `framework-manifest.js`) | 7% | High | L1 (types flow from here) |
| C — Spec integrity & drift detection (`validator`, `spec-drift`, `hashing`, `analyzer`, `crossref`, `smell-detector`) | 9% | Medium | L2 |
| D — Spec graph & traceability (`graph`, `traceability`, `bidirectional-trace`, `impact-analysis`, `adr-index`, `repo-graph`) | 7% | Low-Medium | L2 |
| E — LLM & provider routing (`llm-provider`, `model-router`, `cost-router`, `context-chunker`, `mock-responses`, `usage`) | 5% | High | L3 |
| B — Phase / state machine (`state-store`, `approve`, `rewind`, `next-phase`, `ceremony`, `focus`) | 5% | High | L3 |
| H — UX / workflow (`dashboard`, `timeline`, `context-summarizer`, `project-memory`, `role-views`, `promptless-mode`, `workshop-mode`) | 12% | Medium | L3 |
| J — Codebase intelligence (`ast-edit-engine`, `codebase-retrieval`, `refactor-planner`, `safe-rename`, `quality-graph`, `type-checker`) | 10% | Low | L4 |
| I — Enterprise/governance add-ons (~18 isolated modules: `compliance-packs`, `risk-register`, `waiver-workflow`, `evidence-collector`, …) | 21% (largest) | Low (self-contained) | L4 — batched parallel port |
| L — Collaboration & stakeholder (~25 modules: `playback-summaries`, `structured-elicitation`, `chat-integration`, `estimation-studio`, …) | 19% | Low | L4 — batched parallel port |
| F — Skills marketplace & installer (`install`, `integrate`, `registry`, `upgrade`) | 8% | High (only network + user FS writes) | **L5** (high state-file sensitivity) |
| G — Testing & e2e infra (`headless-runner`, `holodeck`, `tool-bridge`, `tool-schemas`, `simulation-tracer`, `smoke-tester`, `regression`, `handoff-validator`) | 9% | High | **L6** — runners ported only after their deps stabilize |

The 5,359-line `bin/cli.js` is **L7** — ported last so its types flow from fully-typed leaves.

---

## 2. Strategy: Strangler-Fig (chosen)

**We rejected:**
- *Big-bang* — six-month dark branch, blast radius across four AI-assistant integrations, loses the value of the existing 90 tests as ratchets.
- *Parallel dual-publish on `next` tag* — doubles maintenance, starves the `next` branch, delays production-correctness risk until release day.

**We chose strangler-fig because** the 90 tests already pin behavior per lib module. A tsconfig `paths` alias lets existing `.test.js` silently resolve the TS port when present, JS original when not. We ship 1.2, 1.3, 1.4 continuously — users never see a "2.0 migration." `v2.0.0` is still cut at the end, but only to gate Node-version bump, ESM flip, and `dist/` publish — **no behavior changes allowed in the version bump**.

---

## 2.5 Execution Model — Jumpstart-Native Agents Drive, External Only for Gaps

This rewrite is executed **primarily by jumpstart's own native agents** — the 23 persona files in `.jumpstart/agents/*.md` loaded via slash commands. The framework covers virtually every rewrite task natively. External Claude Code sub-agents (from `compound-engineering`, `feature-dev`, `pr-review-toolkit` plugins) are retained **only for narrow legitimate gaps**.

Dogfooding the rewrite through jumpstart's own agents is the credibility test for the framework itself: if we can't rewrite `jumpstart-mode` using `jumpstart-mode`, the framework's core thesis is in doubt.

### Two distinct agent mechanisms

| | Jumpstart native agents | Task-tool external sub-agents |
|---|---|---|
| Invocation | Slash commands (`/jumpstart.scout`, `/jumpstart.architect`, `/jumpstart.pitcrew`) | Claude Code Agent tool |
| Mode | Persona-switching in the primary session; roundtable-parallel via Facilitator | Independent parallel processes |
| Authored by | This framework | External Claude Code plugins |
| Role in this rewrite | **Primary driver** | **Gap filler only** |

### Outer workflow — jumpstart's own lifecycle drives the rewrite

The rewrite is itself a brownfield project and follows the canonical jumpstart workflow:

1. `/jumpstart.scout` → `specs/codebase-context.md` (canonical inventory — supersedes §1 here)
2. `/jumpstart.challenge [rewrite JS → TS]` → `specs/challenger-brief.md` (genuinely stress-tests the rewrite idea)
3. `/jumpstart.analyze` → `specs/product-brief.md` (why TS, for whom, success criteria)
4. `/jumpstart.plan` → `specs/prd.md` (phased requirements)
5. `/jumpstart.architect` → `specs/architecture.md` + `specs/implementation-plan.md` + `specs/decisions/*.md` (target arch, 10-phase plan, ADRs)
6. `/jumpstart.build` → per-phase execution; our Phases 0–9 run inside this step

**This document (`specs/typescript-rewrite-plan.md`) is a synthesis** that compresses steps 1–5 into one doc for quick reference. The native workflow produces each as a separate canonical artifact. Where this synthesis disagrees with a canonical artifact, the canonical artifact wins (per the "Spec-First Power Inversion" rule in CLAUDE.md).

### Parallel multi-agent roundtables — use `/jumpstart.pitcrew`

Jumpstart's native answer to parallel multi-agent collaboration is **The Facilitator** (`/jumpstart.pitcrew [topic]`). From `.jumpstart/agents/facilitator.md`:

> "bring multiple agent personas into a single conversation, enabling collaborative discussion on complex trade-offs, design decisions, and cross-cutting concerns."

Pit Crew is invoked whenever a phase gate needs multiple simultaneous viewpoints (e.g. "citty vs commander?", "security risks of the marketplace installer port?"). This replaces the 5-agent external Task-tool team that produced this plan's original §§1, 3, 4, 5, 7–9.

### Agent mapping — native vs external

| Rewrite task | Jumpstart native agent | External retained only if legitimate gap |
|---|---|---|
| Map existing codebase | **Scout** | — |
| Stress-test decisions | **Challenger** + **Adversary** | — |
| Product rationale | **Analyst** | — |
| Phased requirements | **PM** | — |
| Architecture + impl plan + ADRs | **Architect** | — |
| Coding execution | **Developer** / **Quick Dev** | — |
| Code review | **Reviewer** | `kieran-typescript-reviewer` for TS-specific taste (complement, not replace) |
| Security review | **Security** (The Security Architect) | — |
| QA / test strategy | **QA** (Quinn) | — |
| Performance | **Performance** | — |
| DevOps / CI | **DevOps** | — |
| Refactoring | **Refactor** | — |
| Tech docs | **Tech Writer** | — |
| Diagrams | **Diagram Verifier** | — |
| Domain research | **Researcher** | `framework-docs-researcher` for Context7 MCP calls (tool-specific) |
| Requirements extraction | **Requirements Extractor** | — |
| Retrospective | **Retrospective** | — |
| Scrum ceremonies | **Scrum Master** | — |
| Multi-agent roundtable | **Facilitator** (`/jumpstart.pitcrew`) | — |
| UX / UI | **UX Designer** | — |
| Maintenance / long-term | **Maintenance** | — |

**Remaining external agents — the 4 legitimate gaps:**

1. `kieran-typescript-reviewer` — language-specific style taste; jumpstart's Reviewer is language-agnostic
2. `framework-docs-researcher` — Context7 MCP tool integration; jumpstart's Researcher could be taught this but Context7 is a specific MCP we want live-cited
3. `data-migration-expert` — state-file schema migrations with specific mapping-validation patterns
4. `agent-native-reviewer` — critiques agent-accessibility of features, relevant because we ship to Claude Code / Cursor / Copilot / Windsurf

These are invoked only for their narrow specialty; native agents drive everything else.

### Cadence (per phase, revised)

1. **Pit Crew** (`/jumpstart.pitcrew [phase N topic]`) — Facilitator loads the relevant native agent personas (e.g. Architect + Security + QA + Performance) into a roundtable. Produces decision memo + action items.
2. **Native lead agent drives execution** — e.g. Architect for design, Developer for coding, Reviewer for PR review. Sequential persona-switching in the primary session.
3. **External specialist consulted only for gaps** — e.g. spawn Task-tool `kieran-typescript-reviewer` for a final style pass on ported TS; spawn `framework-docs-researcher` with Context7 for dep-version verification.
4. **Human review** — synthesize, tie-break, approve or iterate.
5. **Merge** — only after human approval; CI gates (tests green, coverage ratchet clean, holodeck baseline PASS) are mandatory.

### Historical note on this document

§§1, 3, 4, 5, 7–9 of this plan were originally produced by a 5-agent external Task-tool team (`feature-dev:code-explorer`, `feature-dev:code-architect`, `framework-docs-researcher`, `pr-review-toolkit:pr-test-analyzer`, `architecture-strategist`) before the native-first principle was corrected. The content is sound — each external agent has a near-exact native equivalent — but the synthesis being external-produced is the ironic error this §2.5 corrects. Going forward, per-phase planning uses `/jumpstart.pitcrew` (native); external agents appear only against the 4 documented gaps.

Appendix D (Baseline Verification) was produced live, not by agents. That remains the right approach for verification: live execution, live transcript.

### Per-phase agent rosters (native-first)

| Phase | Native lead | Native roundtable (pitcrew) | External consultants |
|---|---|---|---|
| 0 — Tooling foundation | **Architect** | DevOps · QA · Reviewer | `framework-docs-researcher` (Context7 for tool versions) |
| 1 — Leaf utilities | **Developer** | Reviewer · QA | `kieran-typescript-reviewer` |
| 2 — Schema & validation | **Architect** → **Developer** | Security · QA · Maintenance | `framework-docs-researcher` (Zod v4) · `kieran-typescript-reviewer` |
| 3 — Feature clusters batch 1 (LLM / state / UX) | **Developer** | Security · QA · Performance | `kieran-typescript-reviewer` |
| 4 — Feature clusters batch 2 (codebase / governance / collab) | **Developer** | Reviewer · QA | `kieran-typescript-reviewer` |
| 5 — Marketplace & installer | **Architect** → **Developer** | Security · Maintenance · DevOps | `data-migration-expert` |
| 6 — Runners (holodeck + headless) | **Developer** | QA · Performance · Reviewer | `kieran-typescript-reviewer` |
| 7 — CLI dispatcher | **Architect** → **Developer** | UX Designer · Security · Reviewer | `agent-native-reviewer` · `kieran-typescript-reviewer` |
| 8 — 2.0 cutover + RC soak | **DevOps** | Security · QA · Maintenance | `data-migration-expert` |
| 9 — Hardening | **Refactor** | Reviewer · Performance · Maintenance | `kieran-typescript-reviewer` |

Per-phase rosters are **refined at phase kickoff via `/jumpstart.pitcrew [phase N]`**. The Facilitator loads the relevant personas and produces the detailed plan; external consultants are invoked only against the mapping table's narrow gaps.

---

## 3. Target Architecture

### Package shape
Single `jumpstart-mode` package. No monorepo. Consumers install one thing via `npx`; a workspace split (`@jumpstart/core`, `@jumpstart/cli`) would add weeks of tooling for zero consumer benefit.

### Module system
- During 1.x port: stay CJS-compatible. TS compiles to CJS with `declaration: true`; emitted `.js` goes back into `bin/lib/` so consumers see no filename changes.
- At 2.0 cutover: flip to `"type": "module"`, ESM-only, `"engines": { "node": ">=22" }` (Node 22 is Active LTS through Oct 2025, Maintenance through April 2027; today is 2026-04-24 so 22 is the only sensible floor). Update `bin` to `./dist/cli.js`. Publish `exports` map.

### `exports` map (v2)
```json
{
  "type": "module",
  "engines": { "node": ">=22.0.0" },
  "bin": {
    "jumpstart-mode": "./dist/cli.js",
    "jumpstart":      "./dist/bootstrap/init.js"
  },
  "exports": {
    ".":         { "import": "./dist/index.js",         "types": "./dist/index.d.ts" },
    "./cli":     { "import": "./dist/cli.js",           "types": "./dist/cli.d.ts" },
    "./schemas": { "import": "./dist/schemas/index.js", "types": "./dist/schemas/index.d.ts" }
  }
}
```
IPC microservice files (`dist/lib/config-loader.js` etc.) are invokable via direct `node <path>` without being in the `exports` map — ESM supports that.

### Directory tree (target at 2.0)

```
jumpstart-mode/
├── src/                         # single TS source root
│   ├── index.ts                 # library entry — exports types + a few factories
│   ├── cli.ts                   # CLI entry — re-exports main() so tests can call it
│   ├── errors.ts                # JumpstartError, GateFailureError, ValidationError, LLMError
│   ├── cli/
│   │   ├── main.ts              # citty defineCommand() root + Deps wiring
│   │   ├── deps.ts              # Deps interface (fs, llm, prompt, clock)
│   │   └── commands/            # ~30 files, one per logical group
│   ├── config/                  # loader.ts, schema.ts (zod), merger.ts, yaml-writer.ts
│   ├── schemas/                 # validator.ts + generated/ (zod schemas)
│   ├── llm/                     # provider.ts, registry.ts, router.ts, types.ts
│   ├── state/                   # store.ts, approve.ts, types.ts
│   ├── lib/                     # IPC-runnable pure-function modules (~150 files)
│   │   ├── ipc.ts               # shared isDirectRun() + runIpc() helpers
│   │   └── …                    # one file per current bin/lib/*.js
│   └── bootstrap/init.ts
├── dist/                        # tsdown output — gitignored
├── tests/                       # 90 .test.{js,ts} files + e2e/ + golden-masters/ + fixtures/
├── scripts/
│   ├── generate-zod-schemas.mjs      # json-schema → zod (or reverse, see below)
│   └── check-coverage-ratchet.mjs    # per-file coverage gate
├── .jumpstart/                  # UNCHANGED data assets
├── .github/ AGENTS.md CLAUDE.md .cursorrules   # UNCHANGED
├── package.json tsconfig.json tsconfig.test.json
├── tsdown.config.ts vitest.config.ts biome.json
```

### Error model
Four-class hierarchy, all with `exitCode` mapping to `process.exit()`:

```
JumpstartError          exitCode = 99 (base)
  GateFailureError      exitCode = 1   { gate, missing[] }
  ValidationError       exitCode = 2   { schemaId, issues: ZodIssue[] }
  LLMError              exitCode = 3   { provider, model, retryable }
```

The 184 scattered `process.exit()` calls in the current code collapse to a single top-level handler in `cli.ts`. Tests call `main()` directly and catch typed errors without spawning subprocesses.

### IPC backwards compatibility (critical)
Every `bin/lib/*.js` that AI assistants invoke via `node bin/lib/foo.js` with JSON on stdin **stays invocable**. Each ported module follows:

```ts
export async function loadConfig(input: ConfigLoaderInput): Promise<ConfigLoaderOutput> { … }
if (isDirectRun(import.meta.url)) runIpc(loadConfig)
```

`ipc.ts` centralises the stdin-read + stdout-write + exit-code boilerplate. Envelope gets a `"version": 1` field so future changes are detectable.

### Dependency injection
Constructor-injected `Deps`. No IoC container. Four seams the tests need:
```ts
interface Deps { fs: FsAdapter; llm: LLMProvider; prompt: PromptRunner; clock: Clock }
```
CLI wires real impls. Tests pass fakes. That's the whole DI strategy.

---

## 4. Dependency Stack (reconciled)

| Category | Current | v2 choice | Why | Migration cost |
|---|---|---|---|---|
| **CLI framework** | hand-rolled in 5.3K-line `cli.js` | **citty** | TS-first, ESM-only, lazy `subCommands` maps 1:1 to the slash-command tree, `Resolvable<T>` for async trees. Commander v12 is the safe fallback if citty pre-1.0 velocity becomes a concern. | High (by design — the whole point of the rewrite) |
| **Runtime schema** | hand-rolled JSON Schema walker | **zod v4** | Native `z.toJSONSchema()` makes zod the source of truth and regenerates `.jumpstart/schemas/*.json` — respects the spec-first rule in CLAUDE.md. 14× faster than v3. `zod/mini` for CLI paths needing tree-shaking. | Medium |
| **Prompts** | prompts@2 (unmaintained, no TS types) | **@clack/prompts** | TS-native, polished UX, explicit `isCancel()` for CI-skip. | Medium — dozens of callsites, API is close enough for a thin wrapper |
| **Build** | none (`node bin/cli.js` directly) | **tsdown** (Rolldown/Rust) | tsup is maintainer-flagged as deprecated in 2026, official migration path is tsdown. ESM-first, built-in shebang banners, `oxc`-based dts, 49% faster. | Low — no current bundler |
| **Test runner** | vitest@3.2 | **vitest** (stay, rename `workspace`→`projects`, use `v8` coverage) | Already installed, v3.2 `ast-v8-to-istanbul` remapping gives Istanbul accuracy at V8 speed. | Zero |
| **YAML** | yaml@2 + hand-rolled parser in `config-loader.js` | **yaml@2** (keep, delete hand-rolled parser) | First-class TS types, round-trips comments, zero deps. The AST-aware writer (`doc.setIn/toString`) in `config-yaml.cjs` is the reason `.cjs` exists today — that goes away when `approve.js` becomes TS ESM. | Zero for keeping; pure win for deleting the duplicate parser |
| **LLM client** | openai@6 → LiteLLM proxy | **openai@6.34+** (keep) | LiteLLM explicitly documents OpenAI SDK as the compatible client. Switching to `@anthropic-ai/sdk` defeats the proxy. | Minor-version bump |
| **Colors** | chalk@4 (CJS) | **picocolors** | 7 kB · 0.466 ms load · NO_COLOR support. For a CLI with 120 commands, startup latency compounds; picocolors beats chalk@5 on every axis except truecolor, which we don't need. chalk@4 would also require a `createRequire` shim in ESM — exactly the pattern we're eliminating. | Low — mechanical rename; `.bold.red` chaining becomes two calls |
| **Lint/format** | none | **Biome v2** | One dep, one config, 10–40× faster, `biome migrate eslint` covers the common cases. 250 rules suffice for a CLI (not a React monorepo). | Low — no existing ESLint config |
| **Env vars** | dotenv@17 | **Node `--env-file`** (drop dotenv) | Node 22 supports `process.loadEnvFile()` natively. Keep a 5-line fallback shim if multi-file `.env.local` is needed. | Low — delete dep, update scripts |
| **Utility lib** | none | **none** (plus `defu` from UnJS for config deep-merge if needed) | Citty + Node stdlib covers a CLI. Resist kitchen-sink utils. | N/A |

### JSON Schema ↔ Zod direction — decide early
Two viable directions, **pick one in Phase 0**:

| Option | Description | Pros | Cons |
|---|---|---|---|
| **A (recommended)** | `.jumpstart/schemas/*.json` stays canonical; `json-schema-to-zod` emits `src/schemas/generated/*.ts` at build time; Zod types flow via `z.infer<>` | Keeps the current shipped contract with AI assistants intact; JSON Schemas are already versioned artifacts users may depend on | Schema evolution requires editing JSON, not TS — slightly awkward DX |
| **B** | Zod becomes canonical in `src/schemas/*.ts`; build emits `.jumpstart/schemas/*.json` via `z.toJSONSchema()` | Stronger spec-first story; single source of truth in TS | Breaks the "edit `.schema.json` directly" workflow some users may rely on; harder rollback |

**Recommendation: A** during the port, evaluate migration to **B** for 2.0. The ported code doesn't care which direction — it only imports `src/schemas/generated/*.ts`.

---

## 5. Test Migration Strategy

### The core move: keep the 90 `.test.js` files untouched during the port
They are the strangler rope. Rewriting tests alongside implementation destroys the pinning guarantee — you can't distinguish "test changed" from "behavior changed" in review. The existing 465 `createRequire(import.meta.url) + require('../bin/lib/…')` imports continue to resolve.

### tsconfig alias trick
```json
"paths": {
  "@lib/*": ["bin/lib-ts/*", "bin/lib/*"]
}
```
Resolver picks the TS port when present, silently falls back. Same `require` string in `.test.js` works both pre-port and post-port.

### Vitest config for hybrid repo
```ts
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['tests/**/*.test.{js,ts}'],
    exclude: ['tests/e2e/**', 'tests/fixtures/**'],
    environment: 'node',
    pool: 'forks',                 // FS isolation for spawn tests
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      include: ['bin/lib/**', 'bin/lib-ts/**', 'bin/cli.js', 'src/**'],
      exclude: ['bin/holodeck.js', 'bin/headless-runner.js', '**/*.test.*']
    }
  }
})
```

### Coverage as ratchet (per-file, not global)
1. Phase 0 commits `tests/coverage-baseline.json`.
2. CI runs `scripts/check-coverage-ratchet.mjs` — fails if any file drops >0.5 pp.
3. Each port PR sets `--coverage.thresholds["src/lib/<ported>.ts"]=100` and updates the baseline in the same commit. Ratchet up, never down.

### Per-module recipe (per port PR)
1. Run relevant `.test.js` green against JS baseline.
2. Port `bin/lib/foo.js` → `bin/lib-ts/foo.ts` (later `src/lib/foo.ts`). Keep CJS `module.exports` shape identical. **No API rename allowed in the port PR.**
3. Re-run the same `.test.js` unchanged — must be green.
4. Only then (optionally) duplicate the test to `.test.ts` adding `expectTypeOf` assertions; original `.test.js` stays one release as a canary, then is deleted in a separate `chore/remove-js-test` PR.

### E2E (holodeck) and the 808-line headless runner
- **Holodeck stays untouched** end-to-end through the port. It's 512 lines of JS that `require()`s six lib modules and becomes the highest-value user-visible-behavior gate. Port it **last**.
- **`headless-runner.js` ported last too.** During the port, new TS code invokes it via `spawn('node', ['bin/headless-runner.js', '--mock', ...])` — exactly what `package.json` scripts do today. This isolates a huge LLM-orchestration surface from the type system until its 5 dependencies stabilize.

### Top 5 silent coverage-loss risks (watch these)
1. **Implicit-any loopholes** — `.test.js` passes `{ id: 'x' }` where TS sig expects `{ id: string; phase: number }`, slipping through. Mitigation: ban `as any` in PR lint; require `satisfies` at test boundaries.
2. **Runtime coercion drift** — `"5"` coerced to `5` in JS, rejected in TS. Keep a `coerceFromCli()` shim at the CLI boundary; forbid type tightening in leaf modules without a co-landed CLI-boundary update.
3. **Async flakes from stricter `await`** — enable `no-floating-promises` **before** porting so flakes surface under JS baseline first.
4. **CJS/ESM default-export mismatches** — `require('x')` sees `{ default: { foo } }` instead of `{ foo }`. Always use named exports in ported files, never `export default`.
5. **Golden-master drift from formatter changes** — a ported module renames a var, prettier-on-save reorders keys, `test-regression.test.js` breaks. Never regenerate golden fixtures in the same PR as a source port.

### Top 3 golden-master tests to protect fiercely
- `tests/test-regression.test.js` — structural diff vs `tests/golden-masters/expected/`
- `tests/test-deterministic-artifacts.test.js` — byte-stable hash verification
- `tests/test-handoffs.test.js` — cross-phase contract

---

## 6. Compatibility Contracts That MUST NOT Break

| Contract | Enforcement |
|---|---|
| CLI command names, flags, exit codes | Snapshot test: `bin/cli.js <cmd> --help` captured in `tests/golden-masters/cli-help/*.txt`. Diff in CI |
| stdout / stderr per subcommand | Per-subcommand integration test in a fixture project; stdout/stderr/exitcode all snapshotted |
| `.jumpstart/config.yaml` schema | JSON-schema-driven parser; fuzz 50+ variant configs from 1.0, 1.1.0, 1.1.13 history |
| `state.json`, `installed.json` shapes | Historical-fixtures regression suite (shapes from every published minor version) |
| Stdin/stdout JSON microservice envelopes | Per-module IPC test: pipe `tests/fixtures/ipc/<module>/in.json` → assert stdout. Add BEFORE porting any IPC module. Envelope gets `"version": 1` |
| Slash-command paths (`/jumpstart.scout`, etc.) | Static test: enumerate `.jumpstart/agents/*.md` and the `CLAUDE.md` command table; assert 1:1 match against committed `contracts/slash-commands.json` |
| Schema JSON file locations | Same enumeration test |
| Agent persona markdown filenames | Same enumeration test |
| LiteLLM proxy request shape | One adapter module; contract-tested against recorded transcripts |

---

## 7. Phased Rollout

| Phase | Scope | Duration | Go/No-Go |
|---|---|---|---|
| **0 — Tooling foundation** | Add tsconfig, tsdown, biome, vitest TS support, `coverage-baseline.json`, `check-coverage-ratchet.mjs`, slash-command contract test, CLI help snapshots. **Zero behavior change.** | 1 wk | All 90 tests green · holodeck green · `npm pack` byte-identical to 1.1.13 |
| **1 — Leaf utilities (L0/K)** | `io.ts`, `locks.ts`, `timestamps.ts`, `hashing.ts`, `diff.ts`, `versioning.ts`, `ambiguity-heatmap.ts`, `complexity.ts`, `context-chunker.ts`, `artifact-comparison.ts` (~15 modules) | 2 wk | Per-module coverage 100%, CLI help unchanged, holodeck green |
| **2 — Schema & validation (L1/A+C)** | `config-yaml` (kills the .cjs file), `config-loader` (deletes hand-rolled YAML parser), `validator`, `handoff-validator`, `contract-checker`, `freshness-gate`, `boundary-check`. Zod schemas generated from JSON Schemas | 2 wk | All historical-fixtures regression tests green |
| **3 — Feature clusters batch 1 (L3/E+B+H)** | LLM/provider, state machine, UX (~30 modules). `llm-provider` wrapped behind adapter | 4 wk | `emulate:architect` and `emulate:full` byte-identical output vs 1.1.13 baseline |
| **4 — Feature clusters batch 2 (L4/J+I+L)** | Codebase intelligence + governance + collaboration (~60 modules). Parallel port possible because these are self-contained | 4 wk | Same gates |
| **5 — Skills marketplace (L5/F)** | `install`, `integrate`, `registry`, `upgrade`. Migration tests over 10 historical `installed.json` shapes | 2 wk | `npx jumpstart-mode install skill ignition` byte-identical file tree vs 1.1.13 in a fresh sandbox |
| **6 — Holodeck + headless runner (L6/G)** | Port `holodeck.js`, `headless-runner.js`, `tool-bridge`, `tool-schemas`, `simulation-tracer`, `smoke-tester`, `regression`, `verify-diagrams`, `context7-setup` | 2 wk | `test:e2e` + `test:e2e:verify` green; CI time ±15% |
| **7 — CLI dispatcher + bootstrap (L7)** | Port `cli.js` (5,359 lines) using citty; port `bootstrap.js`. All subcommand `--help` outputs byte-identical | 3 wk | Full CLI parity snapshot across all 120 command entry points |
| **8 — 2.0 cutover + RC soak** | Flip `"type": "module"`, `engines.node: ">=22"`, bin→`dist/`, remove `allowJs`, publish `2.0.0-rc.1` on `next` tag, 2-week soak, promote to `latest` | 3 wk | Zero issues on `next` for 14 consecutive days; manual smoke in Claude Code + Cursor + Copilot + Windsurf |
| **9 — Hardening** | Remove strangler scaffolding, enable `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`, ban `any` in public types | 1 wk | `tsc --noEmit` clean with strictest flags |
| **Buffer** | Holidays, unplanned regressions, scope creep pushback | 4 wk | — |
| **Total** | | **~28 weeks · 6.5 mo** · floor 5 mo with 2 engineers | |

Phase 7 cannot be parallelized — it serializes on everything else. RC soak is non-negotiable for a CLI with AI-assistant integrations.

---

## 8. Risk Register (top 8)

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | User's existing `.jumpstart/` state breaks on upgrade | Medium | **XL** | Historical-fixtures regression suite; forward-compat parser accepts unknown fields; Zod `.passthrough()` on unknown keys |
| 2 | Slash-command integration drifts across 4 AI assistants | Medium | **XL** | Static contract test on agent filenames + slash-command table; manual smoke per minor release against all 4 assistants |
| 3 | Stdin/stdout IPC contracts break for programmatic callers | High | Low | Phase 2 audit enumerates every IPC module; per-module IPC test added **before** port; `"version": 1` envelope |
| 4 | Node version bump locks out users | Medium | Low | Stay on `engines: ">=14"` through 1.x. Bump to `>=22` at 2.0 (not 18 or 20 — both in Maintenance/EOL by April 2026) |
| 5 | CJS → ESM move breaks consumers | Low | **XL** | ESM flip only at 2.0 cutover, with RC soak. Do not co-bundle refactors |
| 6 | Scope creep ("while rewriting, fix bug X") | **High** | XL | **Hard rule:** port PRs change zero behavior. Bugs surfaced during port get logged to follow-up issues, fixed in separate commits after port merges. PR template enforces |
| 7 | Test migration uncovers latent bugs that were compensated for | Medium | Low | Expected. Log findings, fix in follow-up PRs. Never in the port PR itself |
| 8 | LiteLLM / OpenAI SDK contract changes mid-migration | Low | Low | Pin `openai@6.34.x`; isolate LLM calls behind one adapter ported early in Phase 3; Context7 lookup per CLAUDE.md mandate |

---

## 9. Rollback Plan

| Granularity | Mechanism |
|---|---|
| **Per-module** (inside a phase) | Each port PR ships `foo.ts` source + `foo.js` emitted output side-by-side. Revert that module only; dispatcher still resolves the same filename |
| **Per-phase** | `git tag pre-phase-N` before each merge. `git revert` the merge commit. Strangler keeps JS siblings throughout the phase, so revert restores the JS call path untouched |
| **Per-release (1.x)** | `npm deprecate jumpstart-mode@<bad> "use 1.1.N"` + `npm dist-tag add jumpstart-mode@1.1.N latest`. Never unpublish |
| **2.0 cutover** | `2.0.0-rc.x` sits on `next` tag ≥ 2 weeks. Promotion to `latest` is a dist-tag change, instantly reversible |
| **Feature-flag escape hatch** | High-risk ported modules ship behind `JUMPSTART_USE_TS_<MODULE>=1` env flag for their first minor release. Default to TS after one clean cycle. Remove flag at 2.0 |

---

## 10. Immediate First Moves (next 5 PRs)

1. **`chore/typescript-tooling`** — Add `tsconfig.json` (`allowJs: true, checkJs: false, module: NodeNext, strict: true`), `tsdown.config.ts`, `biome.json`, update `vitest.config.ts`, add `typescript @types/node @biomejs/biome tsdown` to devDeps. No source file changes. CI runs `tsc --noEmit` green.
2. **`chore/baselines`** — Commit `tests/coverage-baseline.json`, `tests/golden-masters/cli-help/*.txt` (snapshot every subcommand's `--help`), `contracts/slash-commands.json` (enumerate agent persona files + slash-command table). Add `scripts/check-coverage-ratchet.mjs` and static contract tests. Fails CI on drift from 1.1.13.
3. **`chore/context7-reverify-deps`** — Re-run dependency research with Context7 MCP live. Lock exact versions for citty, zod v4, @clack/prompts, tsdown, picocolors, biome, yaml, openai. Commit `docs/dependency-decisions.md` with `[Context7: pkg@version]` citations per CLAUDE.md mandate.
4. **`feat/port-leaf-utils`** — Port `io`, `timestamps`, `hashing`, `locks` to TS as one batch. Emitted JS stays at same path. Tests unchanged. Per-file coverage 100%.
5. **`feat/kill-yaml-duplication`** — Delete hand-rolled `parseSimpleYaml()` in `bin/lib/config-loader.js`, unify on the `yaml` package. This is a **pure bug fix**, ship it in 1.x independent of the TS migration (and ideally before it — clean baseline first).

---

## Appendix A — Agent Disagreements and Resolutions

| Topic | Agent recommended | Resolution | Why |
|---|---|---|---|
| CLI framework | Architect: commander v12 · Deps researcher: citty | **citty** | ESM-first, lazy `subCommands` critical for 50+ commands. Commander remains safe fallback |
| Build tool | Architect: tsup · Deps researcher: tsdown | **tsdown** | tsup deprecated in 2026; tsdown is the official migration path |
| Colors | Architect: chalk v5 · Deps researcher: picocolors | **picocolors** | 7 kB vs 101 kB · 0.466 ms vs 6 ms load. With 120 commands, startup latency compounds |
| Prompts | Architect: prompts (stay) · Deps researcher: @clack/prompts | **@clack/prompts** | TS-native, explicit cancel semantics, no unmaintained-package risk |
| Schema | Architect: zod v3 · Deps researcher: zod v4 | **zod v4** | Native `toJSONSchema()` eliminates third-party bridge |
| Strategy | Architect: cleaner cutover tone · Strategist: explicit strangler-fig | **Strangler-fig** | Strategist owned the call; architecture is compatible with it (ports land in `src/` incrementally) |
| Node floor | Architect: ≥20 · Strategist: ≥18 at 2.0 | **≥22 at 2.0** | Today is 2026-04-24. Node 18 EOL'd April 2025; Node 20 exits Active LTS Oct 2025. Node 22 is current Active LTS |

---

## Appendix B — What the Rewrite Does NOT Touch

Explicit non-goals so nobody "helpfully" ports them:
- `.jumpstart/agents/*.md` — 23 persona files, shipped as data
- `.jumpstart/templates/*`
- `.jumpstart/schemas/*.schema.json` (unless direction B is chosen for zod-as-canonical)
- `.jumpstart/config.yaml` (shipped default)
- `.jumpstart/roadmap.md`, `glossary.md`, `invariants.md`, `correction-log.md`, `domain-complexity.csv`
- `.github/` (Copilot instructions + hooks)
- `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.windsurfrules`
- `tests/e2e/scenarios/`, `tests/golden-masters/`, `tests/fixtures/`

These are user-facing contracts. The rewrite is a source-code migration only.

---

## Appendix C — Key Files Referenced

**Entry points:**
- `bin/cli.js` (5,359 lines — ported last in Phase 7)
- `bin/bootstrap.js`
- `bin/headless-runner.js` (808 lines — Phase 6)
- `bin/holodeck.js` (512 lines — Phase 6)

**Must-port-together configuration layer:**
- `bin/lib/config-yaml.cjs` (the one genuine `.cjs` file)
- `bin/lib/config-loader.js` (contains hand-rolled YAML parser — delete in Phase 2)
- `bin/lib/config-merge.js`

**Core infrastructure:**
- `bin/lib/io.js`, `bin/lib/state-store.js`, `bin/lib/timeline.js`, `bin/lib/llm-provider.js`

**Marketplace pipeline:**
- `bin/lib/install.js`, `bin/lib/integrate.js`, `bin/lib/upgrade.js`, `bin/lib/registry.js`

**Top 10 "port-last" red-flag modules** (heavy dynamic behavior, unknown types at compile time):
1. `bin/lib/fitness-functions.js` — dynamic function-map dispatch, runtime code execution patterns
2. `bin/lib/llm-provider.js` — factory returns structurally different shapes in mock vs live mode
3. `bin/lib/install.js` — fetch + SHA256 + ZIP extraction + topo dep resolution in one module
4. `bin/lib/config-loader.js` — hand-rolled YAML parser with mutable parser stack
5. `bin/lib/state-store.js` — module-level mutable singleton for timeline hook
6. `bin/lib/tool-bridge.js` — string-keyed dynamic dispatch, untyped args
7. `bin/lib/policy-engine.js` + `fitness-functions.js` — user-supplied regex compilation
8. `bin/cli.js` — 5,359-line async main with 147 string branches, mixed `require`/`import`
9. `bin/lib/config-yaml.cjs` — yaml lib's mutable Document AST
10. `bin/lib/module-loader.js` — dynamic `require()` of arbitrary user files

**Contract-pinning tests (highest-value ratchets):**
- `tests/test-regression.test.js`
- `tests/test-deterministic-artifacts.test.js`
- `tests/test-handoffs.test.js`
- `tests/test-schema.test.js`
- `bin/holodeck.js` + `tests/e2e/scenarios/{baseline,ecommerce}/`

---

## Appendix D — Baseline Verification (2026-04-24)

Before starting Phase 0, the plan's assumptions about the state of 1.1.13 were verified against live execution. **Reality differed from the plan in three significant ways**, and the differences are now resolved as 1.1.14 preparatory work.

### Hypothesis vs Reality

| Assumption in the plan | Reality on 2026-04-24 |
|---|---|
| "90 tests green" under `npm test` | `npm test` OOMs V8 at >4GB heap and dies mid-suite |
| Holodeck e2e is the "highest-value user-visible-behavior gate" | Holodeck has never run end-to-end in 1.1.13 — crashes on `tracer.logError is not a function` on the first phase validation error |
| `.jumpstart/handoffs/` schemas cover the phase graph | 2 of 5 transitions (`challenger → analyst`, `analyst → pm`) have no schema |

### Root causes found

1. **`bin/lib/context-chunker.js` infinite loop.** `chunkContent()` could get `start` stuck when `overlapChars >= (end - start)` at the tail. Under `'x'.repeat(200000)` with default model (`maxChars=102400`, `overlapChars=5120`), `start` stabilized at 194,880 and the `while` loop ran forever, exhausting the shared vitest worker pool and taking the *entire* suite down with it.

2. **`bin/lib/simulation-tracer.js` missing 8 of 12 methods.** Holodeck calls `logError`, `logWarning`, `logSubagentVerified`, `logDocumentCreation`, `logCostTracking`, `logHandoffValidation`, `printSummary`, `saveReport` — none implemented. Git log shows `SimulationTracer` and `holodeck.js` were committed together in `261c6ed "Introduce Pit Crew mode and timeline recording"`. The contract mismatch is original — holodeck was wired into `npm run test:e2e` but never actually exercised.

3. **`runHolodeck()` returns `tracer.getReport()` and `runAllScenarios()` reads `report.success`.** No `success` field existed on the report shape. All scenario summaries showed "Failed" unconditionally.

### Fixes applied (shipping as 1.1.14 prep)

| File | Change | Evidence it works |
|---|---|---|
| `bin/lib/context-chunker.js` | 2-line forward-progress guarantee: `if (end >= content.length) break;` + `start = Math.max(end - overlapChars, start + 1);` | 10/10 chunker tests pass; full suite unblocked |
| `bin/lib/simulation-tracer.js` | Added all 8 missing methods; extended `getReport()` with `success`, `errors`, `warnings`, `verifiedSubagents`, `documentCreations`, `handoffValidations`, `costTracking`; added proper `printSummary` and `saveReport` | `holodeck --scenario baseline`: ✓ PASS (end-to-end for the first time) |
| `tests/test-headless.test.js` | +15 tests pinning the Holodeck tracer contract (method existence, success logic, JSON report shape, printSummary non-throw, saveReport with parent-dir creation) | Prevents this class of API drift from recurring silently |

### New verified baseline

| Gate | Status |
|---|---|
| `npm test` (full suite) | ✅ 83 files / **1930 tests / 3.43s** |
| `test-agent-intelligence.test.js` | ⛔ excluded in vitest.config.js (pre-existing decision) |
| `test-context-chunker.test.js` | ✅ 10/10 |
| `test-headless.test.js` | ✅ **50/50** (was 35/35) |
| `holodeck --scenario baseline` | ✅ **PASS** (first time ever in 1.1.13) |
| `holodeck --scenario ecommerce` | ⚠️ Fails on 3 real underlying issues (not tracer bugs) — deferred, see below |

### Pre-existing issues deferred (NOT fixed in 1.1.14 — future work)

1. `.jumpstart/handoffs/` missing schemas: `challenger-to-analyst.schema.json`, `analyst-to-pm.schema.json`
2. Ecommerce architect fixture (`tests/e2e/scenarios/ecommerce/04-architect/`) doesn't produce structured `project_type`, `components`, or `task_list` matching `architect-to-dev.schema.json`
3. `bin/lib/holodeck.js` is an identical duplicate of `bin/holodeck.js` (dead code)
4. `bin/lib/headless-runner.js` differs from `bin/headless-runner.js` (unexplained drift — either dead-code-divergent or an incomplete refactor)
5. `node bin/cli.js validate --help` treats `--help` as a filepath (UX bug)
6. `npm audit`: `yaml` moderate (stack overflow via deeply nested), `picomatch` high (POSIX class method injection), `vite` high (path traversal) — all transitive via vitest
7. Node 25 `MODULE_TYPELESS_PACKAGE_JSON` warning on `bin/lib/install.js` — resolves at 2.0 ESM flip

### Implications for the plan

- **Phase 0 starts from 1.1.14**, not vanilla 1.1.13. The baseline tag is `v1.1.14-baseline`, not `v1.1.13-baseline`.
- **The e2e gate uses ONLY `holodeck --scenario baseline`** until the ecommerce handoff issues are resolved. `test:e2e` (which runs `--all`) is an informational signal, not a hard gate, until those issues are fixed in a follow-up PR.
- **The duplicate files** (`bin/lib/holodeck.js`, `bin/lib/headless-runner.js`) must be resolved before Phase 6 (runners). Either dedupe them in a pre-Phase-0 cleanup PR or as the first act of Phase 6.
- **The "90 tests" framing in the original plan is wrong** — the actual count is 83 test files / 1930 assertions (after the +15 this verification added). The plan text remains at "~90" for round-number readability but this appendix is the precise source of truth.
- **Lesson that feeds back into the rewrite rules:** "run the baseline before you trust the baseline." Phase 0's first act should be re-running this verification protocol — it is cheap, and each time we discover the baseline has drifted is a gift. Add a `scripts/verify-baseline.mjs` that runs full suite + both holodeck scenarios + CLI help snapshots and exits non-zero on any drift from the committed expectations.

### What this appendix is NOT

This is not an agent-produced artifact. Agents A–E produced §§1–9 + Appendices A–C. Appendix D was produced by **live execution** in an interactive session — running `npm test`, reading the failure traces, applying edits, re-running. Verification must run live code; a transcript of that session is the primary evidence and this appendix is the synthesis.

---

## Sign-off Checklist (before kicking off Phase 0)

- [ ] Context7 MCP reachable; every library version in §4 re-verified with `[Context7: pkg@version]` citations
- [ ] Zod↔JSON-Schema direction decided (A vs B in §4)
- [ ] `citty` vs `commander v12` confirmed (citty pre-1.0 velocity check)
- [ ] `tsdown` vs `tsup` confirmed (tsup deprecation status reverified)
- [ ] Two engineers vs one assigned (determines 5-mo vs 6.5-mo timeline)
- [ ] LiteLLM proxy version confirmed to support pinned `openai@6.34.x`
- [ ] PR template drafted that enforces "port PRs change zero behavior"
- [ ] Baseline git tag (`v1.1.13-baseline`) created before Phase 0 merges
- [ ] Stakeholder communication plan for each AI-assistant integration (Claude Code, Cursor, Copilot, Windsurf)
- [ ] Per-phase agent team roster approved (see §2.5 — refine at phase kickoff via `/jumpstart.pitcrew`)
- [ ] `scripts/verify-baseline.mjs` authored and passing (runs full suite + baseline holodeck + CLI help snapshots; exits non-zero on drift)
- [x] Baseline tagged as `v1.1.14-baseline` (2026-04-24; commit `f9902e0`)
- [ ] `.jumpstart/config.yaml` has `project.type: brownfield` (scout precondition)
- [ ] `/jumpstart.scout` run and `specs/codebase-context.md` produced (supersedes §1 of this synthesis)
- [ ] `/jumpstart.challenge [rewrite jumpstart-mode in TypeScript]` run and `specs/challenger-brief.md` produced (genuinely stress-tests the rewrite before Phase 0 code lands)
- [ ] `/jumpstart.analyze` → `specs/product-brief.md`
- [ ] `/jumpstart.plan` → `specs/prd.md`
- [ ] `/jumpstart.architect` → `specs/architecture.md`, `specs/implementation-plan.md`, `specs/decisions/*.md`
- [ ] `/jumpstart.pitcrew [phase 0]` run to confirm the Phase 0 roster (native Architect + DevOps + QA + Reviewer, plus external `framework-docs-researcher` for Context7 version lookups)
