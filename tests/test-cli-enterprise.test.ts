/**
 * test-cli-enterprise.test.ts — T4.7.2 batch 9 (enterprise/platform/misc cluster).
 *
 * Smoke + dispatcher coverage for the 21 `src/cli/commands/enterprise.ts`
 * commands. Per the seed pattern in `test-cli-lifecycle.test.ts`, this file
 * only validates:
 *
 *   1. Each `<name>Command` has the expected `meta.name`.
 *   2. Each `<name>Impl(testDeps, {})` returns an exitCode (0 or 1) when
 *      called with empty/missing-required args (smoke test only — full
 *      coverage lives with the underlying lib in tests/test-<lib>.test.js).
 *   3. `main.subCommands` exposes the new lazy thunks.
 *
 * @see src/cli/commands/enterprise.ts
 * @see specs/implementation-plan.md T4.7.2
 */

import { describe, expect, it } from 'vitest';
import {
  codebaseRetrievalCommand,
  contractFirstCommand,
  deterministicCommand,
  enterpriseSearchCommand,
  enterpriseSearchImpl,
  enterpriseTemplatesCommand,
  envPromotionCommand,
  fitnessFunctionsCommand,
  fitnessFunctionsImpl,
  impactCommand,
  impactImpl,
  knowledgeGraphCommand,
  legacyModernizerCommand,
  mergeTemplatesCommand,
  mergeTemplatesImpl,
  migrationPlannerCommand,
  multiRepoCommand,
  multiRepoImpl,
  parallelAgentsCommand,
  patternLibraryCommand,
  patternLibraryImpl,
  personaPacksCommand,
  personaPacksImpl,
  platformEngineeringCommand,
  promptlessModeCommand,
  prPackageCommand,
  referenceArchCommand,
  referenceArchImpl,
  releaseReadinessCommand,
} from '../src/cli/commands/enterprise.js';
import { createTestDeps } from '../src/cli/deps.js';
import { main } from '../src/cli/main.js';

// citty's CommandDef is heavily generic-parameterized; narrow to a
// minimal "has meta" shape via `unknown` cast for the tabular test.
async function metaName(cmd: { meta?: unknown }): Promise<string | undefined> {
  const m = cmd.meta;
  const resolved =
    typeof m === 'function'
      ? await (m as () => Promise<{ name?: string } | undefined>)()
      : await (m as Promise<{ name?: string } | undefined> | { name?: string } | undefined);
  return resolved?.name;
}

describe('enterprise cluster — defineCommand meta.name', () => {
  const cases: [string, { meta?: unknown }][] = [
    ['enterprise-search', enterpriseSearchCommand],
    ['enterprise-templates', enterpriseTemplatesCommand],
    ['env-promotion', envPromotionCommand],
    ['fitness-functions', fitnessFunctionsCommand],
    ['impact', impactCommand],
    ['knowledge-graph', knowledgeGraphCommand],
    ['legacy-modernizer', legacyModernizerCommand],
    ['merge-templates', mergeTemplatesCommand],
    ['migration-planner', migrationPlannerCommand],
    ['multi-repo', multiRepoCommand],
    ['parallel-agents', parallelAgentsCommand],
    ['pattern-library', patternLibraryCommand],
    ['persona-packs', personaPacksCommand],
    ['platform-engineering', platformEngineeringCommand],
    ['pr-package', prPackageCommand],
    ['promptless-mode', promptlessModeCommand],
    ['reference-arch', referenceArchCommand],
    ['release-readiness', releaseReadinessCommand],
    ['codebase-retrieval', codebaseRetrievalCommand],
    ['contract-first', contractFirstCommand],
    ['deterministic', deterministicCommand],
  ];
  for (const [expected, cmd] of cases) {
    it(`${expected}Command.meta.name === '${expected}'`, async () => {
      expect(await metaName(cmd)).toBe(expected);
    });
  }
});

describe('enterprise cluster — Impl missing-required-args smoke', () => {
  it('impactImpl returns exitCode=1 with no target', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = impactImpl(deps, {});
    expect(r.exitCode).toBe(1);
  });

  it('mergeTemplatesImpl returns exitCode=1 with no paths', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = mergeTemplatesImpl(deps, {});
    expect(r.exitCode).toBe(1);
  });

  it('enterpriseSearchImpl returns exitCode=1 for search with no query', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = enterpriseSearchImpl(deps, { action: 'search' });
    expect(r.exitCode).toBe(1);
  });

  it('multiRepoImpl returns exitCode=1 for init with no name', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = multiRepoImpl(deps, { action: 'init' });
    expect(r.exitCode).toBe(1);
  });

  it('multiRepoImpl returns exitCode=1 for link with no url', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = multiRepoImpl(deps, { action: 'link' });
    expect(r.exitCode).toBe(1);
  });

  it('referenceArchImpl returns exitCode=1 for get with no pattern id', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = referenceArchImpl(deps, { action: 'get' });
    expect(r.exitCode).toBe(1);
  });

  it('referenceArchImpl returns exitCode=1 for instantiate with no pattern id', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = referenceArchImpl(deps, { action: 'instantiate' });
    expect(r.exitCode).toBe(1);
  });

  it('fitnessFunctionsImpl returns exitCode=1 for add with no name', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = fitnessFunctionsImpl(deps, { action: 'add' });
    expect(r.exitCode).toBe(1);
  });

  it('patternLibraryImpl returns exitCode=1 for get with no id', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = patternLibraryImpl(deps, { action: 'get' });
    expect(r.exitCode).toBe(1);
  });

  it('personaPacksImpl returns exitCode=1 for apply with no id', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = personaPacksImpl(deps, { action: 'apply' });
    expect(r.exitCode).toBe(1);
  });
});

describe('enterprise cluster — main.subCommands wiring', () => {
  it('main.subCommands contains every enterprise command name', async () => {
    const subs =
      typeof main.subCommands === 'function' ? await main.subCommands() : await main.subCommands;
    expect(subs).toBeDefined();
    if (!subs) return;
    const expected = [
      'enterprise-search',
      'enterprise-templates',
      'env-promotion',
      'fitness-functions',
      'impact',
      'knowledge-graph',
      'legacy-modernizer',
      'merge-templates',
      'migration-planner',
      'multi-repo',
      'parallel-agents',
      'pattern-library',
      'persona-packs',
      'platform-engineering',
      'pr-package',
      'promptless-mode',
      'reference-arch',
      'release-readiness',
      'codebase-retrieval',
      'contract-first',
      'deterministic',
    ];
    for (const name of expected) {
      expect(name in subs).toBe(true);
    }
  });
});
