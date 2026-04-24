---
id: "adr-009"
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
risk_level: high
owners:
  - Samuel Combey
sha256: null
---

# ADR-009: IPC Stdin Path-Traversal Sanitization

> **Status:** Accepted · **Date:** 2026-04-24 · **Decision Maker:** The Architect

---

## Context

AI coding assistants (Claude Code, Cursor, etc.) invoke `bin/lib/*.js` / `dist/lib/*.js` modules as subprocesses with arbitrary JSON on stdin. Several modules accept path-typed fields in their input envelope — e.g., `config-loader.js` accepts `{ "root": ".", "global_path": "~/.jumpstart/config.yaml" }` and dereferences both via `fs.readFile()` / `fs.existsSync()`.

v1.1.14 does **not** canonicalize or validate these path fields. A compromised AI agent (or a user-side prompt-injection vector that influences agent subprocess invocations) could pass `{"root": "/etc/passwd"}` or `{"path": "../../../.ssh/id_rsa"}` and read files outside the intended project scope.

Pit Crew QA Security Audit SEC-001: **HIGH severity**. The architecture's claim of "no privilege escalation beyond what the user's shell grants" is technically correct but under-specified — the shell grants access to every path the user can read, which is exactly what an unsanitized path field exploits.

---

## Decision

**All IPC-eligible modules that accept path-typed fields MUST canonicalize via `path.resolve` + prefix-check against the project root (or another documented allowlist boundary).**

Enforced in two layers:

**Layer 1 — Zod schema refinement** (at `src/lib/ipc.ts`'s `runIpc()` envelope-parse step):

```typescript
import { z } from "zod";
import * as path from "node:path";

// Canonical path-field validator — applied to any Zod schema field that represents a filesystem path
export const safePathSchema = (boundaryRoot: string) =>
  z.string().refine(
    (input) => {
      const resolved = path.resolve(boundaryRoot, input);
      const normalizedBoundary = path.resolve(boundaryRoot) + path.sep;
      return resolved.startsWith(normalizedBoundary) || resolved === path.resolve(boundaryRoot);
    },
    (input) => ({
      message: `Path "${input}" resolves outside the project boundary root "${boundaryRoot}". Path traversal rejected.`,
    })
  );

// Per-module Zod schemas consuming path fields use safePathSchema rather than z.string()
// Example — src/lib/config-loader.ts schema:
export const ConfigLoaderInputSchema = z.object({
  root: safePathSchema(process.cwd()).default("."),
  global_path: safePathSchema(os.homedir()).optional(),
});
```

**Layer 2 — Runtime canonicalization on every `fs.*` call** (defense in depth):
- Every IPC module that opens files via `fs.*` APIs first runs path inputs through a shared `assertInsideRoot(path, root)` helper in `src/lib/path-safety.ts`.
- Violations throw `ValidationError` with `exitCode: 2`.

**Turn 2 fixture matrix** for reviewer-testable enforcement:
- `tests/fixtures/security/path-traversal/` with crafted inputs: `"../etc/passwd"`, `"/etc/passwd"` (absolute), `"./legitimate/../etc/passwd"` (sneaky), `"symlink-that-points-outside"` (symlink-follow), `"null\x00byte"` (null-byte injection), Windows `"C:\\Windows\\..\\..\\"`.
- Test runner invokes `node dist/lib/<module>.js < fixture.json` and asserts exit code 2 with clear error message for each.

**Explicit out-of-scope**: the framework does NOT attempt to sandbox the user's shell; the user running `jumpstart-mode` always has ambient filesystem access. The mitigation defends against **agent-supplied** stdin payloads, which is the net-new trust boundary in v2.0.

---

## Consequences

### Positive
- High-severity vulnerability class (AI-agent reads arbitrary user files) closed with mechanical enforcement.
- Zod schema refinements co-locate the security check with the data definition — no separate "security layer."
- Fixture matrix testable at CI time; regressions caught before merge.

### Negative
- Every IPC module with path fields must be audited during port and updated to use `safePathSchema`. ~15–20 modules affected; ~10 min each.
- Symlink-follow semantics are OS-dependent; test matrix must cover POSIX + Windows (Windows coverage requires manual verification or a matrixed CI job).
- Defense-in-depth layer 2 (`assertInsideRoot` on every fs call) doubles path-checks for performance-insensitive paths; acceptable cost given the security value.

### Neutral
- Existing `bin/lib/secret-scanner.js` + `bin/lib/credential-boundary.js` modules are complementary, not replacement — those catch secrets IN file contents; ADR-009 prevents unauthorized file ACCESS in the first place.

---

## Alternatives Considered

### Rely on OS-level sandboxing (e.g., SELinux, macOS sandbox)
- **Description:** Expect the user to run `jumpstart-mode` in a sandboxed environment.
- **Pros:** Outside the framework's responsibility.
- **Cons:** Users don't run CLI tools sandboxed; framework-level defense is the only realistic mitigation.
- **Reason Rejected:** Not actionable for the typical consumer install.

### Per-module ad-hoc path checks
- **Description:** Each module hand-rolls its own path-sanitization logic.
- **Pros:** Fine-grained per-module policy.
- **Cons:** 15+ implementations; drift guaranteed; defeats the "single enforcement mechanism" discipline this rewrite is built around.
- **Reason Rejected:** Centralization is the right pattern.

### Use an existing path-sanitization npm library
- **Description:** Pull in `path-is-inside` or similar.
- **Pros:** Zero new code.
- **Cons:** Adds a dependency; existing libraries have subtle Windows-vs-POSIX edge cases; the Zod + `path.resolve` implementation above is ~10 lines and auditable.
- **Reason Rejected:** Over-dependency for a small well-scoped check.

---

## References

- [specs/architecture.md ADR-009 + §Security SEC-001](../architecture.md#specific-high-severity-mitigations-per-pit-crew-qa-security-audit-integrated-turn-1)
- Pit Crew QA Security Audit Part 2 Finding 2 (HIGH severity)
- [specs/implementation-plan.md T4.1.8 `ipc.ts` authoring](../implementation-plan.md)
