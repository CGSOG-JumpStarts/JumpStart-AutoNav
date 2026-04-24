---
id: "adr-002"
phase: 3
agent: Architect
status: Provisional
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

# ADR-002: CLI Framework — commander v14 (provisional pending T4.7.0 depth-cost analysis)

> **Status:** Provisional (may invert to citty post-M8 depth-cost analysis)
> **Date:** 2026-04-24
> **Decision Maker:** The Architect

---

## Context

The CLI ships 147 leaf subcommands across a 4–5-level argv dispatch tree (argv[2] through argv[5] depth — confirmed by Pit Crew Adversary code count). The TypeScript rewrite must register all 147 with:
- Byte-identical `--help` output (NFR-R02; `scripts/diff-cli-help.mjs` gate)
- Type-safe argument parsing
- Consistent subprocess IPC dispatch for the dual-mode lib modules (every `bin/lib/<name>.js` is also a runnable subcommand)

Two primary candidates from the PRD and rewrite plan: **commander v14.0.3** (mature) vs **citty v0.2.2** (pre-1.0, UnJS-ecosystem).

Context7 re-verify 2026-04-24 findings:
- Commander is at v14.0.3, **NOT v12 as the rewrite plan originally cited** (2 majors ahead).
- Citty v0.2.0 was a breaking release 3 months ago; breaks were in arg-parser + ESM-only flip — **NOT in `subCommands` registration API**, which is the surface this codebase consumes.
- Commander has 9,700+ npm dependents; citty has an order of magnitude fewer, concentrated in UnJS ecosystem (Nuxt, Nitro).

---

## Decision

**Provisional**: Use **commander v14.0.3** (pinned `^14.0.3`; exclude v15 pre-release) for Phase 0 through M7 port work. All of the architecture document, Technology Stack, Project Structure, and C4 Container diagram currently name commander v14.

**Final resolution deferred to implementation-plan T4.7.0 (gated `[Blocker]`)**: before the CLI dispatcher port begins (M8), run a concrete depth-cost analysis: actual `.addCommand()` call count + lines-of-boilerplate required for the 147-leaf 4–5-level tree in commander, compared to citty's lazy `subCommands` map equivalent. If commander's explicit nesting requires materially more boilerplate (threshold: >1000 lines of chain-registration code that citty would avoid), invert the decision back to citty and execute a coordinated sweep across architecture.md + Technology Stack + C4 diagram + all earlier implementation-plan references BEFORE T4.7.1 (actual port) begins.

**Upgrade pathway either way**: citty is documented as the preferred upgrade target at v1.0 OR after 12 months of post-1.0 stability, whichever comes first. If commander v14 is used and citty reaches v1.0 stable, a future minor (post-2.0) may migrate.

---

## Consequences

### Positive
- **If commander**: Mature (14+ majors since 2011), 9,700+ dependents, predictable TS types, rich ecosystem of examples; zero ecosystem-churn risk during rewrite.
- **If citty (post-T4.7.0 inversion)**: Lazy `subCommands` map scales naturally to 147-leaf tree; ESM-first; closer alignment with modern UnJS tooling; less boilerplate.
- Provisional-with-quantitative-gate model: architectural decision doesn't harden on vibes alone; Turn 2 implementation-plan places the resolution squarely at T4.7.0 before the port begins.

### Negative
- Sweep risk: if T4.7.0 flips to citty, 5+ documents + many narrative references need coordinated update in one PR before port begins. Risk mitigated by running T4.7.0 as the **first** task of M8, so the sweep happens before any port code depends on the choice.
- Pre-1.0 stability concern for citty documented but not closed; depth-cost analysis may find commander boilerplate acceptable, re-confirming commander.

### Neutral
- Both libraries support `.d.ts` export; neither blocks Must Have #2 (machine-readable return shapes).

---

## Alternatives Considered

### citty (pinned as Phase 0 choice)
- **Description:** Adopt citty from day 1; pin `^0.2.2`; accept pre-1.0 status.
- **Pros:** Lazy subCommands map is a cleaner fit for 147-leaf tree; ESM-first; UnJS ecosystem alignment.
- **Cons:** Pre-1.0 with a breaking change 3 months ago; smaller ecosystem; less community troubleshooting content.
- **Reason Rejected at Turn 2**: provisionally rejected until T4.7.0 depth-cost analysis; may flip back if commander's boilerplate exceeds the threshold.

### Custom minimal CLI (hand-roll)
- **Description:** Write our own argv parser + subcommand dispatcher.
- **Pros:** Zero third-party lock-in.
- **Cons:** Re-implements the 5,359-line monolith we're trying to escape. No `--help` generation, no completion, no mature argument-parsing primitives.
- **Reason Rejected:** Strictly worse than either candidate; defeats the rewrite's modernization purpose.

### clipanion / cac / oclif
- **Description:** Other CLI frameworks in the ecosystem.
- **Pros:** Each has its strengths; oclif in particular has Salesforce-scale adoption.
- **Cons:** Clipanion stuck on RC for >1 year; cac has low maintenance velocity; oclif is heavier and more opinionated about project structure than needed here.
- **Reason Rejected:** Commander + citty already cover the design space; adding a third candidate doesn't sharpen the decision.

---

## References

- [specs/architecture.md ADR-002 summary](../architecture.md#architecture-decision-records)
- Context7 re-verify 2026-04-24: commander@14.0.3, citty@0.2.2
- Pit Crew Adversary Finding 2 (depth-cost analysis correctness)
- [specs/implementation-plan.md T4.7.0 `[Blocker]`](../implementation-plan.md#milestone-9-m8--cli-dispatcher-stage-47)
