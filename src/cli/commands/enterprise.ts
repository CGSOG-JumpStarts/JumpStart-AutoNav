/**
 * enterprise.ts — Enterprise / platform / codebase-intel / misc cluster
 * (T4.7.2 batch 9 — FINAL).
 *
 * Ports the residual `bin/cli.js` subcommands not covered by batches 1-8.
 * Per the strangler pattern, each command here is a **thin wrapper** that
 * delegates to its legacy `bin/lib/<name>.js` implementation via
 * `legacyRequire()`. Once a lib has a `bin/lib-ts/*.ts` port, the
 * top-level ES import takes over (see lifecycle.ts and runners.ts for
 * canonical examples).
 *
 * Per-command structure:
 *   - `<name>Args` interface — citty-style typed args.
 *   - `<name>Impl(deps, args)` — pure function returning `CommandResult`.
 *   - `<name>Command` — `defineCommand` with `meta.name` and `run()`.
 *
 * **Architectural rules** (per the request and ADR-006/-009):
 *   1. Public surface preserved (every command name is reachable).
 *   2. Named exports for both `<name>Command` and `<name>Impl`.
 *   3. Any user-supplied path routed through `assertUserPath()`.
 *   4. No `process.exit()` — return `CommandResult { exitCode }`.
 *   5. `.js` extensions on all relative imports.
 *   6. Top-level ES imports for lib-ts (none in this batch — all use
 *      `legacyRequire`).
 *
 * **Skipped** (not in this batch):
 *   - `quickstart` — interactive prompts wizard, requires `prompts` lib
 *     and the install() entry point; out-of-scope for a thin port.
 *   - `self-evolve`, `summarize`, `validate-all`, `timeline` — also
 *     interactive / large-scope; deferred.
 *
 * @see bin/cli.js (line ranges noted per command)
 * @see specs/implementation-plan.md T4.7.2
 */

import { defineCommand } from 'citty';
import { type CommandResult, createRealDeps, type Deps } from '../deps.js';
import { assertUserPath, legacyRequire, safeJoin } from './_helpers.js';

// Permissive shape for legacy lib modules — every callsite immediately narrows
// via property access. Documenting once here so individual commands stay terse.
// biome-ignore lint/suspicious/noExplicitAny: <legacy lib runtime shapes>
type LegacyLib = Record<string, any>;

/** Helper: write result via legacy io.writeResult when --json mode is on,
 *  otherwise let the caller render. The `_deps` arg is reserved for a
 *  future logger-aware JSON sink (currently the legacy `io.writeResult`
 *  writes directly to stdout). */
function maybeJson(_deps: Deps, json: boolean | undefined, result: unknown): void {
  if (!json) return;
  const io = legacyRequire<{ writeResult: (r: unknown) => void }>('io');
  io.writeResult(result);
}

// ─────────────────────────────────────────────────────────────────────────
// enterprise-search (bin/cli.js ~5098)
// ─────────────────────────────────────────────────────────────────────────

export interface EnterpriseSearchArgs {
  action?: string;
  query?: string;
  json?: boolean;
}

export function enterpriseSearchImpl(deps: Deps, args: EnterpriseSearchArgs): CommandResult {
  const lib = legacyRequire<LegacyLib>('enterprise-search');
  const action = args.action ?? 'index';
  if (action === 'search') {
    if (!args.query) {
      deps.logger.error('Usage: jumpstart-mode enterprise-search search <query>');
      return { exitCode: 1 };
    }
    const result = lib.searchProject(deps.projectRoot, args.query);
    maybeJson(deps, args.json, result);
    if (!args.json)
      deps.logger.info(`Search "${args.query}" — ${result.total_results ?? 0} results`);
    return { exitCode: 0 };
  }
  const result = lib.indexProject(deps.projectRoot);
  maybeJson(deps, args.json, result);
  if (!args.json) deps.logger.info(`Enterprise Search Index: ${result.total_entries ?? 0} entries`);
  return { exitCode: 0 };
}

export const enterpriseSearchCommand = defineCommand({
  meta: { name: 'enterprise-search', description: 'Enterprise search index/query' },
  args: {
    action: { type: 'positional', required: false, description: 'index | search' },
    query: { type: 'positional', required: false, description: 'search query' },
    json: { type: 'boolean', required: false, description: 'JSON output' },
  },
  run({ args }) {
    const r = enterpriseSearchImpl(createRealDeps(), {
      action: args.action,
      query: args.query,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'enterprise-search failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// enterprise-templates (bin/cli.js ~4421)
// ─────────────────────────────────────────────────────────────────────────

export interface EnterpriseTemplatesArgs {
  action?: string;
  arg?: string;
  json?: boolean;
}

export function enterpriseTemplatesImpl(deps: Deps, args: EnterpriseTemplatesArgs): CommandResult {
  const lib = legacyRequire<LegacyLib>('enterprise-templates');
  const action = args.action ?? 'list';
  const stateFile = safeJoin(deps, '.jumpstart', 'state', 'enterprise-templates.json');
  let result: unknown;
  if (action === 'list') {
    result = lib.listTemplates({ stateFile });
  } else if (action === 'apply') {
    if (!args.arg) {
      deps.logger.error('Usage: jumpstart-mode enterprise-templates apply <template-id>');
      return { exitCode: 1 };
    }
    result = lib.applyTemplate(args.arg, deps.projectRoot, { stateFile });
  } else if (action === 'register') {
    if (!args.arg) {
      deps.logger.error('Usage: jumpstart-mode enterprise-templates register <name>');
      return { exitCode: 1 };
    }
    result = lib.registerTemplate({ name: args.arg }, { stateFile });
  } else {
    result = lib.listTemplates({ stateFile });
  }
  maybeJson(deps, args.json, result);
  if (!args.json) deps.logger.info(`Enterprise templates: ${action} complete`);
  return { exitCode: 0 };
}

export const enterpriseTemplatesCommand = defineCommand({
  meta: { name: 'enterprise-templates', description: 'Enterprise template registry' },
  args: {
    action: { type: 'positional', required: false, description: 'list | apply | register' },
    arg: { type: 'positional', required: false, description: 'template id or name' },
    json: { type: 'boolean', required: false, description: 'JSON output' },
  },
  run({ args }) {
    const r = enterpriseTemplatesImpl(createRealDeps(), {
      action: args.action,
      arg: args.arg,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'enterprise-templates failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// env-promotion (bin/cli.js ~3322)
// ─────────────────────────────────────────────────────────────────────────

export interface EnvPromotionArgs {
  action?: string;
  arg?: string;
  json?: boolean;
}

export function envPromotionImpl(deps: Deps, args: EnvPromotionArgs): CommandResult {
  const lib = legacyRequire<LegacyLib>('environment-promotion');
  const action = args.action ?? 'status';
  const stateFile = safeJoin(deps, '.jumpstart', 'state', 'environment-promotion.json');
  let result: unknown;
  if (action === 'promote') {
    if (!args.arg) {
      deps.logger.error('Usage: jumpstart-mode env-promotion promote <environment>');
      return { exitCode: 1 };
    }
    result = lib.promote(args.arg, { stateFile });
  } else if (action === 'gate') {
    if (!args.arg) {
      deps.logger.error('Usage: jumpstart-mode env-promotion gate <environment>');
      return { exitCode: 1 };
    }
    result = lib.checkGates(args.arg, { stateFile });
  } else {
    result = lib.getStatus({ stateFile });
  }
  maybeJson(deps, args.json, result);
  if (!args.json) deps.logger.info(`Env promotion: ${action}`);
  return { exitCode: 0 };
}

export const envPromotionCommand = defineCommand({
  meta: { name: 'env-promotion', description: 'Environment promotion gates' },
  args: {
    action: { type: 'positional', required: false, description: 'status | promote | gate' },
    arg: { type: 'positional', required: false, description: 'environment name' },
    json: { type: 'boolean', required: false, description: 'JSON output' },
  },
  run({ args }) {
    const r = envPromotionImpl(createRealDeps(), {
      action: args.action,
      arg: args.arg,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'env-promotion failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// fitness-functions (bin/cli.js ~3056)
// ─────────────────────────────────────────────────────────────────────────

export interface FitnessFunctionsArgs {
  action?: string;
  name?: string;
  category?: string;
  json?: boolean;
}

export function fitnessFunctionsImpl(deps: Deps, args: FitnessFunctionsArgs): CommandResult {
  const lib = legacyRequire<LegacyLib>('fitness-functions');
  const action = args.action ?? 'evaluate';
  const registryFile = safeJoin(deps, '.jumpstart', 'fitness-functions.json');
  let result: unknown;
  if (action === 'add') {
    if (!args.name || !args.category) {
      deps.logger.error('Usage: jumpstart-mode fitness-functions add <name> <category>');
      return { exitCode: 1 };
    }
    result = lib.addFitnessFunction(
      {
        name: args.name,
        category: args.category,
        description: `Fitness function: ${args.name}`,
        pattern: null,
        threshold: null,
      },
      { registryFile }
    );
  } else if (action === 'list') {
    result = lib.listFitnessFunctions({}, { registryFile });
  } else {
    result = lib.evaluateFitness(deps.projectRoot, { registryFile });
  }
  maybeJson(deps, args.json, result);
  if (!args.json) deps.logger.info(`Fitness functions: ${action}`);
  return { exitCode: 0 };
}

export const fitnessFunctionsCommand = defineCommand({
  meta: { name: 'fitness-functions', description: 'Architecture fitness functions' },
  args: {
    action: { type: 'positional', required: false, description: 'evaluate | add | list' },
    name: { type: 'positional', required: false, description: 'function name (add only)' },
    category: { type: 'positional', required: false, description: 'category (add only)' },
    json: { type: 'boolean', required: false, description: 'JSON output' },
  },
  run({ args }) {
    const r = fitnessFunctionsImpl(createRealDeps(), {
      action: args.action,
      name: args.name,
      category: args.category,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'fitness-functions failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// impact (bin/cli.js ~2441)
// ─────────────────────────────────────────────────────────────────────────

export interface ImpactArgs {
  file?: string;
  symbol?: string;
  spec?: string;
  json?: boolean;
}

export function impactImpl(deps: Deps, args: ImpactArgs): CommandResult {
  if (!args.file && !args.symbol && !args.spec) {
    deps.logger.error('Usage: jumpstart-mode impact <file> [--symbol <name>] [--spec <id>]');
    return { exitCode: 1 };
  }
  const lib = legacyRequire<LegacyLib>('impact-analysis');
  const target: Record<string, string> = {};
  if (args.file) target.file = assertUserPath(deps, args.file, 'impact:file');
  if (args.symbol) target.symbol = args.symbol;
  if (args.spec) target.specId = args.spec;
  const result = lib.analyzeImpact(deps.projectRoot, target);
  maybeJson(deps, args.json, result);
  if (!args.json && lib.renderImpactReport) deps.logger.info(lib.renderImpactReport(result));
  return { exitCode: 0 };
}

export const impactCommand = defineCommand({
  meta: { name: 'impact', description: 'Change impact analysis' },
  args: {
    file: { type: 'positional', required: false, description: 'target file' },
    symbol: { type: 'string', required: false, description: 'symbol name' },
    spec: { type: 'string', required: false, description: 'spec id' },
    json: { type: 'boolean', required: false, description: 'JSON output' },
  },
  run({ args }) {
    const r = impactImpl(createRealDeps(), {
      file: args.file,
      symbol: args.symbol,
      spec: args.spec,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'impact failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// knowledge-graph (bin/cli.js ~4808)
// ─────────────────────────────────────────────────────────────────────────

export interface KnowledgeGraphArgs {
  action?: string;
  arg?: string;
  json?: boolean;
}

export function knowledgeGraphImpl(deps: Deps, args: KnowledgeGraphArgs): CommandResult {
  // knowledge-graph isn't a separate lib in this codebase — it surfaces
  // through the repo-graph and bidirectional-trace facilities. For the
  // strangler port we delegate via repo-graph which is the canonical
  // backing store for nodes/edges.
  const lib = legacyRequire<LegacyLib>('repo-graph');
  const graphFile = safeJoin(deps, '.jumpstart', 'state', 'repo-graph.json');
  const action = args.action ?? 'build';
  let result: unknown;
  if (action === 'query') {
    const graph = lib.loadRepoGraph(graphFile);
    result = lib.queryGraph(graph, { type: args.arg ?? null, nameContains: null });
  } else {
    result = lib.buildRepoGraph(deps.projectRoot, { graphFile });
  }
  maybeJson(deps, args.json, result);
  if (!args.json) deps.logger.info(`Knowledge graph: ${action}`);
  return { exitCode: 0 };
}

export const knowledgeGraphCommand = defineCommand({
  meta: { name: 'knowledge-graph', description: 'Repo knowledge graph (build/query)' },
  args: {
    action: { type: 'positional', required: false, description: 'build | query' },
    arg: { type: 'positional', required: false, description: 'node type filter (query)' },
    json: { type: 'boolean', required: false, description: 'JSON output' },
  },
  run({ args }) {
    const r = knowledgeGraphImpl(createRealDeps(), {
      action: args.action,
      arg: args.arg,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'knowledge-graph failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// legacy-modernizer (bin/cli.js ~3975)
// ─────────────────────────────────────────────────────────────────────────

export interface LegacyModernizerArgs {
  action?: string;
  arg?: string;
  json?: boolean;
}

export function legacyModernizerImpl(deps: Deps, args: LegacyModernizerArgs): CommandResult {
  const lib = legacyRequire<LegacyLib>('legacy-modernizer');
  const action = args.action ?? 'scan';
  let result: unknown;
  if (action === 'plan') {
    result = lib.planModernization?.(deps.projectRoot) ?? lib.scan?.(deps.projectRoot);
  } else {
    result = lib.scan?.(deps.projectRoot) ?? lib.scanLegacy?.(deps.projectRoot);
  }
  maybeJson(deps, args.json, result);
  if (!args.json) deps.logger.info(`Legacy modernizer: ${action}`);
  return { exitCode: 0 };
}

export const legacyModernizerCommand = defineCommand({
  meta: { name: 'legacy-modernizer', description: 'Legacy code modernization scanner' },
  args: {
    action: { type: 'positional', required: false, description: 'scan | plan' },
    arg: { type: 'positional', required: false, description: 'optional argument' },
    json: { type: 'boolean', required: false, description: 'JSON output' },
  },
  run({ args }) {
    const r = legacyModernizerImpl(createRealDeps(), {
      action: args.action,
      arg: args.arg,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'legacy-modernizer failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// merge-templates (bin/cli.js ~2331)
// ─────────────────────────────────────────────────────────────────────────

export interface MergeTemplatesArgs {
  basePath?: string;
  projectPath?: string;
}

export function mergeTemplatesImpl(deps: Deps, args: MergeTemplatesArgs): CommandResult {
  if (!args.basePath || !args.projectPath) {
    deps.logger.error('Usage: jumpstart-mode merge-templates <base-path> <project-path>');
    return { exitCode: 1 };
  }
  // Both paths are user-supplied — gate them. Note: legacy bin/cli.js used
  // path.resolve on caller input verbatim; the safer port uses assertUserPath
  // which keeps both inside projectRoot per ADR-009.
  const safeBase = assertUserPath(deps, args.basePath, 'merge-templates:base');
  const safeProject = assertUserPath(deps, args.projectPath, 'merge-templates:project');
  const lib = legacyRequire<LegacyLib>('template-merge');
  const result = lib.mergeTemplateFiles(safeBase, safeProject);
  deps.logger.info(JSON.stringify({ stats: result.stats }, null, 2));
  if (result.merged) deps.logger.info(result.merged);
  return { exitCode: 0 };
}

export const mergeTemplatesCommand = defineCommand({
  meta: { name: 'merge-templates', description: 'Template inheritance merge' },
  args: {
    basePath: { type: 'positional', required: false, description: 'base template path' },
    projectPath: { type: 'positional', required: false, description: 'project path' },
  },
  run({ args }) {
    const r = mergeTemplatesImpl(createRealDeps(), {
      basePath: args.basePath,
      projectPath: args.projectPath,
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'merge-templates failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// migration-planner (bin/cli.js ~3961)
// ─────────────────────────────────────────────────────────────────────────

export interface MigrationPlannerArgs {
  action?: string;
  arg?: string;
  json?: boolean;
}

export function migrationPlannerImpl(deps: Deps, args: MigrationPlannerArgs): CommandResult {
  const lib = legacyRequire<LegacyLib>('migration-planner');
  const action = args.action ?? 'plan';
  const result = lib.planMigration
    ? lib.planMigration(deps.projectRoot, { target: args.arg })
    : lib.plan?.(deps.projectRoot);
  maybeJson(deps, args.json, result);
  if (!args.json) deps.logger.info(`Migration planner: ${action}`);
  return { exitCode: 0 };
}

export const migrationPlannerCommand = defineCommand({
  meta: { name: 'migration-planner', description: 'Migration plan generator' },
  args: {
    action: { type: 'positional', required: false, description: 'plan | execute' },
    arg: { type: 'positional', required: false, description: 'target' },
    json: { type: 'boolean', required: false, description: 'JSON output' },
  },
  run({ args }) {
    const r = migrationPlannerImpl(createRealDeps(), {
      action: args.action,
      arg: args.arg,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'migration-planner failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// multi-repo (bin/cli.js ~2347)
// ─────────────────────────────────────────────────────────────────────────

export interface MultiRepoArgs {
  action?: string;
  arg?: string;
  role?: string;
  json?: boolean;
}

export function multiRepoImpl(deps: Deps, args: MultiRepoArgs): CommandResult {
  const lib = legacyRequire<LegacyLib>('multi-repo');
  const stateFile = safeJoin(deps, '.jumpstart', 'state', 'multi-repo.json');
  const action = args.action ?? 'status';
  let result: unknown;
  if (action === 'init') {
    if (!args.arg) {
      deps.logger.error('Usage: jumpstart-mode multi-repo init <program-name>');
      return { exitCode: 1 };
    }
    result = lib.initProgram(args.arg, { stateFile });
  } else if (action === 'link') {
    if (!args.arg) {
      deps.logger.error('Usage: jumpstart-mode multi-repo link <repo-url> [role]');
      return { exitCode: 1 };
    }
    result = lib.linkRepo(args.arg, args.role ?? 'other', { stateFile });
  } else {
    result = lib.getProgramStatus({ stateFile });
  }
  maybeJson(deps, args.json, result);
  if (!args.json) deps.logger.info(`Multi-repo: ${action}`);
  return { exitCode: 0 };
}

export const multiRepoCommand = defineCommand({
  meta: { name: 'multi-repo', description: 'Multi-repo program orchestration' },
  args: {
    action: { type: 'positional', required: false, description: 'status | init | link | plan' },
    arg: { type: 'positional', required: false, description: 'program name or repo url' },
    role: { type: 'positional', required: false, description: 'repo role (link only)' },
    json: { type: 'boolean', required: false, description: 'JSON output' },
  },
  run({ args }) {
    const r = multiRepoImpl(createRealDeps(), {
      action: args.action,
      arg: args.arg,
      role: args.role,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'multi-repo failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// parallel-agents (bin/cli.js ~2703)
// ─────────────────────────────────────────────────────────────────────────

export interface ParallelAgentsArgs {
  action?: string;
  arg?: string;
  json?: boolean;
}

export function parallelAgentsImpl(deps: Deps, args: ParallelAgentsArgs): CommandResult {
  const lib = legacyRequire<LegacyLib>('parallel-agents');
  const action = args.action ?? 'status';
  const stateFile = safeJoin(deps, '.jumpstart', 'state', 'parallel-agents.json');
  let result: unknown;
  if (action === 'plan') {
    result = lib.planParallelExecution
      ? lib.planParallelExecution(deps.projectRoot, { stateFile })
      : lib.getStatus?.({ stateFile });
  } else {
    result = lib.getStatus?.({ stateFile });
  }
  maybeJson(deps, args.json, result);
  if (!args.json) deps.logger.info(`Parallel agents: ${action}`);
  return { exitCode: 0 };
}

export const parallelAgentsCommand = defineCommand({
  meta: { name: 'parallel-agents', description: 'Parallel agent orchestration' },
  args: {
    action: { type: 'positional', required: false, description: 'status | plan' },
    arg: { type: 'positional', required: false, description: 'optional argument' },
    json: { type: 'boolean', required: false, description: 'JSON output' },
  },
  run({ args }) {
    const r = parallelAgentsImpl(createRealDeps(), {
      action: args.action,
      arg: args.arg,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'parallel-agents failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// pattern-library (bin/cli.js ~4838)
// ─────────────────────────────────────────────────────────────────────────

export interface PatternLibraryArgs {
  action?: string;
  arg?: string;
  json?: boolean;
}

export function patternLibraryImpl(deps: Deps, args: PatternLibraryArgs): CommandResult {
  const lib = legacyRequire<LegacyLib>('pattern-library');
  const action = args.action ?? 'list';
  let result: unknown;
  if (action === 'get') {
    if (!args.arg) {
      deps.logger.error('Usage: jumpstart-mode pattern-library get <pattern-id>');
      return { exitCode: 1 };
    }
    result = lib.getPattern?.(args.arg);
  } else {
    result = lib.listPatterns?.() ?? { patterns: [], total: 0 };
  }
  maybeJson(deps, args.json, result);
  if (!args.json) deps.logger.info(`Pattern library: ${action}`);
  return { exitCode: 0 };
}

export const patternLibraryCommand = defineCommand({
  meta: { name: 'pattern-library', description: 'Reusable pattern library' },
  args: {
    action: { type: 'positional', required: false, description: 'list | get' },
    arg: { type: 'positional', required: false, description: 'pattern id (get)' },
    json: { type: 'boolean', required: false, description: 'JSON output' },
  },
  run({ args }) {
    const r = patternLibraryImpl(createRealDeps(), {
      action: args.action,
      arg: args.arg,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'pattern-library failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// persona-packs (bin/cli.js ~4774)
// ─────────────────────────────────────────────────────────────────────────

export interface PersonaPacksArgs {
  action?: string;
  arg?: string;
  json?: boolean;
}

export function personaPacksImpl(deps: Deps, args: PersonaPacksArgs): CommandResult {
  const lib = legacyRequire<LegacyLib>('persona-packs');
  const action = args.action ?? 'list';
  let result: unknown;
  if (action === 'apply') {
    if (!args.arg) {
      deps.logger.error('Usage: jumpstart-mode persona-packs apply <pack-id>');
      return { exitCode: 1 };
    }
    result = lib.applyPack?.(args.arg, deps.projectRoot);
  } else {
    result = lib.listPacks?.() ?? { packs: [], total: 0 };
  }
  maybeJson(deps, args.json, result);
  if (!args.json) deps.logger.info(`Persona packs: ${action}`);
  return { exitCode: 0 };
}

export const personaPacksCommand = defineCommand({
  meta: { name: 'persona-packs', description: 'Persona pack registry' },
  args: {
    action: { type: 'positional', required: false, description: 'list | apply' },
    arg: { type: 'positional', required: false, description: 'pack id (apply)' },
    json: { type: 'boolean', required: false, description: 'JSON output' },
  },
  run({ args }) {
    const r = personaPacksImpl(createRealDeps(), {
      action: args.action,
      arg: args.arg,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'persona-packs failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// platform-engineering (bin/cli.js ~4944)
// ─────────────────────────────────────────────────────────────────────────

export interface PlatformEngineeringArgs {
  action?: string;
  arg?: string;
  json?: boolean;
}

export function platformEngineeringImpl(deps: Deps, args: PlatformEngineeringArgs): CommandResult {
  const lib = legacyRequire<LegacyLib>('platform-engineering');
  const action = args.action ?? 'status';
  let result: unknown;
  if (action === 'scaffold') {
    result = lib.scaffold?.(deps.projectRoot, args.arg) ?? lib.getStatus?.();
  } else {
    result = lib.getStatus?.() ?? { templates: [] };
  }
  maybeJson(deps, args.json, result);
  if (!args.json) deps.logger.info(`Platform engineering: ${action}`);
  return { exitCode: 0 };
}

export const platformEngineeringCommand = defineCommand({
  meta: { name: 'platform-engineering', description: 'Internal developer platform' },
  args: {
    action: { type: 'positional', required: false, description: 'status | scaffold' },
    arg: { type: 'positional', required: false, description: 'template name (scaffold)' },
    json: { type: 'boolean', required: false, description: 'JSON output' },
  },
  run({ args }) {
    const r = platformEngineeringImpl(createRealDeps(), {
      action: args.action,
      arg: args.arg,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'platform-engineering failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// pr-package (bin/cli.js ~2658)
// ─────────────────────────────────────────────────────────────────────────

export interface PrPackageArgs {
  action?: string;
  arg?: string;
  json?: boolean;
}

export function prPackageImpl(deps: Deps, args: PrPackageArgs): CommandResult {
  const lib = legacyRequire<LegacyLib>('pr-package');
  const action = args.action ?? 'generate';
  let result: unknown;
  if (action === 'generate') {
    result = lib.generatePrPackage?.(deps.projectRoot, { branch: args.arg });
  } else {
    result = lib.getStatus?.(deps.projectRoot) ?? {};
  }
  maybeJson(deps, args.json, result);
  if (!args.json) deps.logger.info(`PR package: ${action}`);
  return { exitCode: 0 };
}

export const prPackageCommand = defineCommand({
  meta: { name: 'pr-package', description: 'Pull-request review package generator' },
  args: {
    action: { type: 'positional', required: false, description: 'generate | status' },
    arg: { type: 'positional', required: false, description: 'branch name' },
    json: { type: 'boolean', required: false, description: 'JSON output' },
  },
  run({ args }) {
    const r = prPackageImpl(createRealDeps(), {
      action: args.action,
      arg: args.arg,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'pr-package failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// promptless-mode (bin/cli.js ~4694)
// ─────────────────────────────────────────────────────────────────────────

export interface PromptlessModeArgs {
  action?: string;
  json?: boolean;
}

export function promptlessModeImpl(deps: Deps, args: PromptlessModeArgs): CommandResult {
  const lib = legacyRequire<LegacyLib>('promptless-mode');
  const action = args.action ?? 'status';
  let result: unknown;
  if (action === 'enable') {
    result = lib.enable?.(deps.projectRoot);
  } else if (action === 'disable') {
    result = lib.disable?.(deps.projectRoot);
  } else {
    result = lib.getStatus?.(deps.projectRoot) ?? { enabled: false };
  }
  maybeJson(deps, args.json, result);
  if (!args.json) deps.logger.info(`Promptless mode: ${action}`);
  return { exitCode: 0 };
}

export const promptlessModeCommand = defineCommand({
  meta: { name: 'promptless-mode', description: 'Toggle promptless agent mode' },
  args: {
    action: { type: 'positional', required: false, description: 'status | enable | disable' },
    json: { type: 'boolean', required: false, description: 'JSON output' },
  },
  run({ args }) {
    const r = promptlessModeImpl(createRealDeps(), {
      action: args.action,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'promptless-mode failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// reference-arch (bin/cli.js ~3104)
// ─────────────────────────────────────────────────────────────────────────

export interface ReferenceArchArgs {
  action?: string;
  arg?: string;
  category?: string;
  json?: boolean;
}

export function referenceArchImpl(deps: Deps, args: ReferenceArchArgs): CommandResult {
  const lib = legacyRequire<LegacyLib>('reference-architectures');
  const action = args.action ?? 'list';
  let result: unknown;
  if (action === 'get') {
    if (!args.arg) {
      deps.logger.error('Usage: jumpstart-mode reference-arch get <pattern-id>');
      return { exitCode: 1 };
    }
    result = lib.getPattern(args.arg);
  } else if (action === 'register') {
    if (!args.arg) {
      deps.logger.error('Usage: jumpstart-mode reference-arch register <name>');
      return { exitCode: 1 };
    }
    result = lib.registerPattern({
      name: args.arg,
      category: args.category ?? 'other',
      description: `Custom pattern: ${args.arg}`,
    });
  } else if (action === 'instantiate') {
    if (!args.arg) {
      deps.logger.error('Usage: jumpstart-mode reference-arch instantiate <pattern-id>');
      return { exitCode: 1 };
    }
    result = lib.instantiatePattern(args.arg, deps.projectRoot);
  } else {
    result = lib.listPatterns();
  }
  maybeJson(deps, args.json, result);
  if (!args.json) deps.logger.info(`Reference arch: ${action}`);
  return { exitCode: 0 };
}

export const referenceArchCommand = defineCommand({
  meta: { name: 'reference-arch', description: 'Reference architecture patterns' },
  args: {
    action: {
      type: 'positional',
      required: false,
      description: 'list | get | register | instantiate',
    },
    arg: { type: 'positional', required: false, description: 'pattern id or name' },
    category: { type: 'positional', required: false, description: 'category (register only)' },
    json: { type: 'boolean', required: false, description: 'JSON output' },
  },
  run({ args }) {
    const r = referenceArchImpl(createRealDeps(), {
      action: args.action,
      arg: args.arg,
      category: args.category,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'reference-arch failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// release-readiness (bin/cli.js ~3450)
// ─────────────────────────────────────────────────────────────────────────

export interface ReleaseReadinessArgs {
  action?: string;
  arg?: string;
  json?: boolean;
}

export function releaseReadinessImpl(deps: Deps, args: ReleaseReadinessArgs): CommandResult {
  const lib = legacyRequire<LegacyLib>('release-readiness');
  const action = args.action ?? 'check';
  const stateFile = safeJoin(deps, '.jumpstart', 'state', 'release-readiness.json');
  let result: unknown;
  if (action === 'check') {
    result = lib.checkReadiness?.(deps.projectRoot, { stateFile });
  } else {
    result =
      lib.getStatus?.({ stateFile }) ?? lib.checkReadiness?.(deps.projectRoot, { stateFile });
  }
  maybeJson(deps, args.json, result);
  if (!args.json) deps.logger.info(`Release readiness: ${action}`);
  return { exitCode: 0 };
}

export const releaseReadinessCommand = defineCommand({
  meta: { name: 'release-readiness', description: 'Release readiness checklist' },
  args: {
    action: { type: 'positional', required: false, description: 'check | status' },
    arg: { type: 'positional', required: false, description: 'optional argument' },
    json: { type: 'boolean', required: false, description: 'JSON output' },
  },
  run({ args }) {
    const r = releaseReadinessImpl(createRealDeps(), {
      action: args.action,
      arg: args.arg,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'release-readiness failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// codebase-retrieval (bin/cli.js ~3829)
// ─────────────────────────────────────────────────────────────────────────

export interface CodebaseRetrievalArgs {
  action?: string;
  query?: string;
  json?: boolean;
}

export function codebaseRetrievalImpl(deps: Deps, args: CodebaseRetrievalArgs): CommandResult {
  const lib = legacyRequire<LegacyLib>('codebase-retrieval');
  const action = args.action ?? 'index';
  let result: unknown;
  if (action === 'search') {
    if (!args.query) {
      deps.logger.error('Usage: jumpstart-mode codebase-retrieval search <query>');
      return { exitCode: 1 };
    }
    result =
      lib.search?.(deps.projectRoot, args.query) ??
      lib.searchCodebase?.(deps.projectRoot, args.query);
  } else {
    result = lib.indexCodebase?.(deps.projectRoot) ?? lib.index?.(deps.projectRoot);
  }
  maybeJson(deps, args.json, result);
  if (!args.json) deps.logger.info(`Codebase retrieval: ${action}`);
  return { exitCode: 0 };
}

export const codebaseRetrievalCommand = defineCommand({
  meta: { name: 'codebase-retrieval', description: 'Codebase semantic retrieval' },
  args: {
    action: { type: 'positional', required: false, description: 'index | search' },
    query: { type: 'positional', required: false, description: 'query string' },
    json: { type: 'boolean', required: false, description: 'JSON output' },
  },
  run({ args }) {
    const r = codebaseRetrievalImpl(createRealDeps(), {
      action: args.action,
      query: args.query,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'codebase-retrieval failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// contract-first (bin/cli.js ~3919)
// ─────────────────────────────────────────────────────────────────────────

export interface ContractFirstArgs {
  action?: string;
  arg?: string;
  json?: boolean;
}

export function contractFirstImpl(deps: Deps, args: ContractFirstArgs): CommandResult {
  const lib = legacyRequire<LegacyLib>('contract-first');
  const action = args.action ?? 'check';
  let result: unknown;
  if (action === 'generate') {
    result = lib.generateContracts?.(deps.projectRoot);
  } else {
    result = lib.checkContracts?.(deps.projectRoot) ?? lib.check?.(deps.projectRoot);
  }
  maybeJson(deps, args.json, result);
  if (!args.json) deps.logger.info(`Contract-first: ${action}`);
  return { exitCode: 0 };
}

export const contractFirstCommand = defineCommand({
  meta: { name: 'contract-first', description: 'Contract-first development checks' },
  args: {
    action: { type: 'positional', required: false, description: 'check | generate' },
    arg: { type: 'positional', required: false, description: 'optional argument' },
    json: { type: 'boolean', required: false, description: 'JSON output' },
  },
  run({ args }) {
    const r = contractFirstImpl(createRealDeps(), {
      action: args.action,
      arg: args.arg,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'contract-first failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// deterministic (bin/cli.js ~4138)
// ─────────────────────────────────────────────────────────────────────────

export interface DeterministicArgs {
  action?: string;
  arg?: string;
  json?: boolean;
}

export function deterministicImpl(deps: Deps, args: DeterministicArgs): CommandResult {
  const lib = legacyRequire<LegacyLib>('deterministic-artifacts');
  const action = args.action ?? 'verify';
  let result: unknown;
  if (action === 'verify') {
    result = lib.verifyDeterminism?.(deps.projectRoot) ?? lib.verify?.(deps.projectRoot);
  } else if (action === 'snapshot') {
    result = lib.snapshot?.(deps.projectRoot);
  } else {
    result = lib.getStatus?.(deps.projectRoot) ?? {};
  }
  maybeJson(deps, args.json, result);
  if (!args.json) deps.logger.info(`Deterministic: ${action}`);
  return { exitCode: 0 };
}

export const deterministicCommand = defineCommand({
  meta: { name: 'deterministic', description: 'Deterministic artifact verification' },
  args: {
    action: { type: 'positional', required: false, description: 'verify | snapshot | status' },
    arg: { type: 'positional', required: false, description: 'optional argument' },
    json: { type: 'boolean', required: false, description: 'JSON output' },
  },
  run({ args }) {
    const r = deterministicImpl(createRealDeps(), {
      action: args.action,
      arg: args.arg,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'deterministic failed');
  },
});
