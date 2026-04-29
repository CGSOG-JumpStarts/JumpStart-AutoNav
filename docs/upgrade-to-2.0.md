# Upgrading to jumpstart-mode 2.0

This guide covers the 1.x → 2.0 upgrade path. The 2.0 release is a TypeScript rewrite executed as a strangler-fig migration — every 1.x feature is preserved by name and behavior; only the underlying language, runtime, and module system change.

> **Status**: this document is **provisional** while 2.0 is in late-stage development. The bullet shapes are stable; the version pins (e.g., 2.0.0-rc.1) are placeholders until M9 ships. See [T6.4 in implementation-plan.md](../specs/implementation-plan.md).

## Quick checklist

```
✓ Node.js ≥24.0.0 installed (Active LTS through 2028-04-30)
✓ ESM-aware tooling — your project either uses "type": "module" already or invokes the CLI directly (npx jumpstart-mode ...)
✓ No deep imports of bin/lib/*.js (those move under dist/lib/* — see "Breaking changes" below)
✓ Updated lockfile (npm install jumpstart-mode@latest after 2.0 promotion)
```

If all four are green, the upgrade is `npm install jumpstart-mode@latest` and re-run.

## What changed (high level)

### Runtime

- **Node.js floor: 24.0.0** (was 14.0.0 in 1.x).
  - Node 24 is Active LTS through 2026-10-20 and Maintenance LTS through 2028-04-30.
  - 1.x continues to receive security patches under the `1.x` dist-tag through the 2.0 soak window. After 2.0 promotion to `latest`, 1.x receives critical-only patches for 6 months.
- **Module system: ESM-only.** `package.json` declares `"type": "module"`; the package's `bin` entries and library exports are ESM. CommonJS consumers can use dynamic `import()` or upgrade to a TypeScript/ESM-aware bundler.

### CLI

- **Command names + arg shapes preserved verbatim.** Every 1.x subcommand (`jumpstart-mode validate`, `jumpstart-mode hash register`, `jumpstart-mode install skill.ignition`, etc.) works in 2.0 with byte-identical `--help` output (verified by `scripts/diff-cli-help.mjs` against committed golden masters).
- **CLI framework**: switched from `commander` (1.x provisional) to `citty` (2.0 final per ADR-002 v2.0.0). Internal change only — no externally-visible API surface affected. Lazy-loaded subcommands → faster startup for `--version`/`--help` (≈30-50ms saved).
- **Exit codes**: hardened per ADR-006. Library code throws typed errors (`JumpstartError`, `ValidationError`, `LLMError`); only the CLI entry and IPC envelope translate to `process.exit`.
  - Exit 0: success
  - Exit 1: command-defined failure (e.g., validation rejected)
  - Exit 2: ValidationError (path-traversal, malformed input, schema violation)
  - Exit 99: unexpected JumpstartError (programming bug — file an issue)

### Library surface

- `bin/lib/*.js` (legacy CommonJS) → `dist/lib/*.js` (ESM, .d.mts emitted).
- Public exports preserved by name. The only external consumer-visible change is `import` syntax:

  ```js
  // 1.x (CommonJS)
  const { validateArtifact } = require('jumpstart-mode/lib/validator');

  // 2.0 (ESM)
  import { validateArtifact } from 'jumpstart-mode/lib/validator';
  ```

- The `exports` map in `package.json` controls visibility. Submodule paths that worked in 1.x via folder-walk no longer work in 2.0 — use the documented `exports` keys (e.g., `jumpstart-mode/lib/validator`, `jumpstart-mode/lib/install`, `jumpstart-mode/cli`).

### IPC (subprocess) surface

- Every dual-mode lib retains its stdin-JSON / stdout-JSON contract.
- New `v1` envelope wraps responses with `{ "version": 1, "ok": true, "timestamp": <ISO>, "result": <...> }` (per ADR-007).
- `v0` envelope (raw `result` object) continues to work — invoke without `"version": 1` in the input. AI agents that hardcoded the 1.x stdin/stdout shape continue to work without change.
- New `v1` consumers benefit from versioned error envelopes (`{ "version": 1, "ok": false, "error": { "code", "message", "details" } }`) that distinguish `ValidationError` (exit 2) from generic failures (exit 99).

### Config + state

- `.jumpstart/config.yaml` shape preserved verbatim. The TS port adopts the `yaml` package's AST-preserving writer; comments and key order are preserved across `config-merge` operations (a behavior fix vs the 1.x line-by-line regex rewriter).
- `.jumpstart/state/state.json` shape preserved verbatim across all 1.x → 2.0 paths (verified by 10 historical-shape regression fixtures in `tests/fixtures/installed-shapes/`).
- `.jumpstart/installed.json` (marketplace ledger) shape preserved verbatim.

### Marketplace installer

- ZIP extraction now uses a **hand-rolled Node-native ZIP reader** (no new npm deps) with per-entry path canonicalization (ADR-010). Symlink entries, absolute paths, null-byte-injected entries, and traversal-shaped entries are rejected at validation time before any file is written.
- Download URLs validated via the same allowlist family as ADR-011 (HTTPS-only or localhost; reject userinfo).
- SHA-256 checksum is now **mandatory** (was optional in 1.x). To bypass for local development, set `JUMPSTART_ALLOW_INSECURE_LLM_URL=1`.

### Security hardening (new in 2.0)

- **ADR-009 path-safety**: every `path.join(projectRoot, userInput)` in CLI commands and lib functions is gated by `assertInsideRoot`. CLI commands taking file paths reject `/etc/passwd`-shaped exfiltration attempts at the entry point.
- **ADR-010 ZIP-slip prevention**: marketplace installer rejects every malicious archive shape we identified.
- **ADR-011 LLM endpoint allowlist**: HTTPS-only or localhost; reject userinfo confusion (`https://attacker.com@trusted.com`).
- **ADR-012 secrets redaction**: every persisted artifact (state, timeline, usage logs, evidence packages, chat-integration config, marketplace ledger) runs through `redactSecrets` before `writeFileSync`. Bearer tokens, API keys, AWS credentials, GitHub PATs, Slack webhooks, etc. are redacted at the persistence boundary.

## Breaking changes — what to update

If you ONLY use the CLI (`npx jumpstart-mode <subcommand>`), there is nothing to update. Skip to "After upgrade".

If your project DEPENDS on jumpstart-mode as a library, check each item below.

### 1. Direct deep imports → use the `exports` map

**1.x (still works in 2.0 via the `exports` map for documented paths only)**:
```js
const validator = require('jumpstart-mode/bin/lib/validator');
```

**2.0**:
```js
import { validateArtifact } from 'jumpstart-mode/lib/validator';
```

Undocumented deep paths (e.g., `jumpstart-mode/bin/lib/some-internal-helper`) MAY fail. The `exports` map enumerates the supported public surface — see `package.json`.

### 2. CommonJS `require()` → ESM `import`

If your project is still CommonJS (no `"type": "module"` in your `package.json`), use dynamic `import()`:

```js
// CommonJS consumer of an ESM package
const { validateArtifact } = await import('jumpstart-mode/lib/validator');
```

Or migrate your project to ESM (recommended — Node 24 has full ESM support).

### 3. `process.exit` calls → typed errors

If your code intercepted `process.exit` or relied on a specific non-zero exit code, note that 2.0 uses ADR-006 exit codes:

| Pre-2.0 behavior | 2.0 behavior |
|---|---|
| Generic `process.exit(1)` for any failure | Exit 2 for `ValidationError`; exit 1 for command-defined failure; exit 99 for `JumpstartError` |

### 4. Node 24 only

Running `npx jumpstart-mode@2.0` on Node ≤22 fails immediately with a clear `engines` mismatch message. This is enforced by `package.json` `engines.node: ">=24.0.0"` AND a runtime check at the CLI entry. If you need to stay on a lower Node version, pin `jumpstart-mode@1` (security patches continue for 6 months post-2.0).

### 5. Removed (or moved) modules

The following 1.x internal modules are NOT part of the documented `exports` map. They were not intended to be deep-imported and are now strictly internal:

- `bin/lib/_smoke.js` (test fixture only)
- `bin/lib/mock-responses.js` (test fixture only)
- The 5,359-line `bin/cli.js` monolith (decomposed into `dist/cli.js` + `dist/cli/commands/*.js`; only the CLI binary entry is supported)

If you depended on any of these, file an issue at https://github.com/scombey/JumpStart-AutoNav/issues with the use case — we'll add it to the `exports` map if appropriate.

## After upgrade — verify

```
# Check installed version
npx jumpstart-mode --version
# → expect: 2.0.0 (or 2.0.0-rc.X during the soak window)

# Smoke-test the canonical commands
npx jumpstart-mode --help
npx jumpstart-mode status
npx jumpstart-mode validate specs/prd.md   # if your project has a PRD

# Re-run any of your CI gates
node scripts/verify-baseline.mjs  # if you adopted our 12-gate ratchet
```

If you see `engines mismatch` errors, your Node version is below 24. Either upgrade Node (`nvm install 24 && nvm use 24`) or pin `jumpstart-mode@1`.

## Rollback

If 2.0 doesn't work for you:

```sh
npm install jumpstart-mode@1
```

The 1.x line continues to receive security patches through 2027-Q1 (≈12 months post-2.0 promotion). Filing an issue with the regression you hit is the highest-value contribution you can make.

## What's NOT changing

- **Spec artifact shapes**: `specs/prd.md`, `specs/architecture.md`, `specs/implementation-plan.md`, `specs/decisions/*.md` are written to / read from with byte-identical structure.
- **`.jumpstart/agents/*.md` agent personas**: unchanged.
- **`CLAUDE.md` slash-command routing table**: unchanged.
- **CI workflow filenames**: `.github/workflows/typescript.yml`, `quality.yml`, `e2e.yml`, `audit.yml`, `pr-title-lint.yml`.
- **Existing scripts**: `scripts/verify-baseline.mjs`, `scripts/check-*.mjs`.

## Get help

- Issues: https://github.com/scombey/JumpStart-AutoNav/issues
- Architecture context: [`specs/architecture.md`](../specs/architecture.md)
- Per-decision rationale: [`specs/decisions/`](../specs/decisions/)
- Migration timeline: [`specs/implementation-plan.md`](../specs/implementation-plan.md)
