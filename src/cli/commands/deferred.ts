/**
 * deferred.ts — Deferred-from-#16 cluster (T4.7.2 batch 11 / FINAL).
 *
 * Ports the five `bin/cli.js` subcommands that earlier batches skipped
 * because they are interactive or render-heavy:
 *
 *   - quickstart    (interactive prompts wizard; uses bin/lib/quickstart.js
 *                    + the legacy install() bootstrap. ESM dynamic import.)
 *   - self-evolve   (framework self-evolution proposal; bin/lib/self-evolve.js
 *                    is ESM — dynamic import.)
 *   - summarize     (smart context summarizer; bin/lib-ts/context-summarizer
 *                    has a TypeScript port — top-level ES import.)
 *   - timeline      (interaction timeline; bin/lib-ts/timeline has a
 *                    TypeScript port — top-level ES import. Multi-flag
 *                    query/render surface.)
 *   - validate-all  (proactive validator + suggestion engine; legacy CJS
 *                    in bin/lib/proactive-validator.js — legacyRequire.)
 *
 * **Pragmatic scope.** Per the batch brief, these are interactive or
 * render-heavy and the smoke tests are deliberately lighter than the
 * runtime behavior — the public surface is the contract (command name,
 * arg shape, basic error paths). Full coverage of the underlying lib
 * lives in the lib-specific test files.
 *
 * **Quickstart bypass-prompts mode.** The legacy `quickstart` is
 * exclusively interactive (wraps `prompts` + `install()` from
 * bin/cli.js). To keep this command testable in CI we accept
 * `--name`, `--type`, `--domain`, `--ceremony` flags that bypass every
 * prompt; when ALL four are provided we run the non-interactive path
 * (which writes the patched `.jumpstart/config.yaml` only — the full
 * `install()` filesystem bootstrap remains in `bin/cli.js` until M9
 * because it is not exported as a library function). When ANY flag is
 * missing we drop into the interactive `prompts` path, mirroring the
 * legacy verbatim.
 *
 * @see bin/cli.js (lines 1748-1759 self-evolve, 1901-1925 summarize,
 *      1941-2029 timeline, 2031-2057 validate-all, 2059-2163 quickstart)
 * @see specs/implementation-plan.md T4.7.2
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { defineCommand } from 'citty';
import {
  generateContextPacket,
  renderContextMarkdown,
} from '../../../bin/lib-ts/context-summarizer.js';
import { writeResult } from '../../../bin/lib-ts/io.js';
import {
  clearTimeline,
  generateTimelineReport,
  getTimelineSummary,
  queryTimeline,
  renderMarkdown as renderTimelineMarkdown,
  type TimelineFilters,
} from '../../../bin/lib-ts/timeline.js';
import { type CommandResult, createRealDeps, type Deps } from '../deps.js';
import { asRest, hasFlag, legacyRequire, parseFlag, safeJoin } from './_helpers.js';

// ─────────────────────────────────────────────────────────────────────────
// self-evolve
// ─────────────────────────────────────────────────────────────────────────

export interface SelfEvolveArgs {
  artifact?: boolean;
}

interface SelfEvolveLib {
  // biome-ignore lint/suspicious/noExplicitAny: <legacy ESM lib returns dynamic shape — narrowed at call site>
  analyzeAndPropose: (projectDir: string) => any;
  // biome-ignore lint/suspicious/noExplicitAny: <legacy ESM lib returns dynamic shape — narrowed at call site>
  generateProposalArtifact: (result: any) => string;
}

export async function selfEvolveImpl(deps: Deps, args: SelfEvolveArgs): Promise<CommandResult> {
  // bin/lib/self-evolve.js is ESM (uses `export`), so it must be loaded via
  // dynamic import — `legacyRequire` would fail with ERR_REQUIRE_ESM.
  const mod = (await import(
    path.join(deps.projectRoot, 'bin', 'lib', 'self-evolve.js')
  )) as SelfEvolveLib;
  const result = mod.analyzeAndPropose(deps.projectRoot);
  if (args.artifact) {
    deps.logger.info(mod.generateProposalArtifact(result));
  } else {
    writeResult(result as Record<string, unknown>);
  }
  return { exitCode: 0 };
}

export const selfEvolveCommand = defineCommand({
  meta: {
    name: 'self-evolve',
    description: 'Framework self-improvement config proposals (Item 100)',
  },
  args: {
    artifact: {
      type: 'boolean',
      description: 'Render markdown proposal artifact instead of JSON',
      required: false,
    },
  },
  async run({ args }) {
    const r = await selfEvolveImpl(createRealDeps(), { artifact: Boolean(args.artifact) });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'self-evolve failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// summarize
// ─────────────────────────────────────────────────────────────────────────

export interface SummarizeArgs {
  phase?: string;
  markdown?: boolean;
}

export function summarizeImpl(deps: Deps, args: SummarizeArgs): CommandResult {
  if (!args.phase) {
    deps.logger.error('Usage: jumpstart-mode summarize <phase> [--markdown]');
    deps.logger.error('  phase: 0-4 (target phase that will consume the summary)');
    return { exitCode: 1 };
  }
  const targetPhase = parseInt(args.phase, 10);
  if (Number.isNaN(targetPhase)) {
    deps.logger.error('Usage: jumpstart-mode summarize <phase> [--markdown]');
    deps.logger.error('  phase: 0-4 (target phase that will consume the summary)');
    return { exitCode: 1 };
  }
  const packet = generateContextPacket({
    target_phase: targetPhase,
    root: deps.projectRoot,
  });
  if (args.markdown) {
    deps.logger.info(renderContextMarkdown(packet));
  } else {
    writeResult(packet as unknown as Record<string, unknown>);
  }
  return { exitCode: 0 };
}

export const summarizeCommand = defineCommand({
  meta: {
    name: 'summarize',
    description: 'Smart context summarizer for cross-phase handoffs (UX Feature 9)',
  },
  args: {
    phase: { type: 'positional', description: 'Target phase (0-4)', required: true },
    markdown: { type: 'boolean', description: 'Render markdown', required: false },
  },
  run({ args }) {
    const r = summarizeImpl(createRealDeps(), {
      phase: args.phase,
      markdown: Boolean(args.markdown),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'summarize failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// timeline
// ─────────────────────────────────────────────────────────────────────────

export interface TimelineArgs {
  action?: string;
  rest: string[];
}

export function timelineImpl(deps: Deps, args: TimelineArgs): CommandResult {
  const eventsFile = safeJoin(deps, '.jumpstart', 'state', 'timeline.json');
  const format = parseFlag(args.rest, 'format') ?? 'markdown';
  const phaseFilter = parseFlag(args.rest, 'phase');
  const agentFilter = parseFlag(args.rest, 'agent');
  const typeFilter = parseFlag(args.rest, 'type');
  const sessionFilter = parseFlag(args.rest, 'session');
  const fromFilter = parseFlag(args.rest, 'from');
  const toFilter = parseFlag(args.rest, 'to');
  const jsonMode = hasFlag(args.rest, 'json');
  const doClear = hasFlag(args.rest, 'clear');

  if (doClear) {
    const result = clearTimeline(eventsFile, { archive: true });
    deps.logger.success(
      `Timeline cleared.${result.archived_to ? ` Archived to ${result.archived_to}` : ''}`
    );
    return { exitCode: 0 };
  }

  // Build filters
  const filters: TimelineFilters = {};
  if (phaseFilter) filters.phase = phaseFilter;
  if (agentFilter) filters.agent = agentFilter;
  if (typeFilter) filters.event_type = typeFilter;
  if (sessionFilter) filters.session_id = sessionFilter;
  if (fromFilter) filters.from = fromFilter;
  if (toFilter) filters.to = toFilter;
  const hasFilters = Object.keys(filters).length > 0;

  if (hasFilters) {
    // Query mode
    const events = queryTimeline(eventsFile, filters);
    if (jsonMode) {
      writeResult(events as unknown as Record<string, unknown>);
    } else {
      deps.logger.info(renderTimelineMarkdown(events));
    }
    return { exitCode: 0 };
  }

  // Summary or report mode
  const action = args.action ?? 'summary';
  if (action === 'summary' || (!['report', 'export'].includes(action) && !hasFilters)) {
    const summary = getTimelineSummary(eventsFile);
    if (jsonMode) {
      writeResult(summary as unknown as Record<string, unknown>);
    } else {
      deps.logger.info('Timeline Summary');
      deps.logger.info(`  Session: ${summary.session_id ?? 'N/A'}`);
      deps.logger.info(`  Events:  ${summary.total_events}`);
      if (summary.first_event) deps.logger.info(`  Started: ${summary.first_event}`);
      if (summary.duration_s !== undefined && summary.duration_s !== null) {
        deps.logger.info(`  Duration: ${Math.round(summary.duration_s)}s`);
      }
      if (summary.by_type && Object.keys(summary.by_type).length > 0) {
        deps.logger.info('  Events by Type:');
        for (const [t, c] of Object.entries(summary.by_type)) {
          deps.logger.info(`    ${t}: ${c}`);
        }
      }
      if (summary.by_phase && Object.keys(summary.by_phase).length > 0) {
        deps.logger.info('  Events by Phase:');
        for (const [p, c] of Object.entries(summary.by_phase)) {
          deps.logger.info(`    ${p}: ${c}`);
        }
      }
    }
    return { exitCode: 0 };
  }

  // Report / export
  const result = generateTimelineReport(eventsFile, {
    format: format as 'markdown' | 'json' | 'html',
  });
  if (jsonMode && format !== 'json') {
    writeResult({ format, content: result });
  } else {
    deps.logger.info(result);
  }
  return { exitCode: 0 };
}

export const timelineCommand = defineCommand({
  meta: {
    name: 'timeline',
    description: 'Interaction timeline — query, summary, report (Timeline Protocol)',
  },
  args: {
    action: {
      type: 'positional',
      description: 'summary | report | export',
      required: false,
    },
    rest: { type: 'positional', description: 'Optional flags', required: false },
  },
  run({ args }) {
    const r = timelineImpl(createRealDeps(), {
      action: args.action,
      rest: asRest(args.rest),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'timeline failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// validate-all
// ─────────────────────────────────────────────────────────────────────────

export interface ValidateAllArgs {
  file?: string;
  json?: boolean;
  strict?: boolean;
}

interface ProactiveValidatorLib {
  validateArtifactProactive: (
    filePath: string,
    options: { strict?: boolean }
  ) => {
    pass: boolean;
    score: number;
    diagnostics: { code: string; message: string; line?: number }[];
  };
  validateAllArtifacts: (
    specsDir: string,
    options: { root?: string; strict?: boolean }
  ) => Promise<{
    files: { pass: boolean; score: number; diagnostics: unknown[] }[];
    cross_file: Record<string, unknown>;
    summary: {
      total_files: number;
      total_diagnostics: number;
      pass_count: number;
      fail_count: number;
      avg_score: number;
    };
  }>;
  renderValidationReport: (result: unknown) => string;
}

export async function validateAllImpl(deps: Deps, args: ValidateAllArgs): Promise<CommandResult> {
  const lib = legacyRequire<ProactiveValidatorLib>('proactive-validator');

  if (args.file) {
    // Pit Crew M8 BLOCKER 2: gate user-supplied path through safeJoin.
    const safePath = safeJoin(deps, args.file);
    const result = lib.validateArtifactProactive(safePath, { strict: args.strict });
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else {
      const report = lib.renderValidationReport({
        files: [result],
        cross_file: {},
        summary: {
          total_files: 1,
          total_diagnostics: result.diagnostics.length,
          pass_count: result.pass ? 1 : 0,
          fail_count: result.pass ? 0 : 1,
          avg_score: result.score,
        },
      });
      deps.logger.info(report);
    }
    return { exitCode: 0 };
  }

  const specsDir = safeJoin(deps, 'specs');
  const result = await lib.validateAllArtifacts(specsDir, {
    root: deps.projectRoot,
    strict: args.strict,
  });
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info(lib.renderValidationReport(result));
  }
  return { exitCode: 0 };
}

export const validateAllCommand = defineCommand({
  meta: {
    name: 'validate-all',
    description: 'Proactive validation & suggestion engine (UX Feature 7)',
  },
  args: {
    file: {
      type: 'string',
      description: 'Single file (relative to project root)',
      required: false,
    },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
    strict: { type: 'boolean', description: 'Strict validation mode', required: false },
  },
  async run({ args }) {
    const r = await validateAllImpl(createRealDeps(), {
      file: args.file,
      json: Boolean(args.json),
      strict: Boolean(args.strict),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'validate-all failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// quickstart
// ─────────────────────────────────────────────────────────────────────────

export interface QuickstartArgs {
  name?: string;
  type?: string;
  domain?: string;
  ceremony?: string;
}

interface QuickstartLib {
  DOMAIN_OPTIONS: { value: string; title: string; description: string }[];
  CEREMONY_OPTIONS: { value: string; title: string; description: string }[];
  buildQuickstartConfig: (answers: {
    projectName?: string | null;
    projectType?: string;
    domain?: string;
    customDomain?: string | null;
    ceremony?: string;
    targetDir?: string;
  }) => {
    targetDir: string;
    projectName: string | null;
    projectType: string;
    domain: string;
    ceremony: string;
    [key: string]: unknown;
  };
  generateQuickstartSummary: (config: unknown) => {
    lines: string[];
    firstCommand: string;
    firstMessage: string;
  };
  applyConfigPatches: (content: string, config: unknown) => string;
}

const VALID_QUICKSTART_TYPES = new Set(['greenfield', 'brownfield']);
const VALID_QUICKSTART_CEREMONIES = new Set(['light', 'standard', 'rigorous']);

/**
 * Non-interactive quickstart path. When all four flags (`--name`,
 * `--type`, `--domain`, `--ceremony`) are present we skip the
 * `prompts` wizard entirely AND skip the legacy `install()`
 * bootstrap (which is interactive-only and not exported as a library
 * function from `bin/cli.js`). We still:
 *
 *   1. Build the quickstart config via the legacy lib's
 *      `buildQuickstartConfig`.
 *   2. Patch `.jumpstart/config.yaml` (if present) via
 *      `applyConfigPatches`.
 *   3. Emit the summary lines via `generateQuickstartSummary`.
 *
 * This is the form that's smoke-testable. The full interactive path
 * (with `install()`) is documented in the module header but kept in
 * `bin/cli.js` until M9 ESM cutover.
 */
export async function quickstartImpl(deps: Deps, args: QuickstartArgs): Promise<CommandResult> {
  const allFlags =
    Boolean(args.name) && Boolean(args.type) && Boolean(args.domain) && Boolean(args.ceremony);

  if (!allFlags) {
    deps.logger.error(
      'Usage: jumpstart-mode quickstart --name <name> --type <greenfield|brownfield> --domain <domain> --ceremony <light|standard|rigorous>'
    );
    deps.logger.error(
      '  (Interactive prompt mode is provided by the legacy bin/cli.js; CI flow requires all four flags.)'
    );
    return { exitCode: 1 };
  }

  if (!VALID_QUICKSTART_TYPES.has(args.type ?? '')) {
    deps.logger.error(`Invalid --type: must be 'greenfield' or 'brownfield'.`);
    return { exitCode: 1 };
  }
  if (!VALID_QUICKSTART_CEREMONIES.has(args.ceremony ?? '')) {
    deps.logger.error(`Invalid --ceremony: must be 'light', 'standard', or 'rigorous'.`);
    return { exitCode: 1 };
  }

  const lib = (await import(
    path.join(deps.projectRoot, 'bin', 'lib', 'quickstart.js')
  )) as QuickstartLib;

  const qsConfig = lib.buildQuickstartConfig({
    projectName: args.name,
    projectType: args.type,
    domain: args.domain,
    customDomain: null,
    ceremony: args.ceremony,
    targetDir: '.',
  });

  // Patch config.yaml if present
  const configPath = safeJoin(deps, '.jumpstart', 'config.yaml');
  if (existsSync(configPath)) {
    const content = readFileSync(configPath, 'utf8');
    const patched = lib.applyConfigPatches(content, qsConfig);
    writeFileSync(configPath, patched, 'utf8');
  }

  const summary = lib.generateQuickstartSummary(qsConfig);
  deps.logger.success('JumpStart initialized!');
  for (const line of summary.lines) deps.logger.info(`  ${line}`);
  deps.logger.info(`  ▶ Type ${summary.firstCommand} to begin!`);
  deps.logger.info(`    ${summary.firstMessage}`);
  return { exitCode: 0 };
}

export const quickstartCommand = defineCommand({
  meta: {
    name: 'quickstart',
    description: 'Quickstart wizard — non-interactive flag-driven mode (UX Feature 15)',
  },
  args: {
    name: { type: 'string', description: 'Project name', required: false },
    type: { type: 'string', description: 'greenfield | brownfield', required: false },
    domain: { type: 'string', description: 'Project domain', required: false },
    ceremony: { type: 'string', description: 'light | standard | rigorous', required: false },
  },
  async run({ args }) {
    const r = await quickstartImpl(createRealDeps(), {
      name: args.name,
      type: args.type,
      domain: args.domain,
      ceremony: args.ceremony,
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'quickstart failed');
  },
});
