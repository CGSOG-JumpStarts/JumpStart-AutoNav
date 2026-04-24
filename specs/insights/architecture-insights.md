# Architecture -- Insights Log

> **Phase:** 3 -- Technical Design
> **Agent:** The Architect
> **Parent Artifact:** [`specs/architecture.md`](../architecture.md)
> **Created:** 2026-04-24
> **Last Updated:** 2026-04-24

---

## Entries

### 💡 Two-turn split deliberate, not a timid phasing

**Timestamp:** `2026-04-24T23:30:00Z`

Samuel chose option β (two-turn Architect phase) after Phase 2 seal. The split isn't about caution; it's about **review granularity**. Architecture decisions (stack, components, data model, security posture) are conceptually separable from implementation decomposition (per-module task breakdown) and ADR authorship (decision memos with alternatives + rationale).

Turn 1 produces the technical skeleton. Turn 2 translates that skeleton into per-module work items and full-narrative ADRs. Samuel can reject the skeleton without wasting ADR-authoring effort; Samuel can reject the implementation plan without re-litigating the stack choice.

If this were a single-turn Architect phase, the Pit Crew's highest-value findings would all attach to the largest document in the workflow — making integration passes heavier and making it harder for the human to see which findings touch which layer.

---

### 💡 commander v14 over citty — the Context7 re-verify was load-bearing

**Timestamp:** `2026-04-24T23:40:00Z`

The PRD's E3-S9 and the product-brief's Competitive Analysis both framed citty as the primary CLI-framework candidate with commander v12 as a fallback. The Context7 re-verify pass (2026-04-24) materially changed the picture:

- **commander v14.0.3** — not v12 as the PRD said. Two major versions ahead, continuously maintained, 9,700+ dependents, v15 pre-release visible.
- **citty v0.2.2** — pre-1.0, first breaking release (v0.2.0) landed 3 months ago. Ecosystem coverage concentrated in UnJS (Nuxt, Nitro).

The maintenance-velocity asymmetry is stark for a 6–12 month rewrite timeline. Citty's pre-1.0 status combined with a 3-month-old breaking change means the rewrite would absorb citty's next major transition **during execution**. Commander v14 is stable, opinionated, and has 14 majors of track record.

**The decision inversion was driven by Context7 re-verify, not by architectural preference.** If the PRD had been re-verified earlier (Phase 2), this could have been locked before Phase 3. The cost of discovering late: no material harm this turn, but the precedent is that Context7 re-verify should run at Phase 1 start OR earlier, not just at Phase 3 pre-seal.

→ ADR-002 for the full rationale in Turn 2.

---

### 💡 Schema Direction A locked — Zod fromJSONSchema experimental status killed Direction B

**Timestamp:** `2026-04-24T23:45:00Z`

The rewrite plan §4 and PRD both flagged a choice between:
- **Direction A**: JSON Schema canonical, Zod generated at build
- **Direction B**: Zod canonical, JSON Schema emitted via `z.toJSONSchema()`

Direction B is architecturally cleaner (single source of truth in TypeScript) and aligns with the "spec-first" ethos. But the Context7 re-verify confirmed `z.fromJSONSchema()` is **experimental** in Zod v4.3 — not guaranteed round-trip-sound. That means Direction B's round-trip confidence (JSON Schema → Zod → code → JSON Schema emission) is weaker than Direction A's (JSON Schema → Zod, one-way codegen).

Direction A chosen. Preserves the `.jumpstart/schemas/*.json` files that AI assistants and downstream consumers currently read. Migration path to Direction B preserved as a future-major option if `fromJSONSchema()` graduates to stable.

**Side effect**: `zod-to-json-schema` (third-party bridge that was historically the Direction A→B option) is now **unmaintained** per Context7 re-verify (deprecation notice November 2025). Not adopted.

→ ADR-004 for the full rationale in Turn 2.

---

### 💡 Error model as the one net-new architectural primitive

**Timestamp:** `2026-04-24T23:50:00Z`

The architecture document introduces `src/errors.ts` (JumpstartError hierarchy) as the only genuinely new structural primitive not present in the v1.1.14 codebase. Everything else in the target `src/` tree maps 1:1 to Scout's 12 clusters.

The error hierarchy is load-bearing for three reasons:

1. **Replaces 204 scattered `process.exit()` calls** (verified by Pit Crew Adversary: 77 in `bin/lib/`, 113 in `bin/cli.js`, 14 in runners) — currently distributed across lib modules; centralizing into thrown errors + two top-level catch sites (CLI main + IPC runner) enables library-mode testability without subprocess spawning.
2. **Operationalizes VC1** — typed errors carry `{ exitCode, phase?, artifact? }` structured fields; drift harness can assert on error *class*, not on a string match against stderr.
3. **Mechanical enforcement via E2-S7** — `scripts/check-process-exit.mjs` allowlist ensures the error model isn't silently violated.

The *Result<T, E>* pattern was considered and rejected as verbose for a CLI's exit-code-oriented error surface. For a server or library where errors are routinely recoverable, Result is the right abstraction; for a CLI whose errors predominantly terminate the invocation, thrown typed errors + a single catch site is the simpler model.

→ ADR-006 for the full rationale in Turn 2.

---

### 💡 IPC envelope version flag minimal-hook

**Timestamp:** `2026-04-24T23:55:00Z`

The dual-mode lib pattern (library + subprocess with stdin/stdout JSON) is non-negotiable preservation surface. The only additive change at 2.0: envelopes gain `"version": 1`. Consumers without the field continue to work because v0 envelopes have an implicit-contract reading.

The minimal-hook design trades off against a richer envelope spec:

- **Rejected**: tagged-union discriminator on payload type (`{ "type": "request" | "response" | "error", ... }`) — too much change for v2.0 first-break release; AI-assistant consumers already work with the implicit envelope.
- **Rejected**: versioned schema URI per envelope (`"$schema": "..."`) — overkill for a stdin/stdout microservice whose consumers are AI agents, not web clients.
- **Chosen**: single `"version"` integer field added additively. If future evolution needs a breaking change, bump to `"version": 2` with a documented migration path.

→ ADR-007 for the rationale in Turn 2.

---

### 🔍 Technology choices minimized "cross-library risk"

**Timestamp:** `2026-04-25T00:00:00Z`

For each layer, the chosen technology either:
- **Is already used** in v1.1.14 and validated through 84 test files (yaml, openai, vitest)
- **Is an ecosystem-standard with 1M+ weekly downloads** (picocolors, zod, commander)
- **Is the documented migration path from a deprecated choice** (tsdown from tsup)
- **Has explicit pre-1.0 red flags** that are acknowledged and pinned exact (tsdown@0.21.10)

Zero "architecturally bold" choices. This is intentional — a solo-maintainer rewrite at production quality cannot afford ecosystem gambles. Every technology has a documented fallback (plain `tsc` for tsdown; commander v14 is itself the fallback from citty; ESLint+Prettier for Biome; `@inquirer/prompts` for @clack/prompts; chalk v5 for picocolors).

The Product Brief's Competitive Landscape row 4 ("JS-plus bundle: Biome + Zod + @ts-check on public API") technically covers ~70% of the rewrite's value at ~25% of the cost. The architect-level counter-argument: the modernization (ESM-only, strict TS, modern commander, modern vitest) IS the bigger win, and those are locked at the technology-stack layer — not at the language-choice layer.

---

### ⚠️ Risks the Architect is inheriting and NOT attempting to eliminate

**Timestamp:** `2026-04-25T00:05:00Z`

Documented for Turn 2 ADR integration:

1. **tsdown pre-1.0 velocity** — 10 releases in 2 months. Pinned exact at `0.21.10`. If tsdown ships a breaking 0.22 during the rewrite, the fallback is plain `tsc` + a small shell shebang post-step (~1 day of switching cost).
2. **commander v15 pre-release exists** — may land as stable during the rewrite. Pin `^14.0.3` and explicitly do NOT accept `^14` floor that could float into v15 pre-release.
3. **Node 24 EOL is 2028-04-30 (Maintenance)** — rewrite ships late 2026 with 18+ months of Active LTS then 18+ months of Maintenance. Acceptable for the rewrite's useful lifetime.
4. **json-schema-to-zod dependency** — not verified post-Context7; Turn 2 will verify its maintenance status before ADR-004 finalizes.
5. **npm publish rights (KU-03)** — ADR-008 documents but does not solve; blocks Phase 8 cutover.
6. **The E3-S8 / duplicate-file reconciliation** (`bin/lib/holodeck.js` vs `bin/holodeck.js`) — left as a Developer choice at Phase 4 port time; Architect did not prescribe one duplicate as canonical.

---

### 📊 Volumetric summary of Turn 1

**Timestamp:** `2026-04-25T00:10:00Z`

- `specs/architecture.md` — ~720 lines, 17 sections, 1 C4 Container diagram
- 15 pinned technologies across 14 layers
- 12 persisted data entities mapped
- 16 system containers + 3 net-new (error hierarchy, Deps seam, IPC adapter)
- 8 ADR summary entries (full ADRs in Turn 2)
- 6-area self-verification: 6/6 satisfied

Turn 2 artifacts (to be produced):
- `specs/implementation-plan.md` — per-module task decomposition aligned to PRD's E3 stories and rewrite plan §7 phases
- `specs/decisions/adr-001-build-tool.md` through `adr-012-secrets-redaction-in-logs.md` (**12 ADRs** after Pit Crew security expansion; originally 8 in the v1.0.0 draft)

---

---

### 🔍 Pit Crew findings integrated (17 fixes applied per option β)

**Timestamp:** `2026-04-25T00:45:00Z`

A 3-agent Pit Crew (Adversary + Reviewer + QA, all Sonnet 4.6) returned HOLD on the v1.0.0 architecture draft with ~17 findings. Samuel approved option β: Bucket A (11 Turn-1 fixes) + Bucket B (5 security-hardening additions) applied now; Bucket C (4 items) deferred to Turn 2 with `[Turn 2]` markers in-document.

**The 4 most structurally significant fixes:**

1. **ADR-006 error-hierarchy honesty (Adversary WOBBLES)**. The v1.0.0 claim of "mechanical replacement of 184 `process.exit()` calls" was revised to acknowledge the actual count (204: 77 in bin/lib/, 113 in bin/cli.js, 14 in runners) AND to acknowledge that library-body exits (e.g., `io.js`'s `wrapTool()`) require per-site judgment, not blind translation. ADR-006 now specifies **two** allowlisted catch sites (CLI main + IPC runner) rather than one, and defers the per-site decision tree to Turn 2 with a mandate to specify `runIpc()` catch semantics explicitly.

2. **ADR-004 schema rationale corrected (Adversary COLLAPSES)**. The v1.0.0 primary rationale — "preserves the JSON Schema surface AI assistants read" — was a phantom claim (grep confirmed zero references to `.jumpstart/schemas/*.json` in `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.windsurfrules`). Direction A is still correct, but the rationale is now reframed around (a) `z.fromJSONSchema()` experimental status and (b) the existing `bin/lib/validator.js` migration path — real constraints rather than inherited assumption.

3. **ADR-005 path contradiction resolved (Reviewer MF-4)**. The v1.0.0 draft showed `src/lib/` as the final TS home while the PRD's E1-S1 tsconfig paths alias resolved `@lib/*` to `bin/lib-ts/*` first. Both were correct at different phases; ADR-005 now explicitly documents the strangler-phase intermediate (`bin/lib-ts/*.ts`) and the 2.0-cutover move to `src/lib/`, reconciling the two documents.

4. **ADR-002 commander-over-citty made provisional (Adversary WOBBLES)**. The v1.0.0 claimed the decision on maturity grounds; Adversary correctly flagged that the actual depth-of-nesting cost for a 147-leaf 4-5-level tree was never computed. ADR-002 now documents the decision as **provisional** — subject to Turn 2's concrete `.addCommand()` count vs citty's `subCommands` lazy-map count analysis. If commander's boilerplate is materially worse, ADR-002 may invert back to citty. Citty's v0.2.0 break was also narrowed (it was in arg-parser + ESM flip, NOT in `subCommands` API), reducing the original risk rationale.

**5 Bucket B Security hardening ADRs added (ADR-009 through ADR-012 + SEC-005 shebang gate):**

The v1.0.0 draft had a minimal STRIDE table. Pit Crew QA's security audit surfaced 5 High/Medium-severity gaps that are now explicit architecture concerns with Turn-2-bound ADRs:

- **SEC-001 / ADR-009**: IPC stdin path-traversal — AI agent subprocess calls could read `/etc/passwd` via unsanitized path fields. Zod `.refine()` schemas + `path.resolve` prefix-check canonicalization in `src/lib/ipc.ts`'s `runIpc()`.
- **SEC-002 / ADR-010**: Marketplace ZIP-slip — SHA-256 doesn't prevent extraction traversal. Path-canonicalization + reject-on-escape in `src/lib/install.ts`.
- **SEC-003**: Continuous-window CVE gap — Dependabot security-updates with auto-merge on `audit-level=high`; 48-hour SLA target to ship patches to npm.
- **SEC-004 / ADR-011**: LLM endpoint validation — `LITELLM_BASE_URL` HTTPS-or-localhost allowlist; override via `JUMPSTART_ALLOW_INSECURE_LLM_URL=1` escape hatch for legitimate test setups.
- **SEC-005**: Shebang CI assertion — post-build step in `typescript.yml` ensures `dist/cli.js` starts with `#!/usr/bin/env node`. This was the Pit Crew QA "single highest-value missing gate."
- **SEC-006 / ADR-012**: Secrets in logs — `process.argv` capture in `usage-log.json` / `state/timeline.json` could include `--api-key sk-xxx` style invocations; secret-scanner integration at log-write time redacts before persist.

**Turn-2 deferrals (Bucket C — 4 items with explicit markers in-document):**

1. ADR-006 library-body exit decision tree + empty-catch lint rule
2. ADR-002 commander v14 depth-cost quantitative analysis (may reopen citty)
3. ADR-007 IPC v0↔v1 backward-compat fixture matrix (`tests/fixtures/ipc/<module>/v0/` + `v1/`)
4. ADR-008 CVE-discovery-to-patch SLA + dependency-confusion mitigation posture

**Other Bucket A fixes applied:**

- risk_level restored to `high` (template default; v1.0.0 silently downgraded to medium)
- NFR-P01/P02/P03 explicit thresholds added to §Infrastructure with NFR-Traceability column tying each CI workflow to specific NFR IDs
- `runIpc`/`IpcHandler` canonical TypeScript prototype added to §API Contracts (SF-4 — highest developer-actionable gap)
- `docs/upgrade-to-2.0.md` added to §Project Structure (E6-S4 deliverable)
- Six Core Areas rubric replaced with template-canonical Commands/Testing/Project Structure/Code Style/Git Workflow/Boundaries; Architect-Design-Coverage retained as supplementary self-check
- `json-schema-to-zod` version pinned (`^2.6.0`) with Turn-2 verify marker
- C4 Container diagram annotated: "C4-inspired, not strict C4" — `dist/`, `Error Hierarchy`, `Deps Seam`, `IPC Adapter` correctly identified as Level-3 components rendered at container level for narrative convenience
- Deps Injection Seam noted as narrative-only (not in C4 diagram) per Reviewer SF-3

**Meta-lesson**: the Pit Crew on a Turn-1 architecture document produced higher-leverage findings than the PRD pit crew (17 fixes vs 20, but materially bigger — 4 new ADRs born from security-audit gaps the v1.0.0 draft entirely omitted). The pattern — draft → Pit Crew → integrate → Samuel approval → seal — now has proven value across PRD + Architect Turn 1.

→ See the updated [ADR table](../architecture.md#architecture-decision-records), [§Security Architecture](../architecture.md#security-architecture), [§API Contracts](../architecture.md#api-contracts), and [§CI/CD NFR Traceability](../architecture.md#cicd) sections for the integrated revisions.

---

## Cross-references

- [Challenger Brief](../challenger-brief.md) — constraints, validation criteria
- [Product Brief](../product-brief.md) — personas, MH1-7, Node 24 decision, competitive analysis
- [PRD](../prd.md) — epics, stories, NFRs with IDs (NFR-Pxx/Sxx/Rxx/Bxx/Oxx/Dxx), task breakdown, success metrics
- [Codebase Context](../codebase-context.md) — Scout inventory, 12-cluster taxonomy preserved in target `src/`
- [TypeScript Rewrite Plan](../typescript-rewrite-plan.md) — synthesis + Appendix A (agent disagreements), §4 dependency matrix
- [PRD Insights](prd-insights.md) — Pit Crew-driven revisions pattern inherited from Phase 2
- Context7 re-verify subagent: `a836ae654a4a72873` (2026-04-24T23:45Z)

---

### 🔍 Turn 2 Pit Crew — three rounds, 21 fixes integrated

**Timestamp:** `2026-04-25T01:00:00Z`

After Turn 1 sealed v1.0.2 with 17 + 5 Pit Crew fixes (across 2 Turn-1 rounds), Turn 2 produced `specs/implementation-plan.md` + 12 ADRs in `specs/decisions/`. Pit Crew run on Turn 2 was structured as:

**Round 1 — Reviewer alone (craft + downstream usability):** 3 🔴 Must Fix + 5 🟡 Should Fix.
- Critical: `path-safety.ts` (ADR-009 mandate) had no authoring task; E2-S4 misattributed to ADR-004; test-file count 83 vs 84 inconsistent across architecture+plan.
- All 8 applied as surgical edits.

**Round 2 — Adversary + QA in parallel on the post-Round-1 artifacts:** 5 🔴 + 8 🟡 additional. The Adversary's most consequential finding:

> *"`secret-scanner.ts` orphan: ADR-012 says it ports in M3, but M3's task list doesn't include it. T4.3.3 imports it as if available. COLLAPSES."*

Result: T4.2.4b added to M3 explicitly porting `secret-scanner.ts` with the new `redactSecrets<T>(value: T): T` recursive helper.

Adversary's second-most consequential finding:

> *"T4.7.0's '1000-line threshold' lives only in ADR-002. Developer reading the task table at Phase 4 sees 'compute' with no decision criterion."*

Result: T4.7.0 task description rewritten to embed the threshold AND task `scripts/estimate-commander-boilerplate.mjs` so the comparison is machine-produced JSON, not honor-system human judgment.

QA's killer finding:

> *"IPC v0/v1 fixture authoring deferred to M8: 60+ modules ported in M2–M7 without per-module backward-compat enforcement; regression in `runIpc()`'s v0/v1 logic at M3 unseen until M8."*

Result: per-module port recipe augmented to **11 steps** (was 10); step 11 mandates v0/v1 fixture authoring at port time, not deferred. Fixture naming standardized on ADR-007's `<v>/input.json` + `<v>/expected-stdout.json` (PRD's `in.json`/`out.json` reference superseded; deviation logged).

**All 21 Pit Crew fixes (Round 1 + Round 2) integrated** into v1.0.1 of implementation-plan.md and the 12 ADRs. ADR-008 specifically expanded with **escalation triage criteria** distinguishing paths (a)/(b)/(c) with time-bounds (≤ 14 days for feature removal at (a); ≤ 30 days for documented-acceptance at (b); fork-and-patch (c) when others infeasible).

**Net Phase 3 scoring**:

| Round | Findings | Applied |
|---|---|---|
| Turn 1 — Adversary + Reviewer + QA + framework-docs-researcher (Round 1) | 17 | 17 |
| Turn 1 — Adversary + Reviewer (Round 2 verification) | 5 | 5 |
| Turn 2 — Reviewer (Round 1) | 8 | 8 |
| Turn 2 — Adversary + QA (Round 2) | 13 | 13 |
| **Total Phase 3** | **43** | **43** |

The Pit Crew pattern is paying compound interest: each round catches material issues the previous round missed because the lens differs. Reviewer's craft pass cannot find Adversary's "this number is inflated" claims; QA's testability pass cannot find Reviewer's "this contradicts an upstream artifact" claims.

→ Both artifacts validate post-fix; ready to seal Phase 3.

---
