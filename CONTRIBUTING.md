# Contributing — jumpstart-mode 2.0 Rewrite

This repo follows a **branch-per-milestone + PR-gated workflow**. The main
branch is protected; every change ships through a pull request whose checks
must be green before merge.

## Workflow

### 1. Pick an issue

Every milestone has a tracking issue under PRD #1 (the parent rewrite PRD).
See [`specs/implementation-plan.md`](specs/implementation-plan.md) for the
12-milestone roadmap.

```
M0 — M6   ✅ done
M7        🔄 in flight (issue #9)
M8 — M11  📋 pending (issues #10–#13)
```

### 2. Create a feature branch

One branch per milestone issue. Naming: `feat/m<N>-<slug>`.

```bash
git checkout main
git pull
git checkout -b feat/m7-runners
```

### 3. Make changes on the branch

Standard cycle:

- Write code in `bin/lib-ts/` (strangler-fig — leave `bin/lib/*.js` alone
  until M9 cutover)
- Write tests in `tests/`
- `node scripts/verify-baseline.mjs` — must report **12/12 PASS** before commit
- `git commit -m "feat(M<N>): T<X.Y.Z> — <one-line summary>"`

### 4. Push + open PR

```bash
git push -u origin feat/m7-runners
gh pr create \
  --title "feat(M7): <summary>" \
  --body "Closes #9" \
  --base main
```

Linking the PR with `Closes #<issue>` (or `Fixes` / `Resolves`) auto-closes
the issue when the PR merges.

### 5. CI must pass before merge

GitHub Actions runs on every push to the PR branch:

| Workflow | Triggers on |
|---|---|
| `typescript.yml` — TS Quality Gate | `src/**`, `bin/**`, `scripts/**`, `tests/**`, `tsconfig.json` |
| `quality.yml` — Spec Quality Gate | `specs/**`, `.jumpstart/**`, `tests/**`, `bin/**`, `src/**` |
| `e2e.yml` — E2E Holodeck Baseline | `bin/**`, `src/**`, `.jumpstart/**`, `tests/e2e/**` |
| `audit.yml` — Supply Chain Audit | `package.json`, `package-lock.json` |
| `pr-title-lint.yml` — PR Title Lint | every PR |

All gates green → squash-merge to main → milestone issue auto-closes via
the `Closes #N` keyword.

### 6. Pit Crew round before final merge

For source-port milestones (M2–M8), every milestone closeout gets a
**Pit Crew round** — three parallel single-shot reviewers:

- **Reviewer** — security + ADR compliance + parity vs legacy
- **QA** — test-coverage gaps in the source-changed paths
- **Adversary** — POC sketches against the threat model

Findings are pinned in `tests/test-m<N>-pitcrew-regressions.test.ts`, the
fix lands as another commit on the same branch, and the PR re-validates.

## Local verify-baseline gates (must be 12/12 PASS)

```
[OK] vitest-full-suite
[OK] tsc-noemit
[OK] biome-check
[OK] zod-codegen-fresh
[OK] tsdown-build
[OK] dist-exports
[OK] check-public-any
[OK] check-process-exit
[OK] check-return-shapes
[OK] contract-harness
[OK] holodeck-baseline
[OK] npm-audit-high
```

If any gate fails, fix it on the branch before pushing — never push a red
commit and use CI as a runner.

## Architectural rules (non-negotiable)

These are enforced by `scripts/check-*.mjs` gates and Pit Crew review:

- **ADR-006** — typed errors. Only 2 `process.exit` sites in the entire
  codebase (the CLI entry points). Library code throws
  `JumpstartError`/`ValidationError`/`LLMError`.
- **ADR-007** — IPC envelope versioning (v0 raw / v1 wrapped). Every
  dual-mode lib has a v0/v1 fixture pair under `tests/fixtures/ipc/<name>/`.
- **ADR-009** — path-safety. Every `path.join(projectRoot, userInput)` is
  gated by `assertInsideRoot(input, root)` from `bin/lib-ts/path-safety.ts`.
- **ADR-010** — zipslip prevention. Marketplace ZIP extraction uses the
  hand-rolled Node-native reader in `install.ts` with per-entry
  canonicalization + symlink rejection + zip-bomb caps.
- **ADR-011** — LLM endpoint allowlist. HTTPS-only or localhost; reject
  userinfo (`https://attacker@trusted.com`). Same allowlist family applies
  to chat-integration webhooks and marketplace download URLs.
- **ADR-012** — secrets redaction. Every persistence path runs the value
  through `redactSecrets(...)` from `bin/lib-ts/secret-scanner.ts` before
  `writeFileSync`.

## Commit message style

```
feat(M<N>): T<X.Y.Z> — <imperative summary>

Optional body explaining the why and any deviations from legacy behavior.
Each behavior change vs legacy gets a row in
specs/implementation-plan.md §Deviation Log.
```

`fix(M<N>-Final): close <K> Pit Crew findings — ...` for closeout commits.

## Branch protection (recommended GitHub settings)

To enforce the workflow on the upstream:

```
Settings → Branches → main → Branch protection rules
  ✓ Require a pull request before merging
  ✓ Require status checks to pass before merging
    Required: typescript, quality, e2e, audit, pr-title
  ✓ Require linear history (squash-merge only)
  ✓ Do not allow bypassing the above settings
```
