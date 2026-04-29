/**
 * spec-quality.ts — Spec-quality cluster (T4.7.2 batch 5).
 *
 * Ports the following bin/cli.js subcommands into citty `defineCommand`s:
 *   - ambiguity-heatmap     (lib-ts: scanFile + generateHeatmap)
 *   - complexity            (lib-ts: calculateComplexity)
 *   - context-chunker       (lib-ts: chunkImplementationPlan)
 *   - crossref              (lib-ts: validateCrossRefs)
 *   - ast-edit              (lib-ts: analyzeStructure)
 *   - dashboard             (lib-ts: gatherDashboardData + renderDashboardText)
 *   - ceremony              (lib-ts: getProfileSummary + getProfileDescription
 *                              + compareProfiles + VALID_PROFILES)
 *   - refactor-planner      (lib-ts: generateReport)
 *   - quality-graph         (lib-ts: scanQuality)
 *   - bidirectional-trace   (lib-ts: scanTraceLinks + buildCoverageReport)
 *   - domain-ontology       (lib-ts: defineElement + queryOntology + generateReport)
 *   - event-modeling        (legacy bin/lib/event-modeling.js — NO lib-ts port,
 *                              loaded via legacyRequire)
 *
 * Pattern: each leaf command is a `defineCommand` exported as
 * `<name>Command`. Pure logic lives in `<name>Impl(deps, args)`. All
 * lib-ts imports are TOP-LEVEL ES imports per lifecycle.ts canonical
 * pattern. Only `event-modeling` (no TS port) goes through legacyRequire.
 *
 * @see bin/cli.js (lines 1771-1813, 1927-1939, 2405-2438, 3856-3887,
 *       4077-4093, 4237-4254, 4538-4562, 4870-4895, 4920-4941,
 *       5174-5210 — legacy reference)
 * @see specs/implementation-plan.md T4.7.2
 */

import { defineCommand } from 'citty';
import * as ambiguityLib from '../../../bin/lib-ts/ambiguity-heatmap.js';
import { analyzeStructure } from '../../../bin/lib-ts/ast-edit-engine.js';
import { buildCoverageReport, scanTraceLinks } from '../../../bin/lib-ts/bidirectional-trace.js';
import {
  compareProfiles,
  getProfileDescription,
  getProfileSummary,
  VALID_PROFILES,
} from '../../../bin/lib-ts/ceremony.js';
import { calculateComplexity } from '../../../bin/lib-ts/complexity.js';
import { chunkImplementationPlan } from '../../../bin/lib-ts/context-chunker.js';
import { validateCrossRefs } from '../../../bin/lib-ts/crossref.js';
import { gatherDashboardData, renderDashboardText } from '../../../bin/lib-ts/dashboard.js';
import * as ontologyLib from '../../../bin/lib-ts/domain-ontology.js';
import { writeResult } from '../../../bin/lib-ts/io.js';
import {
  generateReport as qualityGraphReport,
  scanQuality,
} from '../../../bin/lib-ts/quality-graph.js';
import { generateReport as refactorReport } from '../../../bin/lib-ts/refactor-planner.js';
import { type CommandResult, createRealDeps, type Deps } from '../deps.js';
import { assertUserPath, legacyRequire, safeJoin } from './_helpers.js';

// ─────────────────────────────────────────────────────────────────────────
// ambiguity-heatmap
// ─────────────────────────────────────────────────────────────────────────

export interface AmbiguityHeatmapArgs {
  action?: string;
  file?: string;
  json?: boolean;
}

export function ambiguityHeatmapImpl(deps: Deps, args: AmbiguityHeatmapArgs): CommandResult {
  const action = args.action ?? 'report';

  if (action === 'scan') {
    if (!args.file) {
      deps.logger.error('File path required for scan');
      return { exitCode: 1 };
    }
    const safeFile = assertUserPath(deps, args.file, 'ambiguity-heatmap:file');
    const result = ambiguityLib.scanFile(safeFile);
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success) {
      deps.logger.info(`Ambiguity Scan: ${result.total_findings} findings`);
      const m = result.metrics;
      if (m) {
        deps.logger.info(
          `  Vague terms: ${m.vague_terms}  Missing constraints: ${m.missing_constraints}  Density: ${m.ambiguity_density}%`
        );
      }
    } else {
      deps.logger.error(result.error ?? 'scan failed');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }

  // Default: report (heatmap across project root)
  const result = ambiguityLib.generateHeatmap(deps.projectRoot);
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info(`Ambiguity Heatmap: ${result.files_scanned} files`);
    deps.logger.info(`  Total findings: ${result.overall.total_findings}`);
  }
  return { exitCode: 0 };
}

export const ambiguityHeatmapCommand = defineCommand({
  meta: {
    name: 'ambiguity-heatmap',
    description: 'Requirement ambiguity heatmap (scan/report)',
  },
  args: {
    action: { type: 'positional', description: 'scan | report', required: false },
    file: { type: 'positional', description: 'File to scan (for scan action)', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = ambiguityHeatmapImpl(createRealDeps(), {
      action: args.action,
      file: args.file,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'ambiguity-heatmap failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// complexity
// ─────────────────────────────────────────────────────────────────────────

export interface ComplexityArgs {
  description?: string;
  json?: boolean;
}

export function complexityImpl(deps: Deps, args: ComplexityArgs): CommandResult {
  // ComplexityInput accepts description-only here; legacy `bin/cli.js` also
  // passed `root` but the lib-ts shape doesn't take it (root is read from
  // process.cwd internally).
  void deps.projectRoot;
  const result = calculateComplexity({
    description: args.description ?? '',
  });
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info('Complexity Assessment');
    deps.logger.info(`  Recommended depth: ${result.recommended_depth}`);
    deps.logger.info(`  Score: ${result.score}`);
    deps.logger.info(`  Reasoning: ${result.reasoning}`);
  }
  return { exitCode: 0 };
}

export const complexityCommand = defineCommand({
  meta: {
    name: 'complexity',
    description: 'Calculate adaptive planning depth (quick/standard/deep)',
  },
  args: {
    description: { type: 'positional', description: 'Optional description', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = complexityImpl(createRealDeps(), {
      description: args.description,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'complexity failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// context-chunker
// ─────────────────────────────────────────────────────────────────────────

export interface ContextChunkerArgs {
  json?: boolean;
}

export function contextChunkerImpl(deps: Deps, args: ContextChunkerArgs): CommandResult {
  const result = chunkImplementationPlan(deps.projectRoot);
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
    return { exitCode: 0 };
  }
  if (result.success) {
    deps.logger.info(
      `Context Chunking: ${result.total_sections} sections, ${result.total_tokens} tokens`
    );
    for (const r of result.model_recommendations) {
      const status = r.fits_in_single_call ? 'fits' : `needs ${r.chunks_needed} chunks`;
      deps.logger.info(`  ${r.model}: ${status}`);
    }
  } else {
    deps.logger.warn(result.error ?? 'chunking failed');
  }
  return { exitCode: 0 };
}

export const contextChunkerCommand = defineCommand({
  meta: {
    name: 'context-chunker',
    description: 'Implementation chunking by context window (chunk/estimate)',
  },
  args: {
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = contextChunkerImpl(createRealDeps(), { json: Boolean(args.json) });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'context-chunker failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// crossref
// ─────────────────────────────────────────────────────────────────────────

export interface CrossrefArgs {
  specsDir?: string;
  json?: boolean;
}

export function crossrefImpl(deps: Deps, args: CrossrefArgs): CommandResult {
  const specsDir = args.specsDir && !args.specsDir.startsWith('-') ? args.specsDir : 'specs';
  // specsDir is user-supplied — gate it.
  assertUserPath(deps, specsDir, 'crossref:specsDir');
  const result = validateCrossRefs(specsDir, deps.projectRoot);
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info('Cross-Reference Validation');
    deps.logger.info(
      `  Files scanned: ${result.files_scanned}  Total links: ${result.total_links}`
    );
    deps.logger.info(`  Valid: ${result.valid_links}  Broken: ${result.broken_links.length}`);
    deps.logger.info(`  Score: ${result.score}%  ${result.pass ? 'PASS' : 'FAIL'}`);
    if (result.broken_links.length > 0) {
      deps.logger.info('  Broken links:');
      for (const b of result.broken_links.slice(0, 10)) {
        deps.logger.info(`    ${b.source}:${b.line} → ${b.target}`);
      }
    }
  }
  return { exitCode: 0 };
}

export const crossrefCommand = defineCommand({
  meta: {
    name: 'crossref',
    description: 'Validate markdown cross-references and detect orphans',
  },
  args: {
    specsDir: {
      type: 'positional',
      description: 'Specs directory (default: specs)',
      required: false,
    },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = crossrefImpl(createRealDeps(), {
      specsDir: args.specsDir,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'crossref failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// ast-edit
// ─────────────────────────────────────────────────────────────────────────

export interface AstEditArgs {
  action?: string;
  file?: string;
  json?: boolean;
}

export function astEditImpl(deps: Deps, args: AstEditArgs): CommandResult {
  if (!args.file) {
    deps.logger.error('Usage: jumpstart-mode ast-edit analyze|validate <file>');
    return { exitCode: 1 };
  }
  const safeFile = assertUserPath(deps, args.file, 'ast-edit:file');
  const result = analyzeStructure(safeFile);
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else if (result.success) {
    deps.logger.info(`AST Analysis: ${result.file} (${result.language})`);
    deps.logger.info(`  Lines: ${result.total_lines}  Symbols: ${result.symbol_count}`);
    for (const s of result.symbols ?? []) {
      deps.logger.info(`  L${s.line}: ${s.type} ${s.name}`);
    }
  } else {
    deps.logger.error(result.error ?? 'analysis failed');
    return { exitCode: 1 };
  }
  return { exitCode: 0 };
}

export const astEditCommand = defineCommand({
  meta: { name: 'ast-edit', description: 'AST-aware edit engine (analyze/validate)' },
  args: {
    action: { type: 'positional', description: 'analyze | validate', required: false },
    file: { type: 'positional', description: 'File path', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = astEditImpl(createRealDeps(), {
      action: args.action,
      file: args.file,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'ast-edit failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// dashboard
// ─────────────────────────────────────────────────────────────────────────

export interface DashboardArgs {
  json?: boolean;
}

export async function dashboardImpl(deps: Deps, args: DashboardArgs): Promise<CommandResult> {
  const data = await gatherDashboardData({ root: deps.projectRoot });
  if (args.json) {
    writeResult(data as unknown as Record<string, unknown>);
  } else {
    deps.logger.info(renderDashboardText(data));
  }
  return { exitCode: 0 };
}

export const dashboardCommand = defineCommand({
  meta: { name: 'dashboard', description: 'Interactive progress dashboard' },
  args: {
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  async run({ args }) {
    const r = await dashboardImpl(createRealDeps(), { json: Boolean(args.json) });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'dashboard failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// ceremony
// ─────────────────────────────────────────────────────────────────────────

export interface CeremonyArgs {
  action?: string;
  arg?: string;
  arg2?: string;
}

export function ceremonyImpl(deps: Deps, args: CeremonyArgs): CommandResult {
  if (args.action === 'set') {
    const profile = args.arg;
    if (!profile || !VALID_PROFILES.includes(profile)) {
      deps.logger.error(`Usage: jumpstart-mode ceremony set <${VALID_PROFILES.join('|')}>`);
      return { exitCode: 1 };
    }
    const configPath = safeJoin(deps, '.jumpstart', 'config.yaml');
    if (!deps.fs.existsSync(configPath)) {
      deps.logger.error('Config file not found. Run jumpstart-mode init first.');
      return { exitCode: 1 };
    }
    let content = deps.fs.readFileSync(configPath, 'utf8');
    content = content.replace(/^(\s*profile:\s*)\S+/m, `$1${profile}`);
    deps.fs.writeFileSync(configPath, content, 'utf8');
    deps.logger.success(`Ceremony profile set to: ${profile}`);
    deps.logger.info(getProfileDescription(profile));
    return { exitCode: 0 };
  }

  if (args.action === 'compare') {
    const a = args.arg ?? 'light';
    const b = args.arg2 ?? 'rigorous';
    const diffs = compareProfiles(a, b);
    writeResult({ comparison: `${a} vs ${b}`, differences: diffs } as unknown as Record<
      string,
      unknown
    >);
    return { exitCode: 0 };
  }

  // Default: summary
  const summary = getProfileSummary();
  writeResult(summary as unknown as Record<string, unknown>);
  return { exitCode: 0 };
}

export const ceremonyCommand = defineCommand({
  meta: { name: 'ceremony', description: 'Ceremony profile management (UX Feature 3)' },
  args: {
    action: { type: 'positional', description: 'set | compare | summary', required: false },
    arg: {
      type: 'positional',
      description: 'Profile name (set) or first profile (compare)',
      required: false,
    },
    arg2: { type: 'positional', description: 'Second profile (compare)', required: false },
  },
  run({ args }) {
    const r = ceremonyImpl(createRealDeps(), {
      action: args.action,
      arg: args.arg,
      arg2: args.arg2,
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'ceremony failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// refactor-planner
// ─────────────────────────────────────────────────────────────────────────

export interface RefactorPlannerArgs {
  json?: boolean;
}

export function refactorPlannerImpl(deps: Deps, args: RefactorPlannerArgs): CommandResult {
  const stateFile = safeJoin(deps, '.jumpstart', 'state', 'refactor-plan.json');
  const result = refactorReport({ stateFile });
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info(
      `Refactor Planner: ${result.total_plans} plans, ${result.completed} completed`
    );
  }
  return { exitCode: 0 };
}

export const refactorPlannerCommand = defineCommand({
  meta: {
    name: 'refactor-planner',
    description: 'Refactor planner with dependency safety (plan/validate/report)',
  },
  args: {
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = refactorPlannerImpl(createRealDeps(), { json: Boolean(args.json) });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'refactor-planner failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// quality-graph
// ─────────────────────────────────────────────────────────────────────────

export interface QualityGraphArgs {
  json?: boolean;
}

export function qualityGraphImpl(deps: Deps, args: QualityGraphArgs): CommandResult {
  const result = scanQuality(deps.projectRoot);
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info(`Code Quality Graph: ${result.total_files} files`);
    deps.logger.info(`  Average score: ${result.summary.average_score}%`);
    deps.logger.info(
      `  Critical hotspots: ${result.summary.critical_hotspots}  High risk: ${result.summary.high_risk}`
    );
    if (result.hotspots.length > 0) {
      deps.logger.info('  Top hotspots:');
      for (const h of result.hotspots.slice(0, 5)) {
        deps.logger.info(
          `    ${h.file}: ${h.overall_score}% (${h.total_lines} lines, depth=${h.max_nesting_depth})`
        );
      }
    }
  }
  // Suppress unused-warning for the imported helper (kept for future expansion).
  void qualityGraphReport;
  return { exitCode: 0 };
}

export const qualityGraphCommand = defineCommand({
  meta: { name: 'quality-graph', description: 'Code quality smell graph (scan/report)' },
  args: {
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = qualityGraphImpl(createRealDeps(), { json: Boolean(args.json) });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'quality-graph failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// bidirectional-trace
// ─────────────────────────────────────────────────────────────────────────

export interface BidirectionalTraceArgs {
  action?: string;
  json?: boolean;
}

export function bidirectionalTraceImpl(deps: Deps, args: BidirectionalTraceArgs): CommandResult {
  const action = args.action ?? 'scan';
  if (action !== 'scan' && action !== 'report') {
    deps.logger.error('Usage: jumpstart-mode bidirectional-trace [scan|report] [--json]');
    return { exitCode: 1 };
  }
  const traceMap = scanTraceLinks(deps.projectRoot);
  if (action === 'report') {
    const report = buildCoverageReport(deps.projectRoot, traceMap);
    if (args.json) {
      writeResult(report as unknown as Record<string, unknown>);
    } else {
      deps.logger.info('Bidirectional Traceability Report');
      deps.logger.info(
        `  Spec IDs: ${report.total_spec_ids}  Covered: ${report.covered}  Gaps: ${report.gaps}  Coverage: ${report.coverage_pct}%`
      );
      if (report.gap_list.length > 0) {
        deps.logger.warn('  Unlinked spec IDs:');
        for (const id of report.gap_list) deps.logger.info(`    • ${id}`);
      }
    }
  } else {
    if (args.json) {
      writeResult(traceMap as unknown as Record<string, unknown>);
    } else {
      deps.logger.info('Trace Scan Complete');
      deps.logger.info(`  Spec IDs found: ${traceMap.stats.total_spec_ids}`);
      deps.logger.info(`  Files with links: ${traceMap.stats.total_files_with_links}`);
      deps.logger.info(`  Total links: ${traceMap.stats.total_links}`);
    }
  }
  return { exitCode: 0 };
}

export const bidirectionalTraceCommand = defineCommand({
  meta: {
    name: 'bidirectional-trace',
    description: 'Bidirectional code-to-spec traceability (scan/report)',
  },
  args: {
    action: { type: 'positional', description: 'scan | report', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = bidirectionalTraceImpl(createRealDeps(), {
      action: args.action,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'bidirectional-trace failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// domain-ontology
// ─────────────────────────────────────────────────────────────────────────

export interface DomainOntologyArgs {
  action?: string;
  domain?: string;
  name?: string;
  type?: string;
  json?: boolean;
}

export function domainOntologyImpl(deps: Deps, args: DomainOntologyArgs): CommandResult {
  const action = args.action ?? 'report';

  if (action === 'define') {
    const { domain, name, type } = args;
    if (!domain || !name || !type) {
      deps.logger.error('Usage: jumpstart-mode domain-ontology define <domain> <name> <type>');
      return { exitCode: 1 };
    }
    // ontologyLib.defineElement signature: (domainName, name, type, options?)
    const result = ontologyLib.defineElement(domain, name, type as ontologyLib.ElementType);
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success && result.element) {
      deps.logger.success(`Element ${result.element.id} defined: ${name} (${type})`);
    } else {
      deps.logger.error(result.error ?? 'define failed');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }

  if (action === 'query') {
    if (!args.domain) {
      deps.logger.error('Usage: jumpstart-mode domain-ontology query <domain>');
      return { exitCode: 1 };
    }
    const result = ontologyLib.queryOntology(args.domain);
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else {
      deps.logger.info(`Ontology: ${result.domain} (${result.total} elements)`);
    }
    return { exitCode: 0 };
  }

  // Default: report
  const result = ontologyLib.generateReport();
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info(`Domain Ontology Report: ${result.total_domains} domains`);
  }
  return { exitCode: 0 };
}

export const domainOntologyCommand = defineCommand({
  meta: {
    name: 'domain-ontology',
    description: 'Domain ontology support (define/query/validate/report)',
  },
  args: {
    action: { type: 'positional', description: 'define | query | report', required: false },
    domain: { type: 'positional', description: 'Domain name', required: false },
    name: { type: 'positional', description: 'Element name (for define)', required: false },
    type: { type: 'positional', description: 'Element type (for define)', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = domainOntologyImpl(createRealDeps(), {
      action: args.action,
      domain: args.domain,
      name: args.name,
      type: args.type,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'domain-ontology failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// event-modeling
// ─────────────────────────────────────────────────────────────────────────

export interface EventModelingArgs {
  action?: string;
  name?: string;
  type?: string;
  json?: boolean;
}

interface EventModelingLib {
  defineTopic: (name: string) => { success: boolean; topic?: { id: string }; error?: string };
  generateReport: () => {
    total_topics: number;
    total_events: number;
    total_sagas: number;
    [k: string]: unknown;
  };
}

export function eventModelingImpl(deps: Deps, args: EventModelingArgs): CommandResult {
  const lib = legacyRequire<EventModelingLib>('event-modeling');
  const action = args.action ?? 'report';

  if (action === 'define') {
    const name = args.name;
    const type = args.type ?? 'topic';
    if (!name) {
      deps.logger.error('Usage: jumpstart-mode event-modeling define <name> [type]');
      return { exitCode: 1 };
    }
    if (type === 'topic') {
      const result = lib.defineTopic(name);
      if (args.json) {
        writeResult(result as unknown as Record<string, unknown>);
      } else if (result.success && result.topic) {
        deps.logger.success(`Topic ${result.topic.id} defined: ${name}`);
      } else {
        deps.logger.error(result.error ?? 'define failed');
        return { exitCode: 1 };
      }
      return { exitCode: 0 };
    }
    deps.logger.error(`Unsupported type: ${type}`);
    return { exitCode: 1 };
  }

  // Default: report
  const result = lib.generateReport();
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info(
      `Event Model: ${result.total_topics} topics, ${result.total_events} events, ${result.total_sagas} sagas`
    );
  }
  return { exitCode: 0 };
}

export const eventModelingCommand = defineCommand({
  meta: {
    name: 'event-modeling',
    description: 'Event-driven architecture modeling (define/validate/report)',
  },
  args: {
    action: { type: 'positional', description: 'define | report', required: false },
    name: { type: 'positional', description: 'Topic name (for define)', required: false },
    type: {
      type: 'positional',
      description: 'Element type (default: topic)',
      required: false,
    },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = eventModelingImpl(createRealDeps(), {
      action: args.action,
      name: args.name,
      type: args.type,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'event-modeling failed');
  },
});
