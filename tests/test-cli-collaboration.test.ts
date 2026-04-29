/**
 * test-cli-collaboration.test.ts — T4.7.2 batch 8 (collaboration/UX cluster).
 *
 * Smoke + dispatcher coverage for the nineteen `src/cli/commands/collaboration.ts`
 * commands. Per the seed pattern in `test-cli-lifecycle.test.ts`,
 * `test-cli-marketplace.test.ts`, and `test-cli-spec-quality.test.ts`, this
 * file only validates:
 *
 *   1. Each `<name>Command` has the expected `meta.name`.
 *   2. Each `<name>Impl(testDeps, {})` returns `exitCode: 1` when called
 *      with empty/missing-required args (smoke test only — full coverage
 *      lives with the underlying lib in tests/test-*.test.ts).
 *   3. `main.subCommands` exposes the new lazy thunks.
 *
 * @see src/cli/commands/collaboration.ts
 * @see specs/implementation-plan.md T4.7.2
 */

import { describe, expect, it } from 'vitest';
import {
  aiIntakeCommand,
  aiIntakeImpl,
  backlogSyncCommand,
  bcdrPlanningCommand,
  bcdrPlanningImpl,
  branchWorkflowCommand,
  cabOutputCommand,
  chatIntegrationCommand,
  chatIntegrationImpl,
  ciCdIntegrationCommand,
  collaborationCommand,
  contextOnboardingCommand,
  dataContractsCommand,
  dataContractsImpl,
  dbEvolutionCommand,
  decisionConflictsCommand,
  deliveryConfidenceCommand,
  deliveryConfidenceImpl,
  dependencyUpgradeCommand,
  designSystemCommand,
  diagramStudioCommand,
  diagramStudioImpl,
  elicitationCommand,
  elicitationImpl,
  estimationStudioCommand,
  estimationStudioImpl,
  playbackSummariesCommand,
} from '../src/cli/commands/collaboration.js';
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

describe('collaboration cluster — defineCommand meta.name', () => {
  const cases: [string, { meta?: unknown }][] = [
    ['ai-intake', aiIntakeCommand],
    ['backlog-sync', backlogSyncCommand],
    ['bcdr-planning', bcdrPlanningCommand],
    ['branch-workflow', branchWorkflowCommand],
    ['cab-output', cabOutputCommand],
    ['chat-integration', chatIntegrationCommand],
    ['ci-cd-integration', ciCdIntegrationCommand],
    ['collaboration', collaborationCommand],
    ['context-onboarding', contextOnboardingCommand],
    ['data-contracts', dataContractsCommand],
    ['db-evolution', dbEvolutionCommand],
    ['decision-conflicts', decisionConflictsCommand],
    ['delivery-confidence', deliveryConfidenceCommand],
    ['dependency-upgrade', dependencyUpgradeCommand],
    ['design-system', designSystemCommand],
    ['diagram-studio', diagramStudioCommand],
    ['elicitation', elicitationCommand],
    ['estimation-studio', estimationStudioCommand],
    ['playback-summaries', playbackSummariesCommand],
  ];
  for (const [expected, cmd] of cases) {
    it(`${expected}Command.meta.name === '${expected}'`, async () => {
      expect(await metaName(cmd)).toBe(expected);
    });
  }
});

describe('collaboration cluster — Impl missing-required-args smoke', () => {
  it('aiIntakeImpl returns exitCode=1 for create without name', () => {
    const deps = createTestDeps();
    const r = aiIntakeImpl(deps, { action: 'create' });
    expect(r.exitCode).toBe(1);
  });

  it('bcdrPlanningImpl returns exitCode=1 for define without name', () => {
    const deps = createTestDeps();
    const r = bcdrPlanningImpl(deps, { action: 'define' });
    expect(r.exitCode).toBe(1);
  });

  it('chatIntegrationImpl returns exitCode=1 for notify without args', () => {
    const deps = createTestDeps();
    const r = chatIntegrationImpl(deps, { action: 'notify' });
    expect(r.exitCode).toBe(1);
  });

  it('dataContractsImpl returns exitCode=1 for register without name', () => {
    const deps = createTestDeps();
    const r = dataContractsImpl(deps, { action: 'register' });
    expect(r.exitCode).toBe(1);
  });

  it('deliveryConfidenceImpl returns exitCode=1 for score without file', () => {
    const deps = createTestDeps();
    const r = deliveryConfidenceImpl(deps, { action: 'score' });
    expect(r.exitCode).toBe(1);
  });

  it('diagramStudioImpl returns exitCode=1 for validate without file', () => {
    const deps = createTestDeps();
    const r = diagramStudioImpl(deps, { action: 'validate' });
    expect(r.exitCode).toBe(1);
  });

  it('elicitationImpl returns exitCode=1 for report without session id', () => {
    const deps = createTestDeps();
    const r = elicitationImpl(deps, { action: 'report' });
    expect(r.exitCode).toBe(1);
  });

  it('elicitationImpl returns exitCode=1 for unknown action', () => {
    const deps = createTestDeps();
    const r = elicitationImpl(deps, { action: 'florp' });
    expect(r.exitCode).toBe(1);
  });

  it('estimationStudioImpl returns exitCode=1 for estimate without args', () => {
    const deps = createTestDeps();
    const r = estimationStudioImpl(deps, { action: 'estimate' });
    expect(r.exitCode).toBe(1);
  });
});

describe('collaboration cluster — main.subCommands wiring', () => {
  it('main.subCommands contains every collaboration command name', async () => {
    const subs =
      typeof main.subCommands === 'function' ? await main.subCommands() : await main.subCommands;
    expect(subs).toBeDefined();
    if (!subs) return;
    const expected = [
      'ai-intake',
      'backlog-sync',
      'bcdr-planning',
      'branch-workflow',
      'cab-output',
      'chat-integration',
      'ci-cd-integration',
      'collaboration',
      'context-onboarding',
      'data-contracts',
      'db-evolution',
      'decision-conflicts',
      'delivery-confidence',
      'dependency-upgrade',
      'design-system',
      'diagram-studio',
      'elicitation',
      'estimation-studio',
      'playback-summaries',
    ];
    for (const name of expected) {
      expect(name in subs).toBe(true);
    }
  });
});
