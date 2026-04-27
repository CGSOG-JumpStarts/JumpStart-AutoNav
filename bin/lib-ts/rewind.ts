/**
 * rewind.ts — phase rewind with cascade port (T4.3.2).
 *
 * Pure-library port of `bin/lib/rewind.js`. Public surface preserved
 * verbatim by name + signature:
 *
 *   - `PHASE_ORDER` (constant)
 *   - `PHASE_ARTIFACTS` (constant catalog)
 *   - `getDownstreamPhases(targetPhase)` => number[]
 *   - `getPhaseArtifacts(phase)` => string[]
 *   - `archiveArtifacts(artifacts, reason, options?)` =>
 *     {archived, skipped}
 *   - `rewindToPhase(targetPhase, options?)` => RewindResult
 *   - `renderRewindReport(result)` => string
 *
 * **Inlined helpers**: legacy rewind.js imports `archiveFilename` from
 * `revert.js`. revert.js is not in the M4 cluster (it ports separately
 * later). To preserve the public surface here, we inline the
 * archiveFilename helper. When revert.ts ports, the inlined function
 * is replaced with an import — the resulting TS file flips imports
 * without breaking any consumer.
 *
 * @see bin/lib/rewind.js (legacy reference)
 * @see specs/implementation-plan.md T4.3.2
 */

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { loadState, saveState, type WorkflowState } from './state-store.js';
import { now } from './timestamps.js';

// Public types

export interface PhaseArtifactInfo {
  name: string;
  primary: string[];
  secondary: string[];
}

export interface ArchiveOptions {
  root?: string;
  archiveDir?: string;
}

export interface ArchivedEntry {
  original: string;
  archived_to: string;
}

export interface ArchiveResult {
  archived: ArchivedEntry[];
  skipped: string[];
}

export interface InvalidatedPhase {
  phase: number;
  name: string;
  artifacts: string[];
}

export interface StateChanges {
  message?: string;
  previous_phase?: number | string | null;
  new_phase?: number;
  removed_approvals?: string[];
  removed_history_entries?: number;
}

export interface RewindOptions {
  root?: string;
  statePath?: string;
  archiveDir?: string;
  reason?: string;
}

export interface RewindResult {
  success: boolean;
  rewound_to?: number;
  phase_name?: string;
  archived?: ArchivedEntry[];
  skipped?: string[];
  invalidated_phases?: InvalidatedPhase[];
  state_changes?: StateChanges;
  error?: string;
}

// Catalogs (preserved verbatim from legacy)

export const PHASE_ORDER: readonly number[] = [-1, 0, 1, 2, 3, 4];

export const PHASE_ARTIFACTS: Record<string, PhaseArtifactInfo> = {
  '-1': {
    name: 'Scout',
    primary: ['specs/codebase-context.md'],
    secondary: ['specs/insights/codebase-context-insights.md'],
  },
  '0': {
    name: 'Challenger',
    primary: ['specs/challenger-brief.md'],
    secondary: ['specs/insights/challenger-brief-insights.md'],
  },
  '1': {
    name: 'Analyst',
    primary: ['specs/product-brief.md'],
    secondary: ['specs/insights/product-brief-insights.md'],
  },
  '2': {
    name: 'PM',
    primary: ['specs/prd.md'],
    secondary: ['specs/insights/prd-insights.md'],
  },
  '3': {
    name: 'Architect',
    primary: ['specs/architecture.md', 'specs/implementation-plan.md'],
    secondary: ['specs/insights/architecture-insights.md'],
  },
  '4': {
    name: 'Developer',
    primary: [],
    secondary: ['specs/insights/implementation-insights.md'],
  },
};

// Implementation

/** Inlined from legacy revert.js (will be replaced with an import when
 *  revert.ts ports). Generates a deterministic archive filename with
 *  ISO-timestamp suffix. */
function archiveFilename(originalPath: string): string {
  const ext = extname(originalPath);
  const base = basename(originalPath, ext);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${base}.${timestamp}${ext}`;
}

/** Get all phases strictly after the target phase. */
export function getDownstreamPhases(targetPhase: number): number[] {
  return PHASE_ORDER.filter((p) => p > targetPhase);
}

/** Get all artifact paths (primary + secondary) for a given phase. */
export function getPhaseArtifacts(phase: number): string[] {
  const info = PHASE_ARTIFACTS[String(phase)];
  if (!info) return [];
  return [...info.primary, ...info.secondary];
}

/** Archive a list of artifacts, skipping those that don't exist. */
export function archiveArtifacts(
  artifacts: string[],
  reason: string,
  options: ArchiveOptions = {}
): ArchiveResult {
  const root = options.root || process.cwd();
  const archiveDir = options.archiveDir || join(root, '.jumpstart', 'archive');
  const archived: ArchivedEntry[] = [];
  const skipped: string[] = [];

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

    const metaPath = `${archivePath}.meta.json`;
    const metadata = {
      original_path: relPath,
      archived_at: now(),
      reason,
      archived_to: archivePath,
      operation: 'rewind',
    };
    writeFileSync(metaPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

    archived.push({ original: relPath, archived_to: archivePath });
  }

  return { archived, skipped };
}

/**
 * Rewind the project to `targetPhase`, archiving every artifact owned
 * by downstream phases, removing those entries from `approved_artifacts`,
 * filtering `phase_history`, and resetting the resume context.
 */
export function rewindToPhase(targetPhase: number, options: RewindOptions = {}): RewindResult {
  const phase = Number(targetPhase);

  if (!PHASE_ORDER.includes(phase)) {
    return {
      success: false,
      error: `Invalid phase: ${targetPhase}. Valid phases: ${PHASE_ORDER.join(', ')}`,
    };
  }

  const phaseInfo = PHASE_ARTIFACTS[String(phase)];
  const root = options.root || process.cwd();
  const statePath = options.statePath || join(root, '.jumpstart', 'state', 'state.json');
  const reason = options.reason || `Rewound to Phase ${phase} (${phaseInfo.name})`;

  const downstream = getDownstreamPhases(phase);
  if (downstream.length === 0) {
    return {
      success: true,
      rewound_to: phase,
      phase_name: phaseInfo.name,
      archived: [],
      invalidated_phases: [],
      state_changes: { message: 'No downstream phases to invalidate' },
    };
  }

  const allArtifacts: string[] = [];
  const invalidatedPhases: InvalidatedPhase[] = [];
  for (const dp of downstream) {
    const dpInfo = PHASE_ARTIFACTS[String(dp)];
    const artifacts = getPhaseArtifacts(dp);
    allArtifacts.push(...artifacts);
    invalidatedPhases.push({ phase: dp, name: dpInfo.name, artifacts });
  }

  const archiveResult = archiveArtifacts(allArtifacts, reason, {
    root,
    archiveDir: options.archiveDir,
  });

  const state: WorkflowState = loadState(statePath);
  const oldPhase = state.current_phase;
  const oldApproved = [...(state.approved_artifacts || [])];

  const downstreamArtifactSet = new Set(allArtifacts);
  state.approved_artifacts = (state.approved_artifacts || []).filter(
    (a) => !downstreamArtifactSet.has(a)
  );

  // Pit Crew M4 Reviewer H6: legacy filter was
  // `!downstream.includes(h.phase)` (no Number() coercion). Earlier
  // port coerced to Number, so a `null` phase entry became `0` and
  // matched downstream when 0 was in the downstream array — silently
  // dropping legacy null entries. Guard explicitly: keep entries
  // whose phase is null/undefined, AND keep entries whose coerced
  // phase number is NOT in downstream.
  state.phase_history = (state.phase_history || []).filter((h) => {
    if (h.phase === null || h.phase === undefined) return true;
    return !downstream.includes(Number(h.phase));
  });

  state.current_phase = phase;
  state.current_agent = phaseInfo.name.toLowerCase();
  state.current_step = null;
  state.last_completed_step = null;

  state.resume_context = {
    tldr: `Rewound to Phase ${phase} (${phaseInfo.name}). ${archiveResult.archived.length} artifacts archived.`,
    last_action: `Phase rewind to ${phaseInfo.name}`,
    next_action: `Continue from Phase ${phase}`,
    open_questions: [],
    key_insights: [`Rewind reason: ${reason}`],
    last_agent: 'rewind',
    last_phase: phase,
    last_step: null,
    timestamp: now(),
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
      removed_approvals: oldApproved.filter((a) => downstreamArtifactSet.has(a)),
      removed_history_entries: downstream.length,
    },
  };
}

/** Render a human-readable rewind report. */
export function renderRewindReport(result: RewindResult): string {
  if (!result.success) {
    return `\n  ❌ Rewind failed: ${result.error}\n`;
  }

  const lines: string[] = [];
  lines.push('');
  lines.push(`  ⏪ Rewound to Phase ${result.rewound_to} — ${result.phase_name}`);
  lines.push('');

  if (result.archived && result.archived.length > 0) {
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

  if (result.invalidated_phases && result.invalidated_phases.length > 0) {
    lines.push('  Invalidated phases:');
    for (const p of result.invalidated_phases) {
      lines.push(`    ✖ Phase ${p.phase} — ${p.name}`);
    }
    lines.push('');
  }

  const sc = result.state_changes;
  if (sc) {
    lines.push('  State changes:');
    lines.push(`    Phase: ${sc.previous_phase ?? 'null'} → ${sc.new_phase}`);
    if (sc.removed_approvals && sc.removed_approvals.length > 0) {
      lines.push(`    Removed ${sc.removed_approvals.length} approval(s)`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
