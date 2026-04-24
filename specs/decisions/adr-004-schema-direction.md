---
id: "adr-004"
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

# ADR-004: Schema Direction — JSON Schema Canonical, Zod Generated at Build

> **Status:** Accepted · **Date:** 2026-04-24 · **Decision Maker:** The Architect

---

## Context

The rewrite needs runtime schema validation (for config files, phase gate handoffs, API contracts). Two primary options exist as of 2026:

- **Direction A**: JSON Schema canonical in `.jumpstart/schemas/*.json`; Zod schemas *generated* from JSON Schema at build time via `json-schema-to-zod`; TypeScript types flow via `z.infer<>`.
- **Direction B**: Zod canonical in `src/schemas/*.ts`; JSON Schema emitted via `z.toJSONSchema()` + (for round-trip) `z.fromJSONSchema()`.

Context7 re-verify 2026-04-24 findings:
- `z.toJSONSchema()` is **stable** in Zod 4.3.
- `z.fromJSONSchema()` is **experimental** in Zod 4.3 — round-trip soundness not guaranteed.
- The v1.1.14 codebase already has 7 JSON Schema files under `.jumpstart/schemas/` consumed at runtime by `bin/lib/validator.js` via `fs.readFileSync`.
- The historical `zod-to-json-schema` third-party bridge package is **unmaintained** (deprecation notice November 2025).

---

## Decision

**Direction A**: JSON Schema canonical; Zod generated at build time via `json-schema-to-zod@^2.6.0` (pinned pending final verification in Turn 2 verify marker).

- `.jumpstart/schemas/*.schema.json` is the source of truth.
- `scripts/generate-zod-schemas.mjs` emits `src/schemas/generated/*.ts` at build time.
- Generated Zod schemas ARE committed (not gitignored) so CI can diff them for drift detection (`git diff --exit-code src/schemas/generated/`).
- TypeScript types flow via `type Config = z.infer<typeof ConfigSchema>`.

Architecture v1.0.2 explicitly reframed the rationale per Pit Crew Adversary Finding 3: the primary reasons are (a) `fromJSONSchema()` experimental status rules out Direction B round-trip, and (b) `bin/lib/validator.js` already reads JSON Schemas — Direction A is the lower-risk port path. The earlier "AI assistants read schemas" framing was a phantom claim and has been removed.

---

## Consequences

### Positive
- Single source of truth (JSON Schemas) preserved from v1.1.14; no schema-migration work beyond porting the validator.
- AI assistants (indirectly via validator output) continue to receive the same validation semantics.
- Build-time codegen means Zod types are always in sync with JSON Schemas by construction.
- Generated Zod schemas committed → reviewable diffs on any schema change.

### Negative
- Two artifacts to keep in sync (though codegen enforces this automatically).
- Direction B's "edit TS types, JSON Schema auto-derives" DX is not available.
- Downstream consumers editing `.jumpstart/schemas/*.json` directly continue the existing workflow; no TS-first onboarding path.

### Neutral
- Migration to Direction B is not foreclosed: when `z.fromJSONSchema()` graduates to stable, a future major release could flip direction if DX benefits outweigh migration cost.

---

## Alternatives Considered

### Direction B (Zod canonical)
- **Description:** Zod schemas authored in TS; JSON Schemas emitted via `z.toJSONSchema()` at build.
- **Pros:** Stronger spec-first story; single TS source; TypeScript-first DX.
- **Cons:** Blocks on `z.fromJSONSchema()` experimental status — round-trip JSON-Schema-edit workflow unsupported. Also forces every downstream consumer who edits `.jumpstart/schemas/*.json` to learn Zod syntax instead.
- **Reason Rejected:** Experimental `fromJSONSchema()` + breaks existing consumer edit workflow.

### Dual-authoring (maintain both independently)
- **Description:** Hand-author JSON Schema AND Zod; reconcile via tests.
- **Pros:** No codegen step.
- **Cons:** Duplication is the exact bug class we're trying to eliminate in the rewrite.
- **Reason Rejected:** Violates the project's own principle against duplicate contract descriptions.

### Keep hand-rolled JSON Schema walker (no Zod)
- **Description:** Port `bin/lib/validator.js`'s hand-rolled walker to TS; don't adopt Zod at all.
- **Pros:** Zero new dependency; port is most mechanical.
- **Cons:** Loses the type-inference benefit; loses the ecosystem of Zod-based tooling (e.g., Zod → OpenAPI, Zod → form validators for a potential future UI).
- **Reason Rejected:** Gives up too much TypeScript-ergonomics upside.

---

## References

- [specs/architecture.md ADR-004 summary + Data Model Schema Direction A](../architecture.md#architecture-decision-records)
- Context7 re-verify: zod@4.3.6; `fromJSONSchema` experimental status confirmed
- Pit Crew Adversary Finding 3 (phantom "AI assistants read schemas" rationale removed)
- [specs/implementation-plan.md T4.2.1](../implementation-plan.md#stage-42--spec-clusters)
