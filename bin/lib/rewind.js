/**
 * rewind.js — Phase Rewind with Cascade (UX Feature 2)
 *
 * Rewinds the project to a target phase by archiving all downstream
 * artifacts, resetting state, and reporting what gets invalidated.
 *
 * Usage:
 *   npx jumpstart-mode rewind 1
 *
 * CLI entry:
 *   echo '{"target_phase":1}' | node bin/lib/rewind.js
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { copyFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } = require('fs');
const { join, dirname, basename, extname } = require('path');

import { archiveFilename } from './revert.js';
import { isArtifactApproved, getHandoff } from './handoff.js';
import { loadState, saveState } from './state-store.js';
import { now } from './timestamps.js';

/**
 * Ordered list of all phases from Scout (-1) through Developer (4).
 */
export const PHASE_ORDER = [-1, 0, 1, 2, 3, 4];

/**
 * Phase metadata — maps phase number to name and primary + secondary artifacts.
 */
export const PHASE_ARTIFACTS = {
  '-1': {
    name: 'Scout',
    primary: ['specs/codebase-context.md'],
    secondary: ['specs/insights/codebase-context-insights.md']
  },
  '0': {
    name: 'Challenger',
    primary: ['specs/challenger-brief.md'],
    secondary: ['specs/insights/challenger-brief-insights.md']
  },
  '1': {
    name: 'Analyst',
    primary: ['specs/product-brief.md'],
    secondary: ['specs/insights/product-brief-insights.md']
  },
  '2': {
    name: 'PM',
    primary: ['specs/prd.md'],
    secondary: ['specs/insights/prd-insights.md']
  },
  '3': {
    name: 'Architect',
    primary: ['specs/architecture.md', 'specs/implementation-plan.md'],
    secondary: ['specs/insights/architecture-insights.md']
  },
  '4': {
    name: 'Developer',
    primary: [],
    secondary: ['specs/insights/implementation-insights.md']
  }
};

/**
 * Get all phases downstream of (i.e. strictly after) the target phase.
 * @param {number} targetPhase - The phase to rewind to
 * @returns {number[]} Array of downstream phase numbers
 */
export function getDownstreamPhases(targetPhase) {
  return PHASE_ORDER.filter(p => p > targetPhase);
}

/**
 * Get all artifact paths (primary + secondary) for a given phase.
 * @param {number} phase - Phase number
 * @returns {string[]} Array of relative artifact paths
 */
export function getPhaseArtifacts(phase) {
  const info = PHASE_ARTIFACTS[String(phase)];
  if (!info) return [];
  return [...info.primary, ...info.secondary];
}

/**
 * Archive a list of artifacts, skipping those that don't exist.
 * @param {string[]} artifacts - Relative paths to artifacts
 * @param {string} reason - Reason for archiving
 * @param {object} [options]
 * @param {string} [options.root] - Project root directory
 * @param {string} [options.archiveDir] - Archive directory path
 * @returns {{ archived: Array<{original: string, archived_to: string}>, skipped: string[] }}
 */
export function archiveArtifacts(artifacts, reason, options = {}) {
  const root = options.root || process.cwd();
  const archiveDir = options.archiveDir || join(root, '.jumpstart', 'archive');
  const archived = [];
  const skipped = [];

  if (!existsSync(archiveDir)) {
    mkdirSync(archiveDir, { recursive: true });
  }

  for (const relPath of artifacts) {
    const fullPath = join(root, relPath);
    if (!existsSync(fullPath)) {
      skipped.push(relPath);
      continue;
    }

    const archiveName = archiveFilename(fullPath);
    const archivePath = join(archiveDir, archiveName);
    copyFileSync(fullPath, archivePath);

    // Write companion metadata
    const metaPath = archivePath + '.meta.json';
    const metadata = {
      original_path: relPath,
      archived_at: now(),
      reason,
      archived_to: archivePath,
      operation: 'rewind'
    };
    writeFileSync(metaPath, JSON.stringify(metadata, null, 2) + '\n', 'utf8');

    archived.push({ original: relPath, archived_to: archivePath });
  }

  return { archived, skipped };
}

/**
 * Rewind the project to the target phase, archiving all downstream artifacts
 * and resetting workflow state.
 *
 * @param {number} targetPhase - Phase number to rewind to (-1 through 4)
 * @param {object} [options]
 * @param {string} [options.root] - Project root
 * @param {string} [options.statePath] - Custom state file path
 * @param {string} [options.archiveDir] - Custom archive directory
 * @param {string} [options.reason] - Reason for rewinding
 * @returns {{ success: boolean, rewound_to: number, phase_name: string, archived: object[], invalidated_phases: object[], state_changes: object, error?: string }}
 */
export function rewindToPhase(targetPhase, options = {}) {
  const phase = Number(targetPhase);

  // Validate phase number
  if (!PHASE_ORDER.includes(phase)) {
    return {
      success: false,
      error: `Invalid phase: ${targetPhase}. Valid phases: ${PHASE_ORDER.join(', ')}`
    };
  }

  const phaseInfo = PHASE_ARTIFACTS[String(phase)];
  const root = options.root || process.cwd();
  const statePath = options.statePath || join(root, '.jumpstart', 'state', 'state.json');
  const reason = options.reason || `Rewound to Phase ${phase} (${phaseInfo.name})`;

  // Find downstream phases
  const downstream = getDownstreamPhases(phase);
  if (downstream.length === 0) {
    return {
      success: true,
      rewound_to: phase,
      phase_name: phaseInfo.name,
      archived: [],
      invalidated_phases: [],
      state_changes: { message: 'No downstream phases to invalidate' }
    };
  }

  // Collect all downstream artifacts
  const allArtifacts = [];
  const invalidatedPhases = [];
  for (const dp of downstream) {
    const dpInfo = PHASE_ARTIFACTS[String(dp)];
    const artifacts = getPhaseArtifacts(dp);
    allArtifacts.push(...artifacts);
    invalidatedPhases.push({ phase: dp, name: dpInfo.name, artifacts });
  }

  // Archive downstream artifacts
  const archiveResult = archiveArtifacts(allArtifacts, reason, {
    root,
    archiveDir: options.archiveDir
  });

  // Reset state
  const state = loadState(statePath);
  const oldPhase = state.current_phase;
  const oldApproved = [...(state.approved_artifacts || [])];

  // Remove downstream artifacts from approved list
  const downstreamArtifactSet = new Set(allArtifacts);
  state.approved_artifacts = (state.approved_artifacts || []).filter(
    a => !downstreamArtifactSet.has(a)
  );

  // Filter phase_history to remove downstream entries
  state.phase_history = (state.phase_history || []).filter(
    h => !downstream.includes(h.phase)
  );

  // Reset current phase
  state.current_phase = phase;
  state.current_agent = phaseInfo.name.toLowerCase();
  state.current_step = null;
  state.last_completed_step = null;

  // Update resume context
  state.resume_context = {
    tldr: `Rewound to Phase ${phase} (${phaseInfo.name}). ${archiveResult.archived.length} artifacts archived.`,
    last_action: `Phase rewind to ${phaseInfo.name}`,
    next_action: `Continue from Phase ${phase}`,
    open_questions: [],
    key_insights: [`Rewind reason: ${reason}`],
    last_agent: 'rewind',
    last_phase: phase,
    last_step: null,
    timestamp: now()
  };

  saveState(state, statePath);

  return {
    success: true,
    rewound_to: phase,
    phase_name: phaseInfo.name,
    archived: archiveResult.archived,
    skipped: archiveResult.skipped,
    invalidated_phases: invalidatedPhases,
    state_changes: {
      previous_phase: oldPhase,
      new_phase: phase,
      removed_approvals: oldApproved.filter(a => downstreamArtifactSet.has(a)),
      removed_history_entries: downstream.length
    }
  };
}

/**
 * Render a human-readable rewind report.
 * @param {object} result - Result from rewindToPhase
 * @returns {string}
 */
export function renderRewindReport(result) {
  if (!result.success) {
    return `\n  ❌ Rewind failed: ${result.error}\n`;
  }

  const lines = [];
  lines.push('');
  lines.push(`  ⏪ Rewound to Phase ${result.rewound_to} — ${result.phase_name}`);
  lines.push('');

  if (result.archived.length > 0) {
    lines.push('  Archived artifacts:');
    for (const a of result.archived) {
      lines.push(`    📦 ${a.original}`);
    }
    lines.push('');
  }

  if (result.skipped && result.skipped.length > 0) {
    lines.push('  Skipped (not found):');
    for (const s of result.skipped) {
      lines.push(`    ⊘ ${s}`);
    }
    lines.push('');
  }

  if (result.invalidated_phases.length > 0) {
    lines.push('  Invalidated phases:');
    for (const p of result.invalidated_phases) {
      lines.push(`    ✖ Phase ${p.phase} — ${p.name}`);
    }
    lines.push('');
  }

  const sc = result.state_changes;
  lines.push('  State changes:');
  lines.push(`    Phase: ${sc.previous_phase ?? 'null'} → ${sc.new_phase}`);
  if (sc.removed_approvals && sc.removed_approvals.length > 0) {
    lines.push(`    Removed ${sc.removed_approvals.length} approval(s)`);
  }
  lines.push('');

  return lines.join('\n');
}

// CLI mode
if (process.argv[1] && process.argv[1].endsWith('rewind.js')) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const data = JSON.parse(input || '{}');
      if (data.target_phase === undefined) {
        process.stderr.write(JSON.stringify({ error: 'Missing required field: target_phase' }) + '\n');
        process.exit(1);
      }
      const result = rewindToPhase(data.target_phase, {
        root: data.root || process.cwd(),
        reason: data.reason
      });
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } catch (err) {
      process.stderr.write(JSON.stringify({ error: err.message }) + '\n');
      process.exit(1);
    }
  });
}
