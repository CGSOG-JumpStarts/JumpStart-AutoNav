/**
 * test-cli-runners.test.ts — T4.7.2 batch 4 (runners cluster).
 *
 * Smoke + dispatcher coverage for the six `src/cli/commands/runners.ts`
 * commands. Per the seed pattern in `test-cli-dispatcher.test.ts` /
 * `test-cli-lifecycle.test.ts`, this file only validates:
 *
 *   1. Each `<name>Command` has the expected `meta.name`.
 *   2. Each `<name>Impl(testDeps, ...)` returns `exitCode: 1` when
 *      called with empty/missing-required args (smoke test only — full
 *      coverage lives with the underlying lib in tests/test-headless.test.js
 *      and tests/test-holodeck.test.js etc.).
 *   3. `main.subCommands` exposes the new lazy thunks.
 *
 * @see src/cli/commands/runners.ts
 * @see specs/implementation-plan.md T4.7.2
 */

import { describe, expect, it } from 'vitest';
import {
  headlessCommand,
  headlessImpl,
  holodeckCommand,
  holodeckImpl,
  regressionCommand,
  smokeCommand,
  testCommand,
  testImpl,
  verifyCommand,
} from '../src/cli/commands/runners.js';
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

describe('runners cluster — defineCommand meta.name', () => {
  const cases: [string, { meta?: unknown }][] = [
    ['verify', verifyCommand],
    ['holodeck', holodeckCommand],
    ['headless', headlessCommand],
    ['smoke', smokeCommand],
    ['regression', regressionCommand],
    ['test', testCommand],
  ];
  for (const [expected, cmd] of cases) {
    it(`${expected}Command.meta.name === '${expected}'`, async () => {
      expect(await metaName(cmd)).toBe(expected);
    });
  }
});

describe('runners cluster — Impl missing-required-args smoke', () => {
  it('holodeckImpl returns exitCode=1 when no scenario AND no --all flag', async () => {
    const deps = createTestDeps();
    const r = await holodeckImpl(deps, {});
    expect(r.exitCode).toBe(1);
  });

  it('headlessImpl returns exitCode=1 when --agent is missing', async () => {
    const deps = createTestDeps();
    const r = await headlessImpl(deps, {});
    expect(r.exitCode).toBe(1);
  });

  it('headlessImpl returns exitCode=1 when --agent is an empty list', async () => {
    const deps = createTestDeps();
    const r = await headlessImpl(deps, { agent: ', , ,' });
    expect(r.exitCode).toBe(1);
  });

  it('testImpl returns exitCode=1 for an unknown flag', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = testImpl(deps, { flag: '--banana' });
    expect(r.exitCode).toBe(1);
  });

  it('testImpl returns exitCode=0 for --adversarial (early-return path)', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = testImpl(deps, { flag: '--adversarial' });
    expect(r.exitCode).toBe(0);
  });
});

describe('runners cluster — main.subCommands wiring', () => {
  it('main.subCommands contains every runners command name', async () => {
    const subs =
      typeof main.subCommands === 'function' ? await main.subCommands() : await main.subCommands;
    expect(subs).toBeDefined();
    if (!subs) return;
    const expected = ['verify', 'holodeck', 'headless', 'smoke', 'regression', 'test'];
    for (const name of expected) {
      expect(name in subs).toBe(true);
    }
  });
});
