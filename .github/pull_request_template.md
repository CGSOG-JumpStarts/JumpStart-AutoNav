<!--
PR template enforcing the rewrite's hard rule: every port PR ships with
ZERO user-visible behavior change. Bugs surfaced during a port go to
follow-up issues, NOT into the port PR. See specs/typescript-rewrite-plan.md
§2 (strangler-fig strategy) and specs/prd.md E1-S9 (this template).
-->

## What this PR does

<!-- 1-3 sentences: what changed and why. -->

## Behavior-change posture

**Choose one** (delete the other two):

- [ ] **This PR changes ZERO user-visible behavior.** Same CLI output, same exit codes, same stdout/stderr, same IPC envelope shape. Cross-module contract harness reports zero new drift.
- [ ] **This PR INTENTIONALLY changes behavior** (semver-major-significant or semver-minor-significant). The change is documented in `CHANGELOG.md` and the commit message starts with `feat:` or `BREAKING CHANGE:`.
- [ ] **This PR is the 2.0 cutover** (M9 or later). Breaking changes are gated by `package.json` engines bump + ESM flip + dist/ bin entries.

If the first checkbox is checked, the reviewer's job is to confirm the assertion; if any of the harness / coverage ratchet / CLI help snapshot / holodeck baseline gates fail, this is by definition NOT zero-behavior-change.

## Tasks closed

<!-- List task IDs from specs/implementation-plan.md, e.g., T1.1, T2.4. -->

- T?.? — [task title]

## Tests added or updated

<!-- Per-module port recipe step 11: every port PR ships v0/v1 IPC fixture pair. -->

- [ ] Cross-module contract harness: zero new drift
- [ ] Coverage ratchet: at or above baseline (see `scripts/check-coverage-ratchet.mjs` output)
- [ ] CLI help snapshot: byte-identical pre/post
- [ ] Holodeck `--scenario baseline`: PASS
- [ ] IPC v0/v1 fixture pair committed (per ADR-007) — only required for IPC-eligible lib modules
- [ ] Production-quality CI floor: `tsc --noEmit` + `biome check` + `check-public-any` + `check-process-exit` all green

## Linked specs

<!-- For traceability. PR reviewer cross-checks claims against these. -->

- specs/architecture.md §
- specs/decisions/adr-XXX-...
- specs/implementation-plan.md T?.?
- specs/prd.md E?-S?

## Reviewer checklist

- [ ] Behavior-change checkbox above is honest (verified against CI green)
- [ ] No `any` type in any newly-exported `.d.ts` (Biome `noExplicitAny` + `scripts/check-public-any.mjs` confirm)
- [ ] No new `process.exit(` outside `src/cli/main.ts` and `src/lib/ipc.ts` (`scripts/check-process-exit.mjs` confirms)
- [ ] No empty catch blocks swallowing thrown typed errors (per ADR-006)
- [ ] Path-typed input fields use `safePathSchema` from `bin/lib-ts/path-safety.ts` (per ADR-009) — only required for IPC-eligible modules with paths
