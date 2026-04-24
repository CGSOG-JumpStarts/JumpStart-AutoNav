---
id: "adr-001"
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

# ADR-001: Build Tool — tsdown@0.21.10 (pinned exact)

> **Status:** Accepted · **Date:** 2026-04-24 · **Decision Maker:** The Architect

---

## Context

The rewrite ships as a TypeScript-source npm package distributed as `dist/` compiled output. Build-tool requirements: produce CJS-compatible ESM output + `.d.ts` files, preserve shebang on CLI entry points, emit source maps, handle multiple entry points (CLI, bootstrap, ~150 IPC-eligible lib modules), integrate with path-alias resolution for strangler-phase `@lib/*` aliases.

Context7 re-verify (2026-04-24) confirmed tsup is maintainer-flagged as deprecated in 2026; official migration path is tsdown. tsdown is pre-1.0 at `0.21.10` with 10 releases in the last 2 months (high velocity).

---

## Decision

Adopt **`tsdown@0.21.10` pinned exact** (NOT `^0.21.10` range — pre-1.0 velocity would let a `0.21.11` patch float and break the build silently).

Fallback path documented explicitly: if tsdown is displaced mid-rewrite (maintainer abandonment, a 0.22 breaking change that blocks our use, or a security issue without a patched version), swap to `tsc` + `tsc-alias` (for path-alias resolution that plain tsc does not handle) + a shell-script shebang post-step + `.d.ts`-parity verification against golden-master emit. Estimated fallback cost: **2–3 days** mid-rewrite (NOT "1 day" as the initial architecture draft claimed — Pit Crew Adversary Finding 4 correction).

---

## Consequences

### Positive
- Rolldown-based (Rust-core) build is ~49% faster than tsup on comparable inputs.
- Shebang preservation is first-class (via banner config).
- `.d.ts` emission via `oxc` is fast and accurate.
- Drop-in replacement for tsup; `tsdown migrate` auto-converts tsup configs if needed.

### Negative
- Pre-1.0 with 10 releases in 2 months: breaking changes between 0.21 and 0.22 are plausible within the rewrite window. Exact-pinning mitigates but does not eliminate.
- CVE patches require deliberate version bump rather than dependency-range float.
- Fallback to tsc-based build is 2–3 days of work; not zero cost.
- CSS support in tsdown explicitly does not follow SemVer — not relevant to this project (no CSS) but worth noting.

### Neutral
- tsdown's Node floor (`engines: ">=20.19.0"`) is compatible with the Node 24 target (ADR-005) + the 1.x strangler Node 22 support.

---

## Alternatives Considered

### tsup
- **Description:** esbuild-backed TS bundler; historically the dominant choice for CLI packages.
- **Pros:** Mature, well-documented, many examples.
- **Cons:** Maintainer-flagged deprecated in 2026 with official migration path to tsdown.
- **Reason Rejected:** Deprecated status makes it unsuitable for a 9–12 month forward-looking rewrite.

### Plain `tsc` + post-build shell steps (no bundler)
- **Description:** Use TypeScript compiler alone; emit one .js per .ts; add `tsc-alias` for paths + shell script for shebangs.
- **Pros:** Zero third-party build tooling; maximum control.
- **Cons:** No bundling (bigger `dist/` footprint; more module-resolution overhead at runtime); slower build times; extra post-build tooling to configure (`tsc-alias`, shebang script, source-map-ok verification).
- **Reason Rejected:** Marginally more work for no benefit vs tsdown. Kept as the **documented fallback** if tsdown is displaced mid-rewrite.

### unbuild
- **Description:** UnJS's universal build tool (same ecosystem as citty).
- **Pros:** Solid choice for library-style packages.
- **Cons:** Library-focused; less opinionated for CLI-with-multiple-entry-points shape; smaller community than tsdown post-tsup migration.
- **Reason Rejected:** tsdown has clearer CLI-package ergonomics for this shape.

---

## References

- [specs/architecture.md ADR-001 summary + Technology Stack](../architecture.md#architecture-decision-records)
- Context7 re-verify 2026-04-24: tsdown@0.21.10 current; Rolldown v1.0.0-rc.12; Node floor ≥20.19.0
- Pit Crew Adversary Finding 4 (fallback cost 1→2-3 days correction)
- [specs/implementation-plan.md T2.1, T2.13](../implementation-plan.md)
