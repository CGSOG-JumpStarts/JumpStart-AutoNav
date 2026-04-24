# PRD -- Insights Log

> **Phase:** 2 -- Planning
> **Agent:** The PM
> **Parent Artifact:** [`specs/prd.md`](../prd.md)
> **Created:** 2026-04-24
> **Last Updated:** 2026-04-24

---

## Entries

### 💡 Epic boundaries favor cross-cutting infrastructure over pure per-module ports

**Timestamp:** `2026-04-24T22:30:00Z`

The Product Brief listed 7 Must Haves. The natural temptation was to make each Must Have its own epic (one epic per Must Have, 7 epics total). I rejected that structure because it would fragment the port work — MH1 (typed modules), MH4 (ESM flip), and MH6 (incremental releases) are all enabled by the SAME activity: porting `bin/lib/*.js` to TS. Splitting them into three epics would duplicate stories and obscure dependencies.

Instead, I grouped:
- **E1 Baseline Tooling** — one-time infrastructure setup (dependencies of everything else)
- **E2 Detection Infrastructure** — the mechanisms that enforce MH5 + MH7 (production-quality floor + contract-drift detection)
- **E3 Module Port** — the actual port work, absorbing MH1 + MH4 + MH6 into dependency-ordered cluster stories
- **E4 CLI Contract Preservation** — MH3's specific concern (behavior preservation) elevated to its own epic because the mechanism spans all ports
- **E5 2.0 Cutover** — MH4's final step + MH6's terminal release, elevated because RC soak is a discrete activity
- **E6 Housekeeping** — KU resolutions + CHANGELOG, Should-tier parallel work

Alternatives considered:
- One-epic-per-cluster (12 epics) → too many; violates the "3-7 epics" guideline and would fragment the "port every module" narrative
- One-epic-per-phase (10 epics per plan §7 timeline) → confuses milestones with epics; phases are temporal, epics are about coherent value delivery
- One-mega-epic for the whole rewrite → loses granularity; can't prioritize within

The 6-epic structure hits the sweet spot: each epic can ship independently to demonstrate progress (M0 ships usable infrastructure; M1 ships the detection harness that's valuable on its own even before ports begin; M2+ each milestone adds real coverage).

→ See [Epics](../prd.md#epics) table.

---

### 💡 Story sizing: cluster-as-story for E3 rather than module-as-story

**Timestamp:** `2026-04-24T22:35:00Z`

Decision: E3 has 9 stories (one per lib cluster), not 159 stories (one per module). Rationale:

- **PRD-level scope:** the PM's job is requirements decomposition to the level where Architect can design and Developer can execute. Going to per-module granularity is Architect/Developer work (Phase 3 / Phase 4).
- **Cluster granularity matches the rewrite plan:** `specs/typescript-rewrite-plan.md` §1 defines 12 clusters; the PRD's E3 stories correspond roughly 1:1 to those clusters (with some combined for batch efficiency). This preserves traceability without explosion.
- **Acceptance criteria at cluster level:** per-module acceptance criteria ("module X is typed") would be repetitive. Cluster-level criteria ("every module in cluster N has a typed signature, tests pass via strangler alias, harness green, coverage ratchet holds") cover what's actually verifiable.

Alternative: one story per cluster, explicit per-module task decomposition in Task Breakdown section. I chose to leave per-module tasks implicit under cluster stories, with the explicit per-port recipe at §Task Breakdown Stage 4. Architect can expand that recipe into 159 explicit tasks in `specs/implementation-plan.md`.

Risk of this choice: if Samuel or a reviewer wants to track per-module status, the PRD doesn't support it directly. Mitigation: the per-port recipe at Stage 4 names the exact checklist for each port, so module-level tracking happens at PR/issue level, not PRD level.

→ See [User Stories § E3](../prd.md#e3--module-port--strangler-fig-migration).

---

### 💡 Acceptance criteria granularity: heavy on E1 / E2, light on E5 / E6

**Timestamp:** `2026-04-24T22:40:00Z`

E1 (tooling) and E2 (detection infrastructure) have detailed Gherkin acceptance criteria because they introduce NEW artifacts (tsconfig, biome.json, CI workflows, scripts) that didn't exist in v1.1.14. Each of those is developer-actionable and reviewer-checkable.

E3 (module ports) has acceptance criteria captured as a repeating per-port recipe (Task Breakdown Stage 4) rather than per-cluster Gherkin. Individual port PRs will have CI gates as their "acceptance" — the criteria are enforced mechanically at merge time, not audited from the PRD.

E4 (CLI preservation) has detailed Gherkin for the snapshot infrastructure because snapshots are artifacts that need review.

E5 (cutover) has light Gherkin because the cutover steps are well-documented in `specs/typescript-rewrite-plan.md` §7 Phase 8; duplicating them in the PRD adds bureaucracy without clarity.

E6 (housekeeping) has minimal Gherkin because the stories are "do the thing" — npm ownership verification is a shell command, CHANGELOG is prose authoring.

This uneven granularity is deliberate. Applying uniform Gherkin depth would balloon the PRD without adding value; applying uniform light-touch would lose the developer-actionable specificity where it actually matters (E1, E2, E4).

→ See spec-writing.md §5 for the principle: "acceptance criteria granularity should match reviewer need, not a universal rubric."

---

### 🔍 KU-04 spike shaped E2-S4 in real-time

**Timestamp:** `2026-04-24T22:45:00Z`

The KU-04 empirical spike ran in parallel with the PRD's opening sections. Its QUALIFIED verdict (`.d.ts` helps on complex modules, not on simple ones with well-written JSDoc) landed while I was drafting E2. Without the spike, E2-S4 would have been phrased as *"emit `.d.ts` for every lib module"* — a direct translation of product-brief MH#2.

Spike outcome let me refine E2-S4 to the actually-useful requirement: *"machine-readable return-type shapes on any function with >2 fields or optional branches, via JSDoc `@returns {{ ... }}` OR typed TS return signature OR `.d.ts`."* The agent benefit is identical across mechanisms; `.d.ts` is an artifact, not the product.

This is a concrete example of the Pit Crew / empirical-spike pattern adding value in-phase, not just as after-the-fact critique. The spike cost 2-3 minutes of parallel wall-clock, saved a Must Have from over-specifying its solution.

Meta-note: the spike's verdict softens the differentiation claim between the TS rewrite and the "JS-plus" competitive alternative (from product-brief §Competitive Landscape). If JSDoc can be disciplined to emit machine-readable return shapes (E2-S4 enforcement), the JS-plus alternative closes more of the gap than the original product-brief implied. Path α remains in force (per Samuel's Phase 0 decision) but the PRD is honest about narrower TS-specific differentiation: editor tooling ergonomics, refactor safety at scale, ecosystem typings depth — NOT universal type-safety delta.

→ See E2-S4 acceptance criteria and E6-S1 (marked COMPLETED).

---

### 💡 NFR performance targets are based on observed baselines, not aspirational

**Timestamp:** `2026-04-24T22:50:00Z`

Every NFR performance target in §Non-Functional Requirements has a measured-baseline reference:
- **CI wall-clock ≤ 5 min P95** — anchored to Node 20 batched vitest runs currently taking ~4 min; typescript.yml adds incremental TS compile overhead, target allows some slack.
- **CLI cold-start ≤ 500 ms P95** — untested today; a benchmark script is part of the NFR ("verified via `scripts/bench-cli-startup.mjs`"). If v1.1.14 already exceeds 500 ms, Architect adjusts the target or the implementation.
- **Test suite ≤ 10 s** — observed baseline 3.43 s; target leaves room for ~3x growth (TS transform cost + new harness).
- **Package tarball ≤ 1.5 MB** — observed 1.1 MB; 50 % headroom for the `dist/` output (TS build artifacts) after we stop shipping `bin/` source.

This grounds the NFRs in reality. A common PRD failure mode is NFRs like "fast" or "sub-second" that were never measured. The PM avoids this by citing observed baselines + specified headroom in every target.

→ See NFR section.

---

### 🔍 Implementation milestones map 1:1 to rewrite plan §7 phases, but revised timeline

**Timestamp:** `2026-04-24T22:55:00Z`

M0 through M10 in the Implementation Milestones section each correspond to a phase in `specs/typescript-rewrite-plan.md` §7. The mapping is direct:
- M0 Tooling = Rewrite Plan Phase 0
- M1 Detection = (new; supplement to Phase 0)
- M2 = Rewrite Plan Phase 1 (leaves)
- M3 = Rewrite Plan Phase 2 (schema & validation)
- M4 = Rewrite Plan Phase 3 (features batch 1)
- M5 = Rewrite Plan Phase 4 (features batch 2)
- M6 = Rewrite Plan Phase 5 (marketplace)
- M7 = Rewrite Plan Phase 6 (runners)
- M8 = Rewrite Plan Phase 7 (CLI dispatcher)
- M9 = Rewrite Plan Phase 8 (2.0 cutover)
- M10 = Rewrite Plan Phase 8 soak + promotion
- M11 = Rewrite Plan Phase 9 hardening + housekeeping

The only new milestone is M1 (Detection Infrastructure) which was added per Pit Crew QA feedback as a pre-requisite for meaningful port PRs. It sits between M0 and M2 chronologically.

Timeline: Adversary's math (159 modules / 26 weeks = 6/week vs current ~2/week) is reflected in the PRD's 9-12 month realistic range. The PM does NOT re-set timeline targets inside milestones; Architect (Phase 3) sets concrete duration estimates based on this realistic range. The 6.5-month plan §7 target is retained as a stretch goal in `specs/product-brief.md` § Constraints but isn't the PRD's planning anchor.

→ See [Implementation Milestones](../prd.md#implementation-milestones).

---

### 📊 Volumetric summary of Phase 2

**Timestamp:** `2026-04-24T23:00:00Z`

- Step 1 (Context Summary) — absorbed into Execution Note + Product Overview
- Step 2 (Epic Definition) — 6 epics
- Step 3 (User Story Decomposition) — ~35 stories across the 6 epics (E3 cluster-level, others module-level or task-level)
- Step 4 (Acceptance Criteria) — Gherkin format, 2-5 criteria per Must Have story, heavier on E1/E2
- Step 5 (NFRs) — Performance, Security, Reliability, Backwards Compatibility, Observability, Documentation, Accessibility (N/A)
- Step 6 (Dependencies & Risks) — 4 external deps, 8 risks with owners
- Step 7 (Success Metrics) — 3 metrics mapping to revised VC1/VC2/VC3
- Step 8 (Implementation Milestones) — 12 milestones (M0-M11) mapped to rewrite plan Phase 0-9 + M11 housekeeping
- Step 9 (Task Breakdown) — Setup (Stage 1), Foundational (Stage 2), Detection (Stage 3), Ports (Stage 4 with per-port recipe), Cutover (Stage 5), Polish (Stage 6)
- Step 10 (Compile & Present) — in progress at this timestamp; Pit Crew review pending before seal

Artifacts produced this phase:
- `specs/prd.md` — ~620 lines
- `specs/insights/prd-insights.md` — this file

---

## Cross-references

- [Challenger Brief](../challenger-brief.md) — reframed problem, validation criteria, constraints
- [Product Brief](../product-brief.md) — personas, journeys, competitive analysis, MH1-7, Risks
- [Product Brief Insights § KU-04 spike](product-brief-insights.md) — empirical spike that shaped E2-S4
- [Requirements Responses](../requirements-responses.md) — PRD-checklist coverage
- [Codebase Context](../codebase-context.md) — ground-truth module inventory, clusters
- [TypeScript Rewrite Plan](../typescript-rewrite-plan.md) — synthesis + §7 phase structure that M0-M11 mirror

---

### 🔍 Pit Crew findings integrated before seal (20 fixes applied per option β)

**Timestamp:** `2026-04-24T23:30:00Z`

After the PRD draft was complete, a 3-agent Pit Crew (Adversary + Reviewer + QA, all on Sonnet 4.6) returned a HOLD verdict with 7 🔴 Must Fix + 9 🟡 Should Fix + 4 🟢 Nice to Have items. Samuel approved "option β — fix all." All 20 findings integrated as deterministic edits.

**The two highest-leverage findings:**

1. **VC1 metric was measuring the wrong event** (Adversary COLLAPSE). The original wording — *"count of `fix-drift` commits reaching main"* — inverted the signal. A `fix-drift` commit reaching main means the harness caught drift at PR time and the developer fixed it (VC1 **succeeding**), but the metric counted it as a failure. The revised measurement (§Success Metrics, updated) decouples: (a) **catches** at PR time = harness emits a per-CI-run log to `.jumpstart/metrics/drift-catches.json` (success events); (b) **misses** are drift that reaches main without a prior catch, audited retrospectively by an AST-diff scan of the trailing 6-month history. Target: ≥ 95 % catch rate; ≤ 1 post-merge miss per 6-month window.

2. **No enforcement for the "typed errors replace ~184 `process.exit()` calls" NFR** (QA highest-value missing test). Added as **E2-S7** Must-Have story: `scripts/check-process-exit.mjs` greps `src/**/*.ts` + `dist/**/*.js` for `process.exit(` with an allowlist of exactly one site (the top-level `src/cli/main.ts` handler), failing CI on any other occurrence. Without this, Phase 4 could have shipped the error-model NFR as aspirational prose.

**Other 🔴 Must Fix changes:**

3. **Six Must-Have stories had zero acceptance criteria** (E3-S4, E3-S5, E3-S6, E3-S8, E4-S2, E5-S2, E5-S4). Added 2-5 Gherkin criteria each, following the per-port recipe pattern for E3 clusters and specific behavioral checks for E4/E5.
4. **E2-S1 AC referenced a non-existent v1.1.13 fixture state.** Rewritten to reference a committed synthetic fixture at `tests/fixtures/contract-drift/simulation-tracer-vs-holodeck/` with 8-missing-method reproduction, plus an explicit analysis-method spec (TypeScript compiler API + Babel parser for JS; AST walk over `bin/lib/**/*.{js,ts}`).
5. **E3-S2 `config-yaml.cjs` deletion lacked ADR trigger.** Added `[ARCHITECT DECISION REQUIRED]` marker pointing at `specs/decisions/adr-config-yaml-cjs-elimination.md` (to be authored by Architect before E3-S2 execution).
6. **E4-S3 had wrong dependency on E2-S1** (contract harness). Changed to `E4-S1` (CLI help snapshot baseline) — the correct upstream for IPC fixture work.
7. **E3-S1 forced 100% coverage without a write-tests task.** Relaxed to "at or above baseline" per the coverage-ratchet rule; bringing a file to 100% is a follow-up story if desired.
8. **E2-S5 commit-msg exemption rule was underdefined** (said "see config" pointing at no config). Tightened: the ONLY exemption is the `^Merge (branch|pull request|tag)` allowlist for git's default merge commits. All other commits including GitHub squash-merge outputs must carry a conventional `type:` prefix. Added **E2-S5b** as a supplementary PR-title-linter GitHub Action to enforce squash-merge commit titles at PR-open time. Added VC3 bypass-mitigation notes covering `--no-verify`, squash-merge, and `--amend` — with a weekly audit script (`scripts/audit-no-verify-commits.mjs`) as the catch-net.

**Structural 🟡 Should Fix changes:**

9. **NFR section restructured** from prose paragraphs to template-compliant tabular format with stable IDs (`NFR-P01..P04`, `NFR-S01..S04`, `NFR-R01..R04`, `NFR-B01..B04`, `NFR-O01..O04`, `NFR-D01..D02`). `NFR-R03` explicitly formalizes the holodeck-baseline constraint from challenger-brief as a measurable requirement. `NFR-R04` formalizes the `process.exit()` → typed-error NFR that E2-S7 enforces.
10. **Milestone M5 dependency corrected** to include M3 (codebase-intel cluster imports from spec/graph cluster, not just LLM/state cluster from M4).
11. **"Verified via" language softened** on NFR-P02 (CLI cold-start) to "Local benchmark only (hardware-dependent, NOT CI-gated); script is a deliverable of Stage 2 (T2.10) — not yet written at PRD seal time." This is honest about the script's non-existence rather than claiming verification.
12. **Task breakdown additions:** T2.9b (snapshot diff script), T2.9c (PR-title lint workflow), T2.9d (no-verify audit), T2.10 (CLI bench script), T2.11 (test bench script), T2.12 (tarball size check), T3.7 (check-process-exit script), T3.8 (synthetic drift fixture).
13. **JSON-LD trace block expanded** from 3 to 6 entries: challenger-brief, product-brief, requirements-responses, codebase-context, ku-04-spike, pit-crew-phase-2-review.
14. **E1-S2 build-tool `[ARCHITECT DECISION REQUIRED]` marker added** — explicitly flags the tsdown / tsup / tsc choice as blocking for T2.1 / T5.1 / T5.2.
15. **E2-S4 analysis method explicit**: static AST-based analysis via TypeScript compiler API / Babel parser, not runtime reflection.

**Meta-lesson on the meta-lesson:** The Pit Crew review of the PRD took ~8 minutes wall-clock (parallel agent execution) and surfaced 20 concrete issues, of which 2 were "this metric measures the wrong event" — the kind of bug a rubber-stamp review misses entirely because the claim reads well. The compressed-elicitation pattern (compile → Pit Crew → integrate → seal) is now proven twice (Phase 1 + Phase 2). Worth keeping as the standard pattern through Architect + Developer phases.

→ See the updated [Success Metrics](../prd.md#success-metrics), [NFR tables](../prd.md#non-functional-requirements), [E2-S1](../prd.md#e2--contract-drift-detection-infrastructure), [E2-S5](../prd.md#e2-s5--commit-msg-hook-enforcing-type-trailer), [E2-S7](../prd.md#e2--contract-drift-detection-infrastructure), and [JSON-LD traces](../prd.md#linked-data) sections for the integrated revisions.

