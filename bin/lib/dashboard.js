/**
 * dashboard.js — Interactive Progress Dashboard (UX Feature 5)
 *
 * Aggregates state, artifact approval, quality scores, usage data,
 * coverage, traceability, and open clarifications into a single
 * dashboard view. Renders as colorized terminal text or JSON.
 *
 * Usage:
 *   echo '{}' | node bin/lib/dashboard.js
 *   echo '{"root":"."}' | node bin/lib/dashboard.js
 *
 * Output (stdout JSON):
 *   { "ok": true, "phases": [...], "current": {...}, "progress": {...}, ... }
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const fs = require('fs');
const path = require('path');

// ─── Sibling imports (ESM) ───────────────────────────────────────────────────
import { loadState } from './state-store.js';
import { getHandoff, isArtifactApproved } from './handoff.js';
import { determineNextAction } from './next-phase.js';

// ─── CJS sibling imports ─────────────────────────────────────────────────────
const specTester = require('./spec-tester');
const coverage = require('./coverage');
const graphMod = require('./graph');

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Ordered phase definitions for the pipeline display.
 */
const PHASES = [
  { phase: -1, name: 'Scout',      artifact: 'specs/codebase-context.md', brownfieldOnly: true },
  { phase: 0,  name: 'Challenger', artifact: 'specs/challenger-brief.md' },
  { phase: 1,  name: 'Analyst',    artifact: 'specs/product-brief.md' },
  { phase: 2,  name: 'PM',         artifact: 'specs/prd.md' },
  { phase: 3,  name: 'Architect',  artifact: 'specs/architecture.md' },
  { phase: 4,  name: 'Developer',  artifact: null }
];

/**
 * Status icons for the pipeline visualization.
 */
const STATUS_ICONS = {
  approved: '✓',
  'in-progress': '●',
  pending: '○',
  skipped: '–'
};

// ─── Data Gathering ──────────────────────────────────────────────────────────

/**
 * Scan specs/ for [NEEDS CLARIFICATION] tags.
 *
 * @param {string} specsDir - Path to specs directory.
 * @returns {Array<{file: string, line: number, text: string}>}
 */
function findClarifications(specsDir) {
  const results = [];
  if (!fs.existsSync(specsDir)) return results;

  const TAG_RE = /\[NEEDS CLARIFICATION[:\s]*([^\]]*)\]/gi;

  const files = fs.readdirSync(specsDir).filter(f => f.endsWith('.md'));
  for (const file of files) {
    const filePath = path.join(specsDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      let match;
      TAG_RE.lastIndex = 0;
      while ((match = TAG_RE.exec(lines[i])) !== null) {
        results.push({
          file: `specs/${file}`,
          line: i + 1,
          text: match[1].trim() || match[0]
        });
      }
    }
  }
  return results;
}

/**
 * Compute a quality score for a single artifact file.
 * Returns null if file doesn't exist or is empty.
 *
 * @param {string} filePath - Absolute path to artifact.
 * @returns {number|null} Score 0–100 or null.
 */
function getArtifactQualityScore(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.trim()) return null;
    const result = specTester.runAllChecks(content);
    return result.score;
  } catch {
    return null;
  }
}

/**
 * Load usage summary if usage-log.json exists.
 *
 * @param {string} root - Project root.
 * @returns {object|null} Usage summary or null.
 */
async function getUsageSummary(root) {
  const logPath = path.join(root, '.jumpstart', 'usage-log.json');
  if (!fs.existsSync(logPath)) return null;
  try {
    const { summarizeUsage } = await import('./usage.js');
    return summarizeUsage(logPath);
  } catch {
    return null;
  }
}

/**
 * Compute story coverage if PRD and implementation plan exist.
 *
 * @param {string} root - Project root.
 * @returns {object|null} Coverage result or null.
 */
function getCoverageData(root) {
  const prdPath = path.join(root, 'specs', 'prd.md');
  const planPath = path.join(root, 'specs', 'implementation-plan.md');
  if (!fs.existsSync(prdPath) || !fs.existsSync(planPath)) return null;
  try {
    return coverage.computeCoverage(prdPath, planPath);
  } catch {
    return null;
  }
}

/**
 * Get dependency graph coverage if the graph can be built.
 *
 * @param {string} root - Project root.
 * @returns {object|null} Graph coverage or null.
 */
function getGraphCoverage(root) {
  const specsDir = path.join(root, 'specs');
  try {
    const graph = graphMod.buildFromSpecs(specsDir);
    return graphMod.getCoverage(graph);
  } catch {
    return null;
  }
}

/**
 * Gather all dashboard data from the project.
 *
 * @param {object} [options] - Options.
 * @param {string} [options.root] - Project root directory.
 * @returns {Promise<object>} Dashboard data object.
 */
export async function gatherDashboardData(options = {}) {
  const root = path.resolve(options.root || '.');
  const specsDir = path.join(root, 'specs');
  const statePath = path.join(root, '.jumpstart', 'state', 'state.json');
  const configPath = path.join(root, '.jumpstart', 'config.yaml');

  // ─── Load state ─────────────────────────────────────────────────────────
  const state = loadState(statePath);
  const currentPhase = state.current_phase;
  const currentAgent = state.current_agent;

  // ─── Detect project type from config ────────────────────────────────────
  let projectType = 'greenfield';
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      const typeMatch = raw.match(/^\s*type:\s*(\S+)/m);
      if (typeMatch) projectType = typeMatch[1];
    } catch { /* default greenfield */ }
  }

  // ─── Build phase status list ────────────────────────────────────────────
  const phases = [];
  let completedCount = 0;
  let totalPhases = 0;
  const qualityScores = [];

  for (const phaseDef of PHASES) {
    // Skip Scout for greenfield projects
    if (phaseDef.brownfieldOnly && projectType !== 'brownfield') continue;

    totalPhases++;
    const artifactPath = phaseDef.artifact
      ? path.join(root, phaseDef.artifact)
      : null;

    let status = 'pending';
    let approved = false;
    let qualityScore = null;

    if (artifactPath && fs.existsSync(artifactPath)) {
      const content = fs.readFileSync(artifactPath, 'utf8');
      approved = isArtifactApproved(content);
      status = approved ? 'approved' : 'in-progress';
      if (approved) completedCount++;
      qualityScore = getArtifactQualityScore(artifactPath);
      if (qualityScore !== null) qualityScores.push({ phase: phaseDef.phase, name: phaseDef.name, score: qualityScore });
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
      quality_score: qualityScore
    });
  }

  // ─── Progress summary ──────────────────────────────────────────────────
  const progress = {
    completed: completedCount,
    total: totalPhases,
    pct: totalPhases > 0 ? Math.round((completedCount / totalPhases) * 100) : 0
  };

  // ─── Quality summary ──────────────────────────────────────────────────
  const avgScore = qualityScores.length > 0
    ? Math.round(qualityScores.reduce((sum, q) => sum + q.score, 0) / qualityScores.length)
    : null;
  const lowestPhase = qualityScores.length > 0
    ? qualityScores.reduce((min, q) => q.score < min.score ? q : min, qualityScores[0])
    : null;

  const quality = {
    avg_score: avgScore,
    lowest_phase: lowestPhase ? { phase: lowestPhase.phase, name: lowestPhase.name, score: lowestPhase.score } : null,
    scores: qualityScores
  };

  // ─── Clarifications ───────────────────────────────────────────────────
  const clarifications = findClarifications(specsDir);

  // ─── Coverage ─────────────────────────────────────────────────────────
  const coverageData = getCoverageData(root);

  // ─── Usage ────────────────────────────────────────────────────────────
  const usage = await getUsageSummary(root);

  // ─── Next action ──────────────────────────────────────────────────────
  const nextAction = determineNextAction({ root });

  // ─── Graph coverage ───────────────────────────────────────────────────
  const graphCoverage = getGraphCoverage(root);

  return {
    phases,
    current: {
      phase: currentPhase,
      agent: currentAgent,
      step: state.current_step || null
    },
    progress,
    quality,
    clarifications,
    coverage: coverageData ? {
      story_pct: coverageData.coverage_pct,
      total_stories: coverageData.total_stories,
      total_tasks: coverageData.total_tasks,
      uncovered: coverageData.uncovered || [],
      gaps: (coverageData.uncovered || []).length
    } : null,
    graph_coverage: graphCoverage,
    usage: usage ? {
      total_tokens: usage.total_tokens,
      total_cost: usage.total_cost_usd,
      by_phase: usage.by_phase || {}
    } : null,
    next_action: {
      action: nextAction.action,
      command: nextAction.command,
      message: nextAction.message
    },
    project_type: projectType
  };
}

// ─── Rendering ───────────────────────────────────────────────────────────────

/**
 * Render the pipeline visualization bar.
 *
 * @param {Array} phases - Phase data from gatherDashboardData.
 * @returns {string} Colorized pipeline string.
 */
function renderPipeline(phases) {
  const chalk = require('chalk');
  const segments = phases.map(p => {
    const icon = STATUS_ICONS[p.status] || '?';
    const label = `${icon} ${p.name}`;
    switch (p.status) {
      case 'approved': return chalk.green(`[${label}]`);
      case 'in-progress': return chalk.yellow(`[${label}]`);
      case 'skipped': return chalk.gray(`[${label}]`);
      default: return chalk.gray(`[${label}]`);
    }
  });
  return segments.join(chalk.gray(' → '));
}

/**
 * Render a horizontal bar chart segment.
 *
 * @param {number} pct - Percentage 0–100.
 * @param {number} width - Bar width in characters.
 * @returns {string} Bar string.
 */
function renderBar(pct, width = 20) {
  const chalk = require('chalk');
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  if (pct >= 80) return chalk.green(bar);
  if (pct >= 50) return chalk.yellow(bar);
  return chalk.red(bar);
}

/**
 * Render dashboard data as colorized terminal text.
 *
 * @param {object} data - Dashboard data from gatherDashboardData.
 * @returns {string} Formatted text output.
 */
export function renderDashboardText(data) {
  const chalk = require('chalk');
  const lines = [];

  // ─── Header ─────────────────────────────────────────────────────────
  lines.push('');
  lines.push(chalk.bold.blue('╔══════════════════════════════════════════════════════════════╗'));
  lines.push(chalk.bold.blue('║') + chalk.bold.white('           JumpStart Progress Dashboard                     ') + chalk.bold.blue('║'));
  lines.push(chalk.bold.blue('╚══════════════════════════════════════════════════════════════╝'));
  lines.push('');

  // ─── Pipeline ───────────────────────────────────────────────────────
  lines.push(chalk.bold('  Pipeline:'));
  lines.push('  ' + renderPipeline(data.phases));
  lines.push('');

  // ─── Progress bar ──────────────────────────────────────────────────
  lines.push(chalk.bold('  Progress: ') + renderBar(data.progress.pct) + chalk.gray(` ${data.progress.completed}/${data.progress.total} phases (${data.progress.pct}%)`));
  lines.push('');

  // ─── Current status ────────────────────────────────────────────────
  if (data.current.phase !== null && data.current.phase !== undefined) {
    const phaseInfo = data.phases.find(p => p.phase === data.current.phase);
    lines.push(chalk.bold('  Current: ') + chalk.cyan(`Phase ${data.current.phase} — ${phaseInfo ? phaseInfo.name : 'Unknown'}`) +
      (data.current.agent ? chalk.gray(` (${data.current.agent})`) : ''));
  } else {
    lines.push(chalk.bold('  Current: ') + chalk.gray('No phase started'));
  }
  lines.push('');

  // ─── Quality Scores ────────────────────────────────────────────────
  if (data.quality.scores.length > 0) {
    lines.push(chalk.bold('  Quality Scores:'));
    for (const q of data.quality.scores) {
      const scoreColor = q.score >= 80 ? chalk.green : q.score >= 60 ? chalk.yellow : chalk.red;
      lines.push(`    Phase ${q.phase} (${q.name}): ` + scoreColor(`${q.score}/100`));
    }
    if (data.quality.avg_score !== null) {
      lines.push(chalk.gray(`    Average: ${data.quality.avg_score}/100`));
    }
    lines.push('');
  }

  // ─── Coverage ──────────────────────────────────────────────────────
  if (data.coverage) {
    const covColor = data.coverage.story_pct >= 80 ? chalk.green : data.coverage.story_pct >= 50 ? chalk.yellow : chalk.red;
    lines.push(chalk.bold('  Story Coverage: ') + covColor(`${data.coverage.story_pct}%`) +
      chalk.gray(` (${data.coverage.total_stories} stories, ${data.coverage.total_tasks} tasks)`));
    if (data.coverage.gaps > 0) {
      lines.push(chalk.yellow(`    ⚠ ${data.coverage.gaps} uncovered stories`));
    }
    lines.push('');
  }

  // ─── Open Clarifications ───────────────────────────────────────────
  if (data.clarifications.length > 0) {
    lines.push(chalk.bold.yellow(`  Open Clarifications (${data.clarifications.length}):`));
    const shown = data.clarifications.slice(0, 5);
    for (const c of shown) {
      lines.push(chalk.yellow(`    ▸ ${c.file}:${c.line} — ${c.text}`));
    }
    if (data.clarifications.length > 5) {
      lines.push(chalk.gray(`    ... and ${data.clarifications.length - 5} more`));
    }
    lines.push('');
  }

  // ─── Usage ─────────────────────────────────────────────────────────
  if (data.usage) {
    lines.push(chalk.bold('  Token Usage: ') + chalk.gray(`${data.usage.total_tokens.toLocaleString()} tokens`) +
      (data.usage.total_cost ? chalk.gray(` ($${data.usage.total_cost.toFixed(2)})`) : ''));
    lines.push('');
  }

  // ─── Next Action ───────────────────────────────────────────────────
  lines.push(chalk.bold.green('  ▶ Next: ') + chalk.white(data.next_action.command) + chalk.gray(` — ${data.next_action.message}`));
  lines.push('');

  return lines.join('\n');
}

/**
 * Render dashboard data as plain JSON (machine-readable).
 *
 * @param {object} data - Dashboard data from gatherDashboardData.
 * @returns {object} Raw data object.
 */
export function renderDashboardJSON(data) {
  return data;
}

// ─── Exported helpers for testing ────────────────────────────────────────────
export { findClarifications, getArtifactQualityScore, PHASES, STATUS_ICONS };

// ─── CLI Entry Point ─────────────────────────────────────────────────────────

const cliFile = process.argv[1] || '';
if (cliFile.endsWith('dashboard.js') || cliFile.endsWith('dashboard')) {
  const io = require('./io');

  if (process.stdin.isTTY) {
    gatherDashboardData({}).then(data => {
      console.log(renderDashboardText(data));
    }).catch(err => {
      io.writeError('DASHBOARD_ERROR', err.message);
      process.exit(2);
    });
  } else {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { input += chunk; });
    process.stdin.on('end', async () => {
      try {
        const parsed = input.trim() ? JSON.parse(input) : {};
        const data = await gatherDashboardData(parsed);
        io.writeResult(data);
      } catch (err) {
        io.writeError('DASHBOARD_ERROR', err.message);
        process.exit(2);
      }
    });
  }
}
