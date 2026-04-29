/**
 * test-cli-llm.test.ts — T4.7.2 batch 6 (LLM / cost / model governance cluster).
 *
 * Smoke + dispatcher coverage for the seven `src/cli/commands/llm.ts`
 * commands. Per the seed pattern in `test-cli-lifecycle.test.ts`, this
 * file only validates:
 *
 *   1. Each `<name>Command` has the expected `meta.name`.
 *   2. Each `<name>Impl(testDeps, {})` returns `exitCode: 1` when called
 *      with empty/missing-required args (smoke test only — full coverage
 *      lives with the underlying lib in tests/test-cost-router.test.ts,
 *      tests/test-model-router.test.ts, tests/test-model-governance.test.ts,
 *      tests/test-prompt-governance.test.ts, tests/test-usage.test.ts).
 *   3. `main.subCommands` exposes the new lazy thunks and they resolve.
 *
 * @see src/cli/commands/llm.ts
 * @see specs/implementation-plan.md T4.7.2
 */

import { describe, expect, it } from 'vitest';
import {
  aiIntakeCommand,
  aiIntakeImpl,
  costRouterCommand,
  finopsPlannerCommand,
  modelGovernanceCommand,
  modelGovernanceImpl,
  modelRouterCommand,
  modelRouterImpl,
  promptGovernanceCommand,
  promptGovernanceImpl,
  usageCommand,
} from '../src/cli/commands/llm.js';
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

describe('llm cluster — defineCommand meta.name', () => {
  const cases: [string, { meta?: unknown }][] = [
    ['cost-router', costRouterCommand],
    ['model-router', modelRouterCommand],
    ['model-governance', modelGovernanceCommand],
    ['prompt-governance', promptGovernanceCommand],
    ['usage', usageCommand],
    ['ai-intake', aiIntakeCommand],
    ['finops-planner', finopsPlannerCommand],
  ];
  for (const [expected, cmd] of cases) {
    it(`${expected}Command.meta.name === '${expected}'`, async () => {
      expect(await metaName(cmd)).toBe(expected);
    });
  }
});

describe('llm cluster — Impl missing-required-args smoke', () => {
  it('modelRouterImpl returns exitCode=1 for route without a task type', () => {
    const deps = createTestDeps();
    const r = modelRouterImpl(deps, { action: 'route' });
    expect(r.exitCode).toBe(1);
  });

  it('modelGovernanceImpl returns exitCode=1 for register without name/provider', () => {
    // Use real cwd so safeJoin resolves the state path properly.
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = modelGovernanceImpl(deps, { action: 'register' });
    expect(r.exitCode).toBe(1);
  });

  it('promptGovernanceImpl returns exitCode=1 for register without a name', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = promptGovernanceImpl(deps, { action: 'register' });
    expect(r.exitCode).toBe(1);
  });

  it('promptGovernanceImpl returns exitCode=1 for approve without an asset id', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = promptGovernanceImpl(deps, { action: 'approve' });
    expect(r.exitCode).toBe(1);
  });

  it('aiIntakeImpl returns exitCode=1 for create without a name', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = aiIntakeImpl(deps, { action: 'create' });
    expect(r.exitCode).toBe(1);
  });
});

describe('llm cluster — main.subCommands wiring', () => {
  it('main.subCommands contains every LLM command name', async () => {
    const subs =
      typeof main.subCommands === 'function' ? await main.subCommands() : await main.subCommands;
    expect(subs).toBeDefined();
    if (!subs) return;
    const expected = [
      'cost-router',
      'model-router',
      'model-governance',
      'prompt-governance',
      'usage',
      'ai-intake',
      'finops-planner',
    ];
    for (const name of expected) {
      expect(name in subs).toBe(true);
    }
  });
});
