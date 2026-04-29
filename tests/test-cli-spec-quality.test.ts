/**
 * test-cli-spec-quality.test.ts — T4.7.2 batch 5 (spec-quality cluster).
 *
 * Smoke + dispatcher coverage for the twelve `src/cli/commands/spec-quality.ts`
 * commands. Per the seed pattern in `test-cli-lifecycle.test.ts` and
 * `test-cli-marketplace.test.ts`, this file only validates:
 *
 *   1. Each `<name>Command` has the expected `meta.name`.
 *   2. Each `<name>Impl(testDeps, {})` returns `exitCode: 1` when called
 *      with empty/missing-required args (smoke test only — full coverage
 *      lives with the underlying lib in tests/test-ambiguity-heatmap.test.ts,
 *      tests/test-complexity.test.ts, etc.).
 *   3. `main.subCommands` exposes the new lazy thunks.
 *
 * @see src/cli/commands/spec-quality.ts
 * @see specs/implementation-plan.md T4.7.2
 */

import { describe, expect, it } from 'vitest';
import {
  ambiguityHeatmapCommand,
  ambiguityHeatmapImpl,
  astEditCommand,
  astEditImpl,
  bidirectionalTraceCommand,
  bidirectionalTraceImpl,
  ceremonyCommand,
  ceremonyImpl,
  complexityCommand,
  contextChunkerCommand,
  crossrefCommand,
  dashboardCommand,
  domainOntologyCommand,
  domainOntologyImpl,
  eventModelingCommand,
  qualityGraphCommand,
  refactorPlannerCommand,
} from '../src/cli/commands/spec-quality.js';
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

describe('spec-quality cluster — defineCommand meta.name', () => {
  const cases: [string, { meta?: unknown }][] = [
    ['ambiguity-heatmap', ambiguityHeatmapCommand],
    ['complexity', complexityCommand],
    ['context-chunker', contextChunkerCommand],
    ['crossref', crossrefCommand],
    ['ast-edit', astEditCommand],
    ['dashboard', dashboardCommand],
    ['ceremony', ceremonyCommand],
    ['refactor-planner', refactorPlannerCommand],
    ['quality-graph', qualityGraphCommand],
    ['bidirectional-trace', bidirectionalTraceCommand],
    ['domain-ontology', domainOntologyCommand],
    ['event-modeling', eventModelingCommand],
  ];
  for (const [expected, cmd] of cases) {
    it(`${expected}Command.meta.name === '${expected}'`, async () => {
      expect(await metaName(cmd)).toBe(expected);
    });
  }
});

describe('spec-quality cluster — Impl missing-required-args smoke', () => {
  it('ambiguityHeatmapImpl returns exitCode=1 for scan without a file', () => {
    const deps = createTestDeps();
    const r = ambiguityHeatmapImpl(deps, { action: 'scan' });
    expect(r.exitCode).toBe(1);
  });

  it('astEditImpl returns exitCode=1 when file is absent', () => {
    const deps = createTestDeps();
    const r = astEditImpl(deps, {});
    expect(r.exitCode).toBe(1);
  });

  it('bidirectionalTraceImpl returns exitCode=1 for unknown action', () => {
    const deps = createTestDeps();
    const r = bidirectionalTraceImpl(deps, { action: 'florp' });
    expect(r.exitCode).toBe(1);
  });

  it('ceremonyImpl returns exitCode=1 for set without a profile', () => {
    const deps = createTestDeps();
    const r = ceremonyImpl(deps, { action: 'set' });
    expect(r.exitCode).toBe(1);
  });

  it('ceremonyImpl returns exitCode=1 for set with an unknown profile', () => {
    const deps = createTestDeps();
    const r = ceremonyImpl(deps, { action: 'set', arg: 'banana-profile' });
    expect(r.exitCode).toBe(1);
  });

  it('domainOntologyImpl returns exitCode=1 for define with missing args', () => {
    const deps = createTestDeps();
    const r = domainOntologyImpl(deps, { action: 'define' });
    expect(r.exitCode).toBe(1);
  });

  it('domainOntologyImpl returns exitCode=1 for query without a domain', () => {
    const deps = createTestDeps();
    const r = domainOntologyImpl(deps, { action: 'query' });
    expect(r.exitCode).toBe(1);
  });
});

describe('spec-quality cluster — main.subCommands wiring', () => {
  it('main.subCommands contains every spec-quality command name', async () => {
    const subs =
      typeof main.subCommands === 'function' ? await main.subCommands() : await main.subCommands;
    expect(subs).toBeDefined();
    if (!subs) return;
    const expected = [
      'ambiguity-heatmap',
      'complexity',
      'context-chunker',
      'crossref',
      'ast-edit',
      'dashboard',
      'ceremony',
      'refactor-planner',
      'quality-graph',
      'bidirectional-trace',
      'domain-ontology',
      'event-modeling',
    ];
    for (const name of expected) {
      expect(name in subs).toBe(true);
    }
  });
});
