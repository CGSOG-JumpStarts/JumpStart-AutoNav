/**
 * test-cli-deferred.test.ts — T4.7.2 batch 11 (deferred / interactive cluster).
 *
 * Smoke + dispatcher coverage for the five `src/cli/commands/deferred.ts`
 * commands. Per the seed pattern in `test-cli-lifecycle.test.ts`, this file
 * only validates:
 *
 *   1. Each `<name>Command` has the expected `meta.name`.
 *   2. Each `<name>Impl(testDeps, {})` returns `exitCode: 1` when called
 *      with empty/missing-required args (smoke test only — full coverage
 *      lives with the underlying lib in tests/test-context-summarizer.test.ts,
 *      tests/test-timeline.test.ts, etc.).
 *   3. `main.subCommands` exposes the new lazy thunks.
 *
 * **Why lighter than runtime behavior.** `quickstart` is interactive
 * (uses `prompts`) and the legacy `install()` bootstrap is not exported
 * as a library function — the non-interactive path that's testable here
 * requires all four flags (`--name`/`--type`/`--domain`/`--ceremony`).
 * `self-evolve` / `summarize` / `timeline` / `validate-all` are
 * render-heavy and pass through to libs that already have full coverage.
 *
 * @see src/cli/commands/deferred.ts
 * @see specs/implementation-plan.md T4.7.2
 */

import { describe, expect, it } from 'vitest';
import {
  quickstartCommand,
  quickstartImpl,
  selfEvolveCommand,
  summarizeCommand,
  summarizeImpl,
  timelineCommand,
  validateAllCommand,
} from '../src/cli/commands/deferred.js';
import { createTestDeps } from '../src/cli/deps.js';
import { main } from '../src/cli/main.js';

// citty's CommandDef is heavily generic-parameterized; we narrow to a
// minimal "has meta" shape via `unknown` cast for the tabular test.
async function metaName(cmd: { meta?: unknown }): Promise<string | undefined> {
  const m = cmd.meta;
  const resolved =
    typeof m === 'function'
      ? await (m as () => Promise<{ name?: string } | undefined>)()
      : await (m as Promise<{ name?: string } | undefined> | { name?: string } | undefined);
  return resolved?.name;
}

describe('deferred cluster — defineCommand meta.name', () => {
  const cases: [string, { meta?: unknown }][] = [
    ['quickstart', quickstartCommand],
    ['self-evolve', selfEvolveCommand],
    ['summarize', summarizeCommand],
    ['timeline', timelineCommand],
    ['validate-all', validateAllCommand],
  ];
  for (const [expected, cmd] of cases) {
    it(`${expected}Command.meta.name === '${expected}'`, async () => {
      expect(await metaName(cmd)).toBe(expected);
    });
  }
});

describe('deferred cluster — Impl missing-required-args smoke', () => {
  it('summarizeImpl returns exitCode=1 when phase is absent', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = summarizeImpl(deps, {});
    expect(r.exitCode).toBe(1);
  });

  it('summarizeImpl returns exitCode=1 when phase is non-numeric', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = summarizeImpl(deps, { phase: 'not-a-number' });
    expect(r.exitCode).toBe(1);
  });

  it('quickstartImpl returns exitCode=1 when no flags are provided', async () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = await quickstartImpl(deps, {});
    expect(r.exitCode).toBe(1);
  });

  it('quickstartImpl returns exitCode=1 when only --name is provided', async () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = await quickstartImpl(deps, { name: 'demo' });
    expect(r.exitCode).toBe(1);
  });

  it('quickstartImpl returns exitCode=1 when --type is invalid', async () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = await quickstartImpl(deps, {
      name: 'demo',
      type: 'invalid-type',
      domain: 'web-app',
      ceremony: 'standard',
    });
    expect(r.exitCode).toBe(1);
  });

  it('quickstartImpl returns exitCode=1 when --ceremony is invalid', async () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = await quickstartImpl(deps, {
      name: 'demo',
      type: 'greenfield',
      domain: 'web-app',
      ceremony: 'turbo',
    });
    expect(r.exitCode).toBe(1);
  });
});

describe('deferred cluster — main.subCommands wiring', () => {
  it('main.subCommands contains every deferred command name', async () => {
    const subs =
      typeof main.subCommands === 'function' ? await main.subCommands() : await main.subCommands;
    expect(subs).toBeDefined();
    if (!subs) return;
    const expected = ['quickstart', 'self-evolve', 'summarize', 'timeline', 'validate-all'];
    for (const name of expected) {
      expect(name in subs).toBe(true);
    }
  });
});
