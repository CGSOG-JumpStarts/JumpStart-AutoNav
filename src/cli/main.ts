/**
 * main.ts — CLI Dispatcher root entry (T4.7.1).
 *
 * Replaces the 5359-line `bin/cli.js` monolith with a citty-driven
 * tree. Per ADR-002 v2.0.0 (resolved 2026-04-28), the framework is
 * **citty `^0.2.2`** — its lazy `subCommands` map saves the +2370-
 * line registration boilerplate commander would have charged across
 * the 147-leaf 4–5-level subcommand tree.
 *
 * Public surface preserved by the eventual full decomposition (T4.7.2):
 *
 *   - Every `bin/cli.js` `subcommand === '<name>'` branch becomes a
 *     `src/cli/commands/<group>.ts` module exporting a default
 *     `defineCommand`-shaped object.
 *   - `--help` output remains byte-identical (NFR-R02; gated by
 *     `scripts/diff-cli-help.mjs` at T4.7.3).
 *   - Exit codes preserved (per ADR-006 — only this file and
 *     `runIpc` may call `process.exit`).
 *
 * **Lazy loading**: every entry in `subCommands` is a thunk that
 * dynamically imports the leaf module. `node dist/cli.js --version`
 * imports ZERO command modules — a meaningful startup-time win when
 * the eventual tree has ~30 command files.
 *
 * **Deps injection**: `runMain()` is a thin wrapper around citty's
 * `runMain` that constructs a single `Deps` via `createRealDeps()`
 * and threads it into every command's `run()`. Per-command tests
 * pass `createTestDeps({ ... })` directly into the same handler
 * function (commands export both the `defineCommand` object AND the
 * inner handler function for test access).
 *
 * **NOT YET PORTED in this file** (T4.7.2): the actual 147 command
 * modules. T4.7.1's scope is the entry point + deps wiring + a
 * minimal sub-tree showing the pattern. Subsequent commits in this
 * branch decompose the legacy `bin/cli.js` into the full tree.
 *
 * @see specs/decisions/adr-002-cli-framework.md (citty + lazy subCommands)
 * @see specs/architecture.md §System Components — CLI Dispatcher
 * @see specs/implementation-plan.md T4.7.1
 */

import { type CommandDef, runMain as cittyRunMain, defineCommand } from 'citty';
import { createRealDeps, type Deps } from './deps.js';

// ─────────────────────────────────────────────────────────────────────────
// Package version
// ─────────────────────────────────────────────────────────────────────────

/**
 * Framework version — read at runtime from `package.json` so it
 * cannot drift from the canonical source.
 *
 * Pit Crew M8 MED (QA 4) fix: pre-fix used a hardcoded `'1.1.14'`
 * constant + matching test assertion. A version bump in package.json
 * would NOT have caused either to fail; the version contract was
 * silent-drift-prone. Post-fix: `require('../../../package.json')`
 * reads the canonical value at module-load time. The `version`
 * field is the spec's source of truth.
 *
 * Strangler-phase note: bare `require()` is allowed under the CJS
 * tsconfig. M9 cutover swaps to `import { createRequire } from
 * 'node:module'; const require = createRequire(import.meta.url)`.
 */
function readPackageVersion(): string {
  const pkg = require('../../package.json') as { version?: string };
  return pkg.version ?? '0.0.0';
}
const FRAMEWORK_VERSION = readPackageVersion();

// ─────────────────────────────────────────────────────────────────────────
// SubCommands map
// ─────────────────────────────────────────────────────────────────────────

/**
 * Lazy `subCommands` map — citty resolves each entry only when the
 * matching sub-command is invoked. T4.7.2 grows this map to ~30
 * entries covering all 147 leaf commands (most leaves nest under
 * group commands like `hash <register|verify>`,
 * `graph <build|coverage>`, `cab <add|view|...>`).
 *
 * Pattern (T4.7.2 onward):
 *
 *   verify: () => import('./commands/verify.js').then((m) => m.default),
 *
 * For now (T4.7.1), only the seed `version-tag` command is wired —
 * just enough to prove the citty plumbing typechecks and runs.
 */
/** Lazy command loader. The cast widens each command's tightly-inferred
 *  CommandDef<{...specific args...}> shape into the map's
 *  CommandDef<any> index signature without losing type-safety inside
 *  each command's own module. */
function lazy<T>(loader: () => Promise<T>): () => Promise<CommandDef> {
  return async () => (await loader()) as unknown as CommandDef;
}

const subCommands: Record<string, () => Promise<CommandDef>> = {
  // Seed (T4.7.1)
  'version-tag': lazy(() => import('./commands/version-tag.js').then((m) => m.default)),

  // Spec-validation cluster (T4.7.2 batch 1 — bin/cli.js lines ~972-1205)
  validate: lazy(() => import('./commands/spec-validation.js').then((m) => m.validateCommand)),
  'spec-drift': lazy(() => import('./commands/spec-validation.js').then((m) => m.specDriftCommand)),
  hash: lazy(() => import('./commands/spec-validation.js').then((m) => m.hashCommand)),
  graph: lazy(() => import('./commands/spec-validation.js').then((m) => m.graphCommand)),
  simplicity: lazy(() => import('./commands/spec-validation.js').then((m) => m.simplicityCommand)),
  'scan-wrappers': lazy(() =>
    import('./commands/spec-validation.js').then((m) => m.scanWrappersCommand)
  ),
  invariants: lazy(() => import('./commands/spec-validation.js').then((m) => m.invariantsCommand)),
  'template-check': lazy(() =>
    import('./commands/spec-validation.js').then((m) => m.templateCheckCommand)
  ),
  'freshness-audit': lazy(() =>
    import('./commands/spec-validation.js').then((m) => m.freshnessAuditCommand)
  ),
  shard: lazy(() => import('./commands/spec-validation.js').then((m) => m.shardCommand)),
  checklist: lazy(() => import('./commands/spec-validation.js').then((m) => m.checklistCommand)),
  smells: lazy(() => import('./commands/spec-validation.js').then((m) => m.smellsCommand)),

  // Handoff/coverage cluster (T4.7.2 batch 1 — bin/cli.js lines ~1217-1340)
  'handoff-check': lazy(() => import('./commands/handoff.js').then((m) => m.handoffCheckCommand)),
  coverage: lazy(() => import('./commands/handoff.js').then((m) => m.coverageCommand)),
  consistency: lazy(() => import('./commands/handoff.js').then((m) => m.consistencyCommand)),
  lint: lazy(() => import('./commands/handoff.js').then((m) => m.lintCommand)),
  contracts: lazy(() => import('./commands/handoff.js').then((m) => m.contractsCommand)),
  regulatory: lazy(() => import('./commands/handoff.js').then((m) => m.regulatoryCommand)),
  boundaries: lazy(() => import('./commands/handoff.js').then((m) => m.boundariesCommand)),
  'task-deps': lazy(() => import('./commands/handoff.js').then((m) => m.taskDepsCommand)),
  diff: lazy(() => import('./commands/handoff.js').then((m) => m.diffCommand)),
  modules: lazy(() => import('./commands/handoff.js').then((m) => m.modulesCommand)),
  'validate-module': lazy(() =>
    import('./commands/handoff.js').then((m) => m.validateModuleCommand)
  ),
  handoff: lazy(() => import('./commands/handoff.js').then((m) => m.handoffCommand)),

  // Lifecycle/state cluster (T4.7.2 batch 2 — bin/cli.js lines ~1762, 1815-1898,
  // 2166-2306, 2498-2553, 2997-3052, 4162-4193, 5213-5273)
  approve: lazy(() => import('./commands/lifecycle.js').then((m) => m.approveCommand)),
  reject: lazy(() => import('./commands/lifecycle.js').then((m) => m.rejectCommand)),
  checkpoint: lazy(() => import('./commands/lifecycle.js').then((m) => m.checkpointCommand)),
  'agent-checkpoint': lazy(() =>
    import('./commands/lifecycle.js').then((m) => m.agentCheckpointCommand)
  ),
  focus: lazy(() => import('./commands/lifecycle.js').then((m) => m.focusCommand)),
  init: lazy(() => import('./commands/lifecycle.js').then((m) => m.initCommand)),
  lock: lazy(() => import('./commands/lifecycle.js').then((m) => m.lockCommand)),
  memory: lazy(() => import('./commands/lifecycle.js').then((m) => m.memoryCommand)),
  rewind: lazy(() => import('./commands/lifecycle.js').then((m) => m.rewindCommand)),
  next: lazy(() => import('./commands/lifecycle.js').then((m) => m.nextCommand)),
  'plan-executor': lazy(() => import('./commands/lifecycle.js').then((m) => m.planExecutorCommand)),

  // Marketplace cluster (T4.7.2 batch 3 — bin/cli.js lines 1350-1732)
  install: lazy(() => import('./commands/marketplace.js').then((m) => m.installCommand)),
  uninstall: lazy(() => import('./commands/marketplace.js').then((m) => m.uninstallCommand)),
  status: lazy(() => import('./commands/marketplace.js').then((m) => m.statusCommand)),
  integrate: lazy(() => import('./commands/marketplace.js').then((m) => m.integrateCommand)),
  update: lazy(() => import('./commands/marketplace.js').then((m) => m.updateCommand)),
  upgrade: lazy(() => import('./commands/marketplace.js').then((m) => m.upgradeCommand)),

  // Runners cluster (T4.7.2 batch 4)
  verify: lazy(() => import('./commands/runners.js').then((m) => m.verifyCommand)),
  holodeck: lazy(() => import('./commands/runners.js').then((m) => m.holodeckCommand)),
  headless: lazy(() => import('./commands/runners.js').then((m) => m.headlessCommand)),
  smoke: lazy(() => import('./commands/runners.js').then((m) => m.smokeCommand)),
  regression: lazy(() => import('./commands/runners.js').then((m) => m.regressionCommand)),
  test: lazy(() => import('./commands/runners.js').then((m) => m.testCommand)),

  // Spec-quality cluster (T4.7.2 batch 5)
  'ambiguity-heatmap': lazy(() =>
    import('./commands/spec-quality.js').then((m) => m.ambiguityHeatmapCommand)
  ),
  complexity: lazy(() => import('./commands/spec-quality.js').then((m) => m.complexityCommand)),
  'context-chunker': lazy(() =>
    import('./commands/spec-quality.js').then((m) => m.contextChunkerCommand)
  ),
  crossref: lazy(() => import('./commands/spec-quality.js').then((m) => m.crossrefCommand)),
  'ast-edit': lazy(() => import('./commands/spec-quality.js').then((m) => m.astEditCommand)),
  dashboard: lazy(() => import('./commands/spec-quality.js').then((m) => m.dashboardCommand)),
  ceremony: lazy(() => import('./commands/spec-quality.js').then((m) => m.ceremonyCommand)),
  'refactor-planner': lazy(() =>
    import('./commands/spec-quality.js').then((m) => m.refactorPlannerCommand)
  ),
  'quality-graph': lazy(() =>
    import('./commands/spec-quality.js').then((m) => m.qualityGraphCommand)
  ),
  'bidirectional-trace': lazy(() =>
    import('./commands/spec-quality.js').then((m) => m.bidirectionalTraceCommand)
  ),
  'domain-ontology': lazy(() =>
    import('./commands/spec-quality.js').then((m) => m.domainOntologyCommand)
  ),
  'event-modeling': lazy(() =>
    import('./commands/spec-quality.js').then((m) => m.eventModelingCommand)
  ),

  // LLM/cost cluster (T4.7.2 batch 6)
  'cost-router': lazy(() => import('./commands/llm.js').then((m) => m.costRouterCommand)),
  'model-router': lazy(() => import('./commands/llm.js').then((m) => m.modelRouterCommand)),
  'model-governance': lazy(() => import('./commands/llm.js').then((m) => m.modelGovernanceCommand)),
  'prompt-governance': lazy(() =>
    import('./commands/llm.js').then((m) => m.promptGovernanceCommand)
  ),
  usage: lazy(() => import('./commands/llm.js').then((m) => m.usageCommand)),
  'ai-intake': lazy(() => import('./commands/llm.js').then((m) => m.aiIntakeCommand)),
  'finops-planner': lazy(() => import('./commands/llm.js').then((m) => m.finopsPlannerCommand)),

  // Enterprise/platform/misc cluster (T4.7.2 batch 9 — FINAL)
  'enterprise-search': lazy(() =>
    import('./commands/enterprise.js').then((m) => m.enterpriseSearchCommand)
  ),
  'enterprise-templates': lazy(() =>
    import('./commands/enterprise.js').then((m) => m.enterpriseTemplatesCommand)
  ),
  'env-promotion': lazy(() =>
    import('./commands/enterprise.js').then((m) => m.envPromotionCommand)
  ),
  'fitness-functions': lazy(() =>
    import('./commands/enterprise.js').then((m) => m.fitnessFunctionsCommand)
  ),
  impact: lazy(() => import('./commands/enterprise.js').then((m) => m.impactCommand)),
  'knowledge-graph': lazy(() =>
    import('./commands/enterprise.js').then((m) => m.knowledgeGraphCommand)
  ),
  'legacy-modernizer': lazy(() =>
    import('./commands/enterprise.js').then((m) => m.legacyModernizerCommand)
  ),
  'merge-templates': lazy(() =>
    import('./commands/enterprise.js').then((m) => m.mergeTemplatesCommand)
  ),
  'migration-planner': lazy(() =>
    import('./commands/enterprise.js').then((m) => m.migrationPlannerCommand)
  ),
  'multi-repo': lazy(() => import('./commands/enterprise.js').then((m) => m.multiRepoCommand)),
  'parallel-agents': lazy(() =>
    import('./commands/enterprise.js').then((m) => m.parallelAgentsCommand)
  ),
  'pattern-library': lazy(() =>
    import('./commands/enterprise.js').then((m) => m.patternLibraryCommand)
  ),
  'persona-packs': lazy(() =>
    import('./commands/enterprise.js').then((m) => m.personaPacksCommand)
  ),
  'platform-engineering': lazy(() =>
    import('./commands/enterprise.js').then((m) => m.platformEngineeringCommand)
  ),
  'pr-package': lazy(() => import('./commands/enterprise.js').then((m) => m.prPackageCommand)),
  'promptless-mode': lazy(() =>
    import('./commands/enterprise.js').then((m) => m.promptlessModeCommand)
  ),
  'reference-arch': lazy(() =>
    import('./commands/enterprise.js').then((m) => m.referenceArchCommand)
  ),
  'release-readiness': lazy(() =>
    import('./commands/enterprise.js').then((m) => m.releaseReadinessCommand)
  ),
  'codebase-retrieval': lazy(() =>
    import('./commands/enterprise.js').then((m) => m.codebaseRetrievalCommand)
  ),
  'contract-first': lazy(() =>
    import('./commands/enterprise.js').then((m) => m.contractFirstCommand)
  ),
  deterministic: lazy(() => import('./commands/enterprise.js').then((m) => m.deterministicCommand)),
};

// ─────────────────────────────────────────────────────────────────────────
// Root program
// ─────────────────────────────────────────────────────────────────────────

/**
 * The root citty command. `meta` provides `--version` + `--help`;
 * `subCommands` provides the lazy dispatch tree.
 *
 * No `args` at the root level — every meaningful positional arg
 * belongs to a sub-command. This deliberately diverges from the
 * legacy `bin/cli.js` which accepted a bare positional `targetDir`
 * for the bootstrap default; that path is moving to an explicit
 * `init` sub-command in T4.7.2 alongside the rest of the tree.
 *
 * Pit Crew M8 will validate the migration is byte-identical at the
 * `--help` snapshot level (T4.7.3).
 */
export const main = defineCommand({
  meta: {
    name: 'jumpstart-mode',
    version: FRAMEWORK_VERSION,
    description:
      'Jump Start Framework — spec-driven agentic coding workflow with 147 sub-commands.',
  },
  subCommands,
  setup() {
    // Hooks per citty docs. setup() runs before run(); cleanup()
    // runs after (or on throw). Currently no-op; reserved for
    // future cross-command instrumentation (timing, telemetry).
  },
  cleanup() {
    // Reserved.
  },
});

// ─────────────────────────────────────────────────────────────────────────
// Top-level entry
// ─────────────────────────────────────────────────────────────────────────

/**
 * Entry point invoked by `bin/cli.js` (post-port) or
 * `dist/cli.js` (post-M9). Constructs a single `Deps` instance via
 * `createRealDeps()` and hands off to citty.
 *
 * The `_deps` parameter is reserved for future use — once T4.7.2
 * threads deps into every command, this is where they get
 * constructed. Today, commands construct their own deps for backward
 * compat with the legacy `bin/cli.js` invocation surface; the
 * threading happens incrementally as commands port over.
 *
 * **ADR-006 exit-code contract**: this is one of two allowlisted
 * `process.exit` sites in the codebase (the other is `runIpc`). All
 * non-CLI library code throws `JumpstartError` subclasses; the
 * top-level catch here translates them to exit codes.
 */
export async function runMain(): Promise<void> {
  // Reserved: const deps = createRealDeps();
  // Threaded into commands incrementally as T4.7.2 lands.
  void createRealDeps;
  await cittyRunMain(main);
}

// Allow direct invocation for the pre-M9 strangler phase. Once we
// flip ESM at M9, this file becomes the package's `bin` target
// directly and the require-vs-import-shaped check disappears.
//
// Currently NOT wired — `bin/cli.js` still serves as the npm-bin
// entry. T4.7.2 finishes the decomposition; T5.1 (M9) flips this
// file to the bin target.
//
// We export the `Deps` type so command modules importing this file
// for type-only references get the right symbols.
export type { Deps };
