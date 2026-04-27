/**
 * dashboard.ts — interactive progress dashboard port (T4.3.3, cluster H).
 *
 * Pure-library port of `bin/lib/dashboard.js`. Public surface preserved
 * verbatim by name + signature:
 *
 *   - `PHASES` (constant array)
 *   - `STATUS_ICONS` (constant map)
 *   - `findClarifications(specsDir)` => Clarification[]
 *   - `getArtifactQualityScore(filePath)` => number | null
 *   - `gatherDashboardData(options?)` => Promise<DashboardData>
 *   - `renderDashboardText(data)` => string
 *   - `renderDashboardJSON(data)` => DashboardData
 *
 * Behavior parity:
 *   - Default project type: `greenfield`. Detected from
 *     `.jumpstart/config.yaml` (`type: <value>` line).
 *   - Scout phase (`brownfieldOnly: true`) skipped for greenfield.
 *   - Approved iff `isArtifactApproved(content)` returns true.
 *   - Quality score derived from `spec-tester.runAllChecks(content).score`.
 *   - Pipeline icons + colors verbatim from legacy.
 *   - Pipeline progress percentage rounded to whole number.
 *
 * Cross-module deps:
 *   - `loadState` from `state-store.ts` (TS sibling, T4.3.2).
 *   - `getTimelineSummary` from `timeline.ts` (TS sibling, this task).
 *   - `summarizeUsage` from `usage.ts` (TS sibling, T4.3.1).
 *   - `buildFromSpecs` / `getCoverage` from `graph.ts` (TS sibling).
 *   - JS-only siblings (`handoff.js`, `next-phase.js`,
 *     `spec-tester.js`, `coverage.js`) are loaded via lazy `require`
 *     because they have not yet ported to TS. The legacy modules
 *     remain authoritative until those ports land in subsequent
 *     T4.3.x clusters.
 *
 * @see bin/lib/dashboard.js (legacy reference)
 * @see specs/implementation-plan.md T4.3.3
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildFromSpecs, getCoverage } from './graph.js';
import { loadState } from './state-store.js';
import { getTimelineSummary } from './timeline.js';
import { summarizeUsage } from './usage.js';

// Sibling JS modules (handoff, next-phase, spec-tester, coverage) are
// loaded via lazy `require()` — they remain CJS/ESM JS until subsequent
// T4.3.x clusters port them. The dynamic `require` symbol is provided
// by `@types/node` and resolved at runtime against tsdown's emit format
// (parity with `llm-provider.ts`'s lazy-load pattern for `openai`).

// Public types

export interface PhaseDef {
  phase: number;
  name: string;
  artifact: string | null;
  brownfieldOnly?: boolean;
}

export interface PhaseStatusEntry {
  phase: number;
  name: string;
  artifact: string | null;
  status: 'approved' | 'in-progress' | 'pending' | 'skipped';
  approved: boolean;
  quality_score: number | null;
}

export interface ProgressSummary {
  completed: number;
  total: number;
  pct: number;
}

export interface QualityScoreEntry {
  phase: number;
  name: string;
  score: number;
}

export interface QualitySummary {
  avg_score: number | null;
  lowest_phase: { phase: number; name: string; score: number } | null;
  scores: QualityScoreEntry[];
}

export interface Clarification {
  file: string;
  line: number;
  text: string;
}

export interface CoverageSummary {
  story_pct: number;
  total_stories: number;
  total_tasks: number;
  uncovered: unknown[];
  gaps: number;
}

export interface UsageSummaryShape {
  total_tokens: number;
  total_cost: number;
  by_phase: Record<string, unknown>;
}

export interface NextActionShape {
  action: string;
  command: string;
  message: string;
}

export interface TimelineSummaryShape {
  session_id: string | null;
  total_events: number;
  duration_s: number | null;
  by_type: Record<string, number>;
  by_phase: Record<string, number>;
}

export interface DashboardData {
  phases: PhaseStatusEntry[];
  current: {
    phase: number | string | null;
    agent: string | null;
    step: string | null;
  };
  progress: ProgressSummary;
  quality: QualitySummary;
  clarifications: Clarification[];
  coverage: CoverageSummary | null;
  graph_coverage: unknown | null;
  usage: UsageSummaryShape | null;
  next_action: NextActionShape;
  project_type: string;
  timeline: TimelineSummaryShape | null;
}

export interface GatherDashboardOptions {
  root?: string;
}

// Constants (verbatim from legacy)

/** Ordered phase definitions for the pipeline display. */
export const PHASES: PhaseDef[] = [
  { phase: -1, name: 'Scout', artifact: 'specs/codebase-context.md', brownfieldOnly: true },
  { phase: 0, name: 'Challenger', artifact: 'specs/challenger-brief.md' },
  { phase: 1, name: 'Analyst', artifact: 'specs/product-brief.md' },
  { phase: 2, name: 'PM', artifact: 'specs/prd.md' },
  { phase: 3, name: 'Architect', artifact: 'specs/architecture.md' },
  { phase: 4, name: 'Developer', artifact: null },
];

/** Status icons for the pipeline visualization. */
export const STATUS_ICONS: Record<string, string> = {
  approved: '✓',
  'in-progress': '●',
  pending: '○',
  skipped: '–',
};

// Internal helpers — sibling loaders. Each lazy-loaded so the dashboard
// stays usable in environments where one sibling is missing/broken.

interface HandoffModule {
  isArtifactApproved(content: string): boolean;
}

interface NextPhaseModule {
  determineNextAction(options: { root: string }): NextActionShape;
}

interface SpecTesterModule {
  runAllChecks(content: string): { score: number };
}

function loadHandoffSibling(): HandoffModule | null {
  try {
    return require('../lib/handoff.js') as HandoffModule;
  } catch {
    return null;
  }
}

function loadNextPhaseSibling(): NextPhaseModule | null {
  try {
    return require('../lib/next-phase.js') as NextPhaseModule;
  } catch {
    return null;
  }
}

function loadSpecTesterSibling(): SpecTesterModule | null {
  try {
    return require('../lib/spec-tester.js') as SpecTesterModule;
  } catch {
    return null;
  }
}

interface CoverageModule {
  computeCoverage(
    prdPath: string,
    planPath: string
  ): {
    coverage_pct: number;
    total_stories: number;
    total_tasks: number;
    uncovered?: unknown[];
  };
}

function loadCoverageSibling(): CoverageModule | null {
  try {
    return require('../lib/coverage.js') as CoverageModule;
  } catch {
    return null;
  }
}

// Data Gathering

/** Scan specs/ for [NEEDS CLARIFICATION] tags. */
export function findClarifications(specsDir: string): Clarification[] {
  const results: Clarification[] = [];
  if (!existsSync(specsDir)) return results;

  const TAG_RE = /\[NEEDS CLARIFICATION[:\s]*([^\]]*)\]/gi;

  const files = readdirSync(specsDir).filter((f) => f.endsWith('.md'));
  for (const file of files) {
    const filePath = join(specsDir, file);
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const match of lines[i].matchAll(TAG_RE)) {
        results.push({
          file: `specs/${file}`,
          line: i + 1,
          text: (match[1] ?? '').trim() || match[0],
        });
      }
    }
  }
  return results;
}

/** Compute a quality score for a single artifact file. Returns null if
 *  file missing/empty or the spec-tester sibling is unavailable. */
export function getArtifactQualityScore(filePath: string): number | null {
  if (!existsSync(filePath)) return null;
  try {
    const content = readFileSync(filePath, 'utf8');
    if (!content.trim()) return null;
    const specTester = loadSpecTesterSibling();
    if (!specTester) return null;
    const result = specTester.runAllChecks(content);
    return result.score;
  } catch {
    return null;
  }
}

/** Compute story coverage if PRD and implementation plan exist. */
function getCoverageData(root: string): CoverageSummary | null {
  const prdPath = join(root, 'specs', 'prd.md');
  const planPath = join(root, 'specs', 'implementation-plan.md');
  if (!existsSync(prdPath) || !existsSync(planPath)) return null;
  try {
    const coverage = loadCoverageSibling();
    if (!coverage) return null;
    const data = coverage.computeCoverage(prdPath, planPath);
    return {
      story_pct: data.coverage_pct,
      total_stories: data.total_stories,
      total_tasks: data.total_tasks,
      uncovered: data.uncovered || [],
      gaps: (data.uncovered || []).length,
    };
  } catch {
    return null;
  }
}

/** Get dependency graph coverage if the graph can be built. */
function getGraphCoverage(root: string): unknown | null {
  const specsDir = join(root, 'specs');
  try {
    const graph = buildFromSpecs(specsDir);
    return getCoverage(graph);
  } catch {
    return null;
  }
}

/** Load usage summary if usage-log.json exists. */
function getUsageSummary(root: string): UsageSummaryShape | null {
  const logPath = join(root, '.jumpstart', 'usage-log.json');
  if (!existsSync(logPath)) return null;
  try {
    const summary = summarizeUsage(logPath);
    return {
      total_tokens: summary.total_tokens,
      total_cost: summary.total_cost_usd,
      by_phase: summary.by_phase || {},
    };
  } catch {
    return null;
  }
}

/** Gather all dashboard data from the project. */
export async function gatherDashboardData(
  options: GatherDashboardOptions = {}
): Promise<DashboardData> {
  const root = resolve(options.root || '.');
  const specsDir = join(root, 'specs');
  const statePath = join(root, '.jumpstart', 'state', 'state.json');
  const configPath = join(root, '.jumpstart', 'config.yaml');

  const state = loadState(statePath);
  const currentPhase = state.current_phase;
  const currentAgent = state.current_agent;

  // Detect project type from config
  let projectType = 'greenfield';
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf8');
      const typeMatch = raw.match(/^\s*type:\s*(\S+)/m);
      if (typeMatch) projectType = typeMatch[1];
    } catch {
      /* default greenfield */
    }
  }

  const handoff = loadHandoffSibling();
  const nextPhase = loadNextPhaseSibling();

  // Build phase status list
  const phases: PhaseStatusEntry[] = [];
  let completedCount = 0;
  let totalPhases = 0;
  const qualityScores: QualityScoreEntry[] = [];

  for (const phaseDef of PHASES) {
    if (phaseDef.brownfieldOnly && projectType !== 'brownfield') continue;

    totalPhases++;
    const artifactPath = phaseDef.artifact ? join(root, phaseDef.artifact) : null;

    let status: PhaseStatusEntry['status'] = 'pending';
    let approved = false;
    let qualityScore: number | null = null;

    if (artifactPath && existsSync(artifactPath)) {
      const content = readFileSync(artifactPath, 'utf8');
      approved = handoff ? handoff.isArtifactApproved(content) : false;
      status = approved ? 'approved' : 'in-progress';
      if (approved) completedCount++;
      qualityScore = getArtifactQualityScore(artifactPath);
      if (qualityScore !== null) {
        qualityScores.push({ phase: phaseDef.phase, name: phaseDef.name, score: qualityScore });
      }
    } else if (phaseDef.phase === 4 && currentPhase === 4) {
      status = 'in-progress';
    } else if (phaseDef.phase === currentPhase) {
      status = 'in-progress';
    }

    phases.push({
      phase: phaseDef.phase,
      name: phaseDef.name,
      artifact: phaseDef.artifact,
      status,
      approved,
      quality_score: qualityScore,
    });
  }

  // Progress summary
  const progress: ProgressSummary = {
    completed: completedCount,
    total: totalPhases,
    pct: totalPhases > 0 ? Math.round((completedCount / totalPhases) * 100) : 0,
  };

  // Quality summary
  const avgScore =
    qualityScores.length > 0
      ? Math.round(qualityScores.reduce((sum, q) => sum + q.score, 0) / qualityScores.length)
      : null;
  const lowestPhase =
    qualityScores.length > 0
      ? qualityScores.reduce((min, q) => (q.score < min.score ? q : min), qualityScores[0])
      : null;

  const quality: QualitySummary = {
    avg_score: avgScore,
    lowest_phase: lowestPhase
      ? { phase: lowestPhase.phase, name: lowestPhase.name, score: lowestPhase.score }
      : null,
    scores: qualityScores,
  };

  const clarifications = findClarifications(specsDir);
  const coverageData = getCoverageData(root);
  const usage = getUsageSummary(root);

  const nextAction: NextActionShape = nextPhase
    ? nextPhase.determineNextAction({ root })
    : { action: 'unknown', command: '', message: 'Next-phase resolver unavailable.' };

  const graphCoverage = getGraphCoverage(root);

  // Timeline summary (TS sibling)
  let timelineSummary: TimelineSummaryShape | null = null;
  try {
    const timelinePath = join(root, '.jumpstart', 'state', 'timeline.json');
    if (existsSync(timelinePath)) {
      const summary = getTimelineSummary(timelinePath);
      timelineSummary = {
        session_id: summary.session_id ?? null,
        total_events: summary.total_events,
        duration_s:
          summary.duration_s ??
          (summary.duration_ms !== null ? Math.round(summary.duration_ms / 1000) : null),
        by_type: summary.by_type,
        by_phase: summary.by_phase,
      };
    }
  } catch {
    /* timeline module not available or no data */
  }

  return {
    phases,
    current: {
      phase: currentPhase,
      agent: currentAgent,
      step: state.current_step || null,
    },
    progress,
    quality,
    clarifications,
    coverage: coverageData,
    graph_coverage: graphCoverage,
    usage,
    next_action: nextAction,
    project_type: projectType,
    timeline: timelineSummary,
  };
}

// Rendering

interface ChalkLike {
  bold: { blue: (s: string) => string; white: (s: string) => string; green: (s: string) => string };
  green: (s: string) => string;
  yellow: (s: string) => string;
  red: (s: string) => string;
  gray: (s: string) => string;
  cyan: (s: string) => string;
  white: (s: string) => string;
}

let _chalkCache: ChalkLike | null = null;

function loadChalk(): ChalkLike {
  if (_chalkCache) return _chalkCache;
  try {
    _chalkCache = require('chalk') as ChalkLike;
    return _chalkCache;
  } catch {
    // Fallback no-op chalk so the renderer never throws on missing
    // dependency. ANSI codes are dropped and the text is returned raw.
    const passthrough = (s: string): string => s;
    const fallback: ChalkLike = {
      bold: { blue: passthrough, white: passthrough, green: passthrough },
      green: passthrough,
      yellow: passthrough,
      red: passthrough,
      gray: passthrough,
      cyan: passthrough,
      white: passthrough,
    };
    _chalkCache = fallback;
    return fallback;
  }
}

/** Render the pipeline visualization bar. */
function renderPipeline(phases: PhaseStatusEntry[]): string {
  const chalk = loadChalk();
  const segments = phases.map((p) => {
    const icon = STATUS_ICONS[p.status] || '?';
    const label = `${icon} ${p.name}`;
    switch (p.status) {
      case 'approved':
        return chalk.green(`[${label}]`);
      case 'in-progress':
        return chalk.yellow(`[${label}]`);
      case 'skipped':
        return chalk.gray(`[${label}]`);
      default:
        return chalk.gray(`[${label}]`);
    }
  });
  return segments.join(chalk.gray(' → '));
}

/** Render a horizontal bar chart segment. */
function renderBar(pct: number, width = 20): string {
  const chalk = loadChalk();
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  if (pct >= 80) return chalk.green(bar);
  if (pct >= 50) return chalk.yellow(bar);
  return chalk.red(bar);
}

/** Render dashboard data as colorized terminal text. */
export function renderDashboardText(data: DashboardData): string {
  const chalk = loadChalk();
  const lines: string[] = [];

  // Header
  lines.push('');
  lines.push(chalk.bold.blue('╔══════════════════════════════════════════════════════════════╗'));
  lines.push(
    chalk.bold.blue('║') +
      chalk.bold.white('           JumpStart Progress Dashboard                     ') +
      chalk.bold.blue('║')
  );
  lines.push(chalk.bold.blue('╚══════════════════════════════════════════════════════════════╝'));
  lines.push('');

  // Pipeline
  lines.push(chalk.bold.white('  Pipeline:'));
  lines.push(`  ${renderPipeline(data.phases)}`);
  lines.push('');

  // Progress bar
  lines.push(
    `${chalk.bold.white('  Progress: ')}${renderBar(data.progress.pct)}${chalk.gray(
      ` ${data.progress.completed}/${data.progress.total} phases (${data.progress.pct}%)`
    )}`
  );
  lines.push('');

  // Current status
  if (data.current.phase !== null && data.current.phase !== undefined) {
    const phaseInfo = data.phases.find((p) => p.phase === data.current.phase);
    lines.push(
      `${chalk.bold.white('  Current: ')}${chalk.cyan(
        `Phase ${data.current.phase} — ${phaseInfo ? phaseInfo.name : 'Unknown'}`
      )}${data.current.agent ? chalk.gray(` (${data.current.agent})`) : ''}`
    );
  } else {
    lines.push(`${chalk.bold.white('  Current: ')}${chalk.gray('No phase started')}`);
  }
  lines.push('');

  // Quality Scores
  if (data.quality.scores.length > 0) {
    lines.push(chalk.bold.white('  Quality Scores:'));
    for (const q of data.quality.scores) {
      const scoreColor = q.score >= 80 ? chalk.green : q.score >= 60 ? chalk.yellow : chalk.red;
      lines.push(`    Phase ${q.phase} (${q.name}): ${scoreColor(`${q.score}/100`)}`);
    }
    if (data.quality.avg_score !== null) {
      lines.push(chalk.gray(`    Average: ${data.quality.avg_score}/100`));
    }
    lines.push('');
  }

  // Coverage
  if (data.coverage) {
    const covColor =
      data.coverage.story_pct >= 80
        ? chalk.green
        : data.coverage.story_pct >= 50
          ? chalk.yellow
          : chalk.red;
    lines.push(
      `${chalk.bold.white('  Story Coverage: ')}${covColor(`${data.coverage.story_pct}%`)}${chalk.gray(
        ` (${data.coverage.total_stories} stories, ${data.coverage.total_tasks} tasks)`
      )}`
    );
    if (data.coverage.gaps > 0) {
      lines.push(chalk.yellow(`    ⚠ ${data.coverage.gaps} uncovered stories`));
    }
    lines.push('');
  }

  // Open Clarifications
  if (data.clarifications.length > 0) {
    lines.push(chalk.bold.white(`  Open Clarifications (${data.clarifications.length}):`));
    const shown = data.clarifications.slice(0, 5);
    for (const c of shown) {
      lines.push(chalk.yellow(`    ▸ ${c.file}:${c.line} — ${c.text}`));
    }
    if (data.clarifications.length > 5) {
      lines.push(chalk.gray(`    ... and ${data.clarifications.length - 5} more`));
    }
    lines.push('');
  }

  // Usage
  if (data.usage) {
    lines.push(
      `${chalk.bold.white('  Token Usage: ')}${chalk.gray(
        `${data.usage.total_tokens.toLocaleString()} tokens`
      )}${data.usage.total_cost ? chalk.gray(` ($${data.usage.total_cost.toFixed(2)})`) : ''}`
    );
    lines.push('');
  }

  // Timeline
  if (data.timeline && data.timeline.total_events > 0) {
    lines.push(
      `${chalk.bold.white('  Timeline: ')}${chalk.gray(`${data.timeline.total_events} events`)}${
        data.timeline.duration_s ? chalk.gray(` over ${Math.round(data.timeline.duration_s)}s`) : ''
      }`
    );
    if (data.timeline.by_phase && Object.keys(data.timeline.by_phase).length > 0) {
      const phaseEntries = Object.entries(data.timeline.by_phase).slice(0, 5);
      for (const [p, c] of phaseEntries) {
        lines.push(chalk.gray(`    ${p}: ${c} events`));
      }
    }
    lines.push('');
  }

  // Next Action
  lines.push(
    `${chalk.bold.green('  ▶ Next: ')}${chalk.white(data.next_action.command)}${chalk.gray(
      ` — ${data.next_action.message}`
    )}`
  );
  lines.push('');

  return lines.join('\n');
}

/** Render dashboard data as plain JSON (machine-readable). */
export function renderDashboardJSON(data: DashboardData): DashboardData {
  return data;
}
