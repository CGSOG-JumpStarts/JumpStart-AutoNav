---
id: "adr-003"
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

# ADR-003: `config-yaml.cjs` Elimination — Absorb into Typed ESM `yaml-writer.ts`

> **Status:** Accepted · **Date:** 2026-04-24 · **Decision Maker:** The Architect

---

## Context

`bin/lib/config-yaml.cjs` is the sole `.cjs` file in `bin/lib/`. It exists because `bin/cli.js` is CJS and invokes it via `require()`; the `yaml` package's AST-preserving `Document` API is used for comment-preserving writes, which requires the `cjs`-importable-from-cjs shape.

The rewrite eliminates the mixed CJS/ESM module system at 2.0. `config-yaml.cjs`'s reason-for-existence (being `require`-able from CJS) evaporates once `src/cli/main.ts` becomes ESM.

---

## Decision

**Absorb `config-yaml.cjs` into a typed ESM `src/config/yaml-writer.ts`** that exports:
- `readYamlDocument(path: string): YamlDocument` — uses `yaml@2`'s `parseDocument()` (AST-preserving)
- `writeYamlDocument(path: string, doc: YamlDocument): void` — preserves comments + formatting
- `setYamlPath(doc: YamlDocument, keyPath: string[], value: unknown): void` — the AST-setter pattern from the original

The original CJS file is **deleted** at port time (story E3-S2 / T4.1.8).

---

## Consequences

### Positive
- Eliminates the last `.cjs` in the codebase.
- Eliminates the `createRequire(import.meta.url)` shim pattern from 38 ESM lib modules that use it specifically to require `config-yaml.cjs`.
- Single YAML-writing surface across the whole codebase; no "use config-yaml.cjs for comment-preserving writes; use inline `yaml` for everything else" confusion.

### Negative
- Every downstream callsite that `require()`s `./config-yaml.cjs` must be updated simultaneously with the port. ~10–15 call sites in v1.1.14.
- Byte-identical YAML write output vs v1.1.14 must be verified via historical-fixtures regression (T4.1.12) — any behavioral drift in how the `yaml` package version-pair is used would surface as config-file diffs in existing consumer projects.

### Neutral
- No runtime behavior change visible to end users; only a source-tree simplification.

---

## Alternatives Considered

### Keep `config-yaml.cjs` as `.cjs`, shim around it
- **Description:** Port everything else to TS; keep `config-yaml.cjs` as-is; ESM callers use `createRequire` to reach it.
- **Pros:** Minimal change to that specific file.
- **Cons:** Defeats the mixed-module-system cleanup; perpetuates the createRequire shim pattern in ~38 modules.
- **Reason Rejected:** The entire point of the rewrite is to eliminate this seam.

### Replace with a different YAML library
- **Description:** Switch to `js-yaml` or another library.
- **Pros:** Different API might simplify something.
- **Cons:** `yaml@2` is TS-native with better type support than `js-yaml`; comment-preserving writes via the `Document` AST is specifically supported; switching libraries adds migration risk with no clear benefit.
- **Reason Rejected:** `yaml@2` is the right choice; just use it from ESM.

---

## References

- [specs/architecture.md ADR-003 summary](../architecture.md#architecture-decision-records)
- Context7 re-verify: `yaml@2.8.3` stable, CVE-2026-33532 patched
- [specs/implementation-plan.md T4.1.8](../implementation-plan.md#milestone-3-m2--leaf--config-clusters-ported-stage-41)
