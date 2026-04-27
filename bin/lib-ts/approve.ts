/**
 * approve.ts — programmatic artifact approval/rejection port (T4.3.2).
 *
 * Pure-library port of `bin/lib/approve.js`. Public surface preserved
 * verbatim by name + signature:
 *
 *   - `setApproveTimelineHook(timeline | null)`
 *   - `detectCurrentArtifact(options?)`
 *   - `approveArtifact(filePath, options?)`
 *   - `rejectArtifact(filePath, options?)`
 *   - `renderApprovalResult(result)` => string
 *   - `renderRejectionResult(result)` => string
 *
 * Behavior parity:
 *   - PHASE_ARTIFACT_MAP / PHASE_MAP / AGENT_COMMANDS preserved verbatim.
 *   - Approval flow: flip `[ ]`→`[x]`, set Approver/Date/Status.
 *   - Rejection flow: flip back, append to `specs/insights/rejection-log.md`.
 *   - Auto-handoff (when `workflow.auto_handoff !== false`) advances
 *     phase state via `syncPhaseState`.
 *   - Timeline events recorded for both approval and rejection.
 *
 * @see bin/lib/approve.js (legacy reference)
 * @see specs/implementation-plan.md T4.3.2
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { getWorkflowSettings, setWorkflowCurrentPhase } from './config-yaml.js';

// Public types

export interface ApproveOptions {
  approver?: string;
  root?: string;
  statePath?: string;
  configPath?: string;
}

export interface RejectOptions {
  reason?: string;
  root?: string;
  statePath?: string;
}

export interface DetectArtifactOptions {
  root?: string;
  statePath?: string;
}

export interface DetectArtifactResult {
  phase: number | string | null;
  artifact_path: string | null;
  exists: boolean;
}

export interface HandoffInfo {
  current_phase?: number | string;
  current_name?: string;
  next_phase?: number | string | null;
  next_agent?: string | null;
  artifacts_to_create?: string[];
  context_files?: string[];
  message?: string;
  ready: boolean;
  error?: string;
}

export interface AutoHandoff {
  enabled: boolean;
  advanced: boolean;
  command: string | null;
  warning: string | null;
}

export interface ApprovalResult {
  success: boolean;
  artifact?: string;
  approver?: string;
  date?: string;
  handoff_info?: HandoffInfo | null;
  auto_handoff?: AutoHandoff;
  error?: string;
}

export interface RejectionResult {
  success: boolean;
  artifact?: string;
  reason?: string;
  logged_to?: string | null;
  error?: string;
}

export interface ApproveTimelineHook {
  recordEvent(event: {
    event_type: string;
    action: string;
    metadata?: Record<string, unknown>;
  }): void;
}

interface WorkflowState {
  current_phase: number | string | null;
  current_agent: string | null;
  current_step: string | null;
  last_completed_step: string | null;
  active_artifacts: string[];
  approved_artifacts: string[];
  phase_history: Array<{
    phase: number | string | null;
    agent: string | null;
    completed_at: string;
  }>;
  last_updated: string | null;
  resume_context: Record<string, unknown>;
  version: string;
}

interface StateUpdates {
  phase?: number | string | null;
  agent?: string | null;
  step?: string | null;
  last_completed_step?: string | null;
  active_artifacts?: string[];
  approved_artifact?: string;
  resume_context?: Record<string, unknown>;
}

// Catalogs (verbatim from legacy)

const AGENT_COMMANDS: Record<string, string> = {
  scout: '/jumpstart.scout',
  challenger: '/jumpstart.challenge',
  analyst: '/jumpstart.analyze',
  pm: '/jumpstart.plan',
  architect: '/jumpstart.architect',
  developer: '/jumpstart.build',
};

const PHASE_ARTIFACT_MAP: Record<string, string | null> = {
  '-1': 'specs/codebase-context.md',
  '0': 'specs/challenger-brief.md',
  '1': 'specs/product-brief.md',
  '2': 'specs/prd.md',
  '3': 'specs/architecture.md',
  '4': null,
};

interface PhaseTransition {
  name: string;
  next_phase: number | null;
  next_agent: string | null;
  next_artifacts: string[];
  next_context: string[];
}

const PHASE_MAP: Record<string, PhaseTransition> = {
  '-1': {
    name: 'Scout',
    next_phase: 0,
    next_agent: 'challenger',
    next_artifacts: ['specs/challenger-brief.md', 'specs/insights/challenger-brief-insights.md'],
    next_context: ['.jumpstart/config.yaml', '.jumpstart/roadmap.md', 'specs/codebase-context.md'],
  },
  '0': {
    name: 'Challenger',
    next_phase: 1,
    next_agent: 'analyst',
    next_artifacts: ['specs/product-brief.md', 'specs/insights/product-brief-insights.md'],
    next_context: ['.jumpstart/config.yaml', '.jumpstart/roadmap.md', 'specs/challenger-brief.md'],
  },
  '1': {
    name: 'Analyst',
    next_phase: 2,
    next_agent: 'pm',
    next_artifacts: ['specs/prd.md', 'specs/insights/prd-insights.md'],
    next_context: [
      '.jumpstart/config.yaml',
      '.jumpstart/roadmap.md',
      'specs/challenger-brief.md',
      'specs/product-brief.md',
    ],
  },
  '2': {
    name: 'PM',
    next_phase: 3,
    next_agent: 'architect',
    next_artifacts: [
      'specs/architecture.md',
      'specs/implementation-plan.md',
      'specs/insights/architecture-insights.md',
    ],
    next_context: [
      '.jumpstart/config.yaml',
      '.jumpstart/roadmap.md',
      'specs/challenger-brief.md',
      'specs/product-brief.md',
      'specs/prd.md',
    ],
  },
  '3': {
    name: 'Architect',
    next_phase: 4,
    next_agent: 'developer',
    next_artifacts: ['specs/insights/implementation-insights.md'],
    next_context: [
      '.jumpstart/config.yaml',
      '.jumpstart/roadmap.md',
      'specs/prd.md',
      'specs/architecture.md',
      'specs/implementation-plan.md',
    ],
  },
  '4': {
    name: 'Developer',
    next_phase: null,
    next_agent: null,
    next_artifacts: [],
    next_context: [],
  },
};

// Module-level timeline hook

let _timelineHook: ApproveTimelineHook | null = null;

export function setApproveTimelineHook(timeline: ApproveTimelineHook | null): void {
  _timelineHook = timeline;
}

// Helpers — duplicated from state-store.ts for parity (legacy approve.js
// has its own copies; we preserve that duplication so behavior is identical
// even when state-store.ts is bypassed).
//
// @owner: bin/lib-ts/state-store.ts — keep loadState/saveState/
// updateState/syncPhaseState byte-equivalent until handoff.ts ports
// and the duplication can be eliminated. Pit Crew M4 Reviewer M11.

function now(): string {
  return new Date().toISOString();
}

function defaultState(): WorkflowState {
  return {
    version: '1.0.0',
    current_phase: null,
    current_agent: null,
    current_step: null,
    last_completed_step: null,
    active_artifacts: [],
    approved_artifacts: [],
    phase_history: [],
    last_updated: null,
    resume_context: {
      tldr: null,
      last_action: null,
      next_action: null,
      open_questions: [],
      key_insights: [],
      last_agent: null,
      last_phase: null,
      last_step: null,
      timestamp: null,
    },
  };
}

function normalizeState(state: Partial<WorkflowState> | null | undefined): WorkflowState {
  const base = defaultState();
  const merged = { ...base, ...(state || {}) };
  if (!Array.isArray(merged.active_artifacts)) merged.active_artifacts = [];
  if (!Array.isArray(merged.approved_artifacts)) merged.approved_artifacts = [];
  if (!Array.isArray(merged.phase_history)) merged.phase_history = [];
  if (!merged.resume_context || typeof merged.resume_context !== 'object') {
    merged.resume_context = base.resume_context;
  }
  return merged;
}

function loadState(statePath: string): WorkflowState {
  if (!existsSync(statePath)) return defaultState();
  try {
    return normalizeState(JSON.parse(readFileSync(statePath, 'utf8')));
  } catch {
    return defaultState();
  }
}

function saveState(state: WorkflowState, statePath: string): { success: boolean } {
  state.last_updated = new Date().toISOString();
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return { success: true };
}

function updateState(
  updates: StateUpdates,
  statePath: string
): { success: boolean; state: WorkflowState } {
  const state = loadState(statePath);

  if (updates.phase !== undefined) {
    if (state.current_phase !== null && state.current_phase !== updates.phase) {
      state.phase_history.push({
        phase: state.current_phase,
        agent: state.current_agent,
        completed_at: new Date().toISOString(),
      });
    }
    state.current_phase = updates.phase;
  }

  if (updates.agent !== undefined) state.current_agent = updates.agent;
  if (updates.step !== undefined) state.current_step = updates.step;
  if (updates.last_completed_step !== undefined) {
    state.last_completed_step = updates.last_completed_step;
  }
  if (updates.active_artifacts) state.active_artifacts = updates.active_artifacts;
  if (updates.resume_context) state.resume_context = updates.resume_context;

  if (updates.approved_artifact) {
    if (!state.approved_artifacts.includes(updates.approved_artifact)) {
      state.approved_artifacts.push(updates.approved_artifact);
    }
  }

  saveState(state, statePath);
  return { success: true, state };
}

function syncPhaseState(
  phase: number | string,
  options: { root?: string; statePath?: string; configPath?: string; agent?: string | null } = {}
): { success: boolean; state?: WorkflowState; error?: string } {
  const root = options.root || process.cwd();
  const statePath = options.statePath || join(root, '.jumpstart', 'state', 'state.json');
  const configPath = options.configPath || join(root, '.jumpstart', 'config.yaml');

  const updates: StateUpdates = { phase };
  if (options.agent !== undefined) updates.agent = options.agent;

  const stateResult = updateState(updates, statePath);

  try {
    setWorkflowCurrentPhase(configPath, String(phase));
  } catch (error) {
    return {
      success: false,
      state: stateResult.state,
      error: `Failed to sync workflow.current_phase in config.yaml: ${(error as Error).message}`,
    };
  }

  return { success: true, state: stateResult.state };
}

// Implementation

function getHandoff(currentPhase: number | string): HandoffInfo {
  const key = String(currentPhase);
  const transition = PHASE_MAP[key];

  if (!transition) {
    return { error: `Unknown phase: ${currentPhase}`, ready: false };
  }

  if (transition.next_phase === null) {
    return {
      current_phase: currentPhase,
      next_phase: null,
      next_agent: null,
      message: 'Phase 4 is the final phase. No further handoff needed.',
      ready: false,
    };
  }

  return {
    current_phase: currentPhase,
    current_name: transition.name,
    next_phase: transition.next_phase,
    next_agent: transition.next_agent,
    artifacts_to_create: transition.next_artifacts,
    context_files: transition.next_context,
    ready: true,
  };
}

/** Detect the canonical artifact for the current phase. */
export function detectCurrentArtifact(options: DetectArtifactOptions = {}): DetectArtifactResult {
  const root = options.root || process.cwd();
  const statePath = options.statePath || join(root, '.jumpstart', 'state', 'state.json');
  const state = loadState(statePath);

  const phase = state.current_phase;
  if (phase === null || phase === undefined) {
    return { phase: null, artifact_path: null, exists: false };
  }

  const artifact = PHASE_ARTIFACT_MAP[String(phase)];
  if (!artifact) {
    return { phase, artifact_path: null, exists: false };
  }

  const fullPath = join(root, artifact);
  return { phase, artifact_path: artifact, exists: existsSync(fullPath) };
}

/**
 * Approve an artifact: flip checkboxes, stamp approver/date/status,
 * push to approved_artifacts, optionally auto-handoff to next phase.
 */
export function approveArtifact(filePath: string, options: ApproveOptions = {}): ApprovalResult {
  const root = options.root || process.cwd();
  const fullPath =
    filePath.startsWith('/') || filePath.includes(':') ? filePath : join(root, filePath);
  const relPath = relative(root, fullPath).replace(/\\/g, '/');
  const approver = options.approver || 'Human';
  const statePath = options.statePath || join(root, '.jumpstart', 'state', 'state.json');
  const configPath = options.configPath || join(root, '.jumpstart', 'config.yaml');

  if (!existsSync(fullPath)) {
    return { success: false, error: `Artifact not found: ${filePath}` };
  }

  let content = readFileSync(fullPath, 'utf8');

  if (!/## Phase Gate Approval/i.test(content)) {
    return {
      success: false,
      error: 'No "## Phase Gate Approval" section found in artifact',
    };
  }

  content = content.replace(/- \[ \]/g, '- [x]');
  content = content.replace(/(\*\*Approved by:\*\*)\s*.+/i, `$1 ${approver}`);

  const dateStr = now().split('T')[0];
  content = content.replace(/(\*\*Approval date:\*\*)\s*.+/i, `$1 ${dateStr}`);
  content = content.replace(/(\*\*Status:\*\*)\s*.+/i, '$1 Approved');

  writeFileSync(fullPath, content, 'utf8');

  updateState({ approved_artifact: relPath }, statePath);

  if (_timelineHook) {
    _timelineHook.recordEvent({
      event_type: 'approval',
      action: `Artifact approved: ${relPath}`,
      metadata: { artifact_path: relPath, approver, date: dateStr },
    });
  }

  const state = loadState(statePath);
  let handoffInfo: HandoffInfo | null = null;
  const autoHandoff: AutoHandoff = {
    enabled: false,
    advanced: false,
    command: null,
    warning: null,
  };

  try {
    const settings = getWorkflowSettings(configPath);
    autoHandoff.enabled = settings.auto_handoff !== false;
  } catch {
    autoHandoff.warning =
      'Could not read workflow settings from config.yaml; auto-handoff skipped.';
  }

  if (state.current_phase !== null && state.current_phase !== undefined) {
    handoffInfo = getHandoff(state.current_phase);

    if (
      autoHandoff.enabled &&
      handoffInfo?.ready &&
      handoffInfo.next_phase !== undefined &&
      handoffInfo.next_phase !== null
    ) {
      const syncResult = syncPhaseState(handoffInfo.next_phase, {
        root,
        statePath,
        configPath,
        agent: handoffInfo.next_agent ?? null,
      });

      if (syncResult.success) {
        autoHandoff.advanced = true;
        autoHandoff.command = handoffInfo.next_agent
          ? AGENT_COMMANDS[handoffInfo.next_agent] || null
          : null;
      } else {
        autoHandoff.warning = syncResult.error || 'Unable to sync phase progression.';
      }
    }
  }

  return {
    success: true,
    artifact: relPath,
    approver,
    date: dateStr,
    handoff_info: handoffInfo,
    auto_handoff: autoHandoff,
  };
}

/**
 * Reject an artifact: flip checkboxes back, set status to Draft, log
 * the rejection to `specs/insights/rejection-log.md`.
 */
export function rejectArtifact(filePath: string, options: RejectOptions = {}): RejectionResult {
  const root = options.root || process.cwd();
  const fullPath =
    filePath.startsWith('/') || filePath.includes(':') ? filePath : join(root, filePath);
  const relPath = relative(root, fullPath).replace(/\\/g, '/');
  const reason = options.reason || 'No reason provided';
  const statePath = options.statePath || join(root, '.jumpstart', 'state', 'state.json');

  if (!existsSync(fullPath)) {
    return { success: false, error: `Artifact not found: ${filePath}` };
  }

  let content = readFileSync(fullPath, 'utf8');

  if (!/## Phase Gate Approval/i.test(content)) {
    return {
      success: false,
      error: 'No "## Phase Gate Approval" section found in artifact',
    };
  }

  content = content.replace(/- \[x\]/gi, '- [ ]');
  content = content.replace(/(\*\*Approved by:\*\*)\s*.+/i, '$1 Pending');
  content = content.replace(/(\*\*Approval date:\*\*)\s*.+/i, '$1 Pending');
  content = content.replace(/(\*\*Status:\*\*)\s*.+/i, '$1 Draft');

  writeFileSync(fullPath, content, 'utf8');

  const state = loadState(statePath);
  state.approved_artifacts = (state.approved_artifacts || []).filter((a) => a !== relPath);
  saveState(state, statePath);

  if (_timelineHook) {
    _timelineHook.recordEvent({
      event_type: 'rejection',
      action: `Artifact rejected: ${relPath}`,
      metadata: { artifact_path: relPath, reason },
    });
  }

  let loggedTo: string | null = null;
  try {
    const insightsDir = join(root, 'specs', 'insights');
    if (!existsSync(insightsDir)) {
      mkdirSync(insightsDir, { recursive: true });
    }
    const logFile = join(insightsDir, 'rejection-log.md');
    loggedTo = 'specs/insights/rejection-log.md';

    const entry = `\n## Rejection — ${now()}\n\n- **Artifact:** ${relPath}\n- **Reason:** ${reason}\n- **Date:** ${now()}\n\n---\n`;

    if (!existsSync(logFile)) {
      writeFileSync(
        logFile,
        `# Rejection Log\n\nAudit trail of artifact rejections.\n${entry}`,
        'utf8'
      );
    } else {
      appendFileSync(logFile, entry, 'utf8');
    }
  } catch {
    // best-effort log; ignore disk failures
  }

  return {
    success: true,
    artifact: relPath,
    reason,
    logged_to: loggedTo,
  };
}

/** Render an approval result as human-readable text. */
export function renderApprovalResult(result: ApprovalResult): string {
  if (!result.success) {
    return `\n  ❌ Approval failed: ${result.error}\n`;
  }

  const lines: string[] = [];
  lines.push('');
  lines.push(`  ✅ Approved: ${result.artifact}`);
  lines.push(`     Approver: ${result.approver}`);
  lines.push(`     Date: ${result.date}`);

  if (result.handoff_info?.ready) {
    lines.push('');
    lines.push(
      `  ▶ Next: Phase ${result.handoff_info.next_phase} — ${result.handoff_info.next_agent}`
    );
    if (result.auto_handoff?.advanced) {
      lines.push('    Auto-advanced phase state.');
      if (result.auto_handoff.command) {
        lines.push(`    Start next agent: ${result.auto_handoff.command}`);
      } else {
        lines.push('    Start next agent using your phase command.');
      }
    } else {
      lines.push('    Run /jumpstart.next to continue');
    }
  }

  if (result.auto_handoff?.warning) {
    lines.push('');
    lines.push(`  ⚠ ${result.auto_handoff.warning}`);
  }

  lines.push('');
  return lines.join('\n');
}

/** Render a rejection result as human-readable text. */
export function renderRejectionResult(result: RejectionResult): string {
  if (!result.success) {
    return `\n  ❌ Rejection failed: ${result.error}\n`;
  }

  const lines: string[] = [];
  lines.push('');
  lines.push(`  🚫 Rejected: ${result.artifact}`);
  lines.push(`     Reason: ${result.reason}`);
  if (result.logged_to) {
    lines.push(`     Logged to: ${result.logged_to}`);
  }
  lines.push('');
  lines.push('  Revision needed — update the artifact and re-approve when ready.');
  lines.push('');
  return lines.join('\n');
}
