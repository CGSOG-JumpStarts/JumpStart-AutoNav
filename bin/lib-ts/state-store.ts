/**
 * state-store.ts — workflow state persistence port (T4.3.2).
 *
 * Pure-library port of `bin/lib/state-store.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `setTimelineHook(timeline | null)`
 *   - `loadState(statePath?)` => WorkflowState
 *   - `saveState(state, statePath?)` => {success}
 *   - `updateState(updates, statePath?)` => {success, state}
 *   - `syncPhaseState(phase, options?)` => {success, state?, error?}
 *   - `resetState(statePath?)` => {success, state}
 *   - `createCheckpoint(label, options?)` => {success, checkpoint}
 *   - `restoreCheckpoint(checkpointId, statePath?)` =>
 *     {success, restored_from?, error?}
 *   - `listCheckpoints(statePath?)` => Checkpoint[]
 *   - `pruneCheckpoints(maxCount, statePath?)` =>
 *     {success, removed, remaining}
 *
 * Behavior parity:
 *   - Default state path: `.jumpstart/state/state.json`.
 *   - Phase transitions emit timeline `phase_end` + `phase_start` events.
 *   - Checkpoint hashes use DJB2 (preserved verbatim).
 *   - Default max checkpoints: 20.
 *   - `syncPhaseState` calls `setWorkflowCurrentPhase` from
 *     `config-yaml.ts` (TS port via @lib alias).
 *
 * @see bin/lib/state-store.js (legacy reference)
 * @see specs/implementation-plan.md T4.3.2
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setWorkflowCurrentPhase } from './config-yaml.js';

// Public types

export interface ResumeContext {
  tldr: string | null;
  last_action: string | null;
  next_action: string | null;
  open_questions: string[];
  key_insights: string[];
  last_agent: string | null;
  last_phase: number | string | null;
  last_step: string | null;
  timestamp: string | null;
}

export interface PhaseHistoryEntry {
  phase: number | string | null;
  agent: string | null;
  completed_at: string;
}

export interface Checkpoint {
  id: string;
  label: string;
  timestamp: string;
  phase: number | string | null;
  step: string | null;
  agent: string | null;
  approved_artifacts: string[];
  resume_context: ResumeContext | null;
  artifact_hashes: Record<string, string>;
}

export interface WorkflowState {
  version: string;
  current_phase: number | string | null;
  current_agent: string | null;
  current_step: string | null;
  last_completed_step: string | null;
  active_artifacts: string[];
  approved_artifacts: string[];
  phase_history: PhaseHistoryEntry[];
  last_updated: string | null;
  // Pit Crew M4 Reviewer H3: resume_context is nullable in legacy when
  // a checkpoint with null resume_context is restored. The earlier
  // type forced a defaultState() fallback, breaking downstream
  // consumers that branched on `state.resume_context === null`.
  resume_context: ResumeContext | null;
  checkpoints?: Checkpoint[];
}

export interface StateUpdates {
  phase?: number | string | null;
  agent?: string | null;
  step?: string | null;
  last_completed_step?: string | null;
  active_artifacts?: string[];
  approved_artifact?: string;
  resume_context?: ResumeContext;
}

export interface SyncPhaseOptions {
  root?: string;
  statePath?: string;
  configPath?: string;
  agent?: string | null;
}

export interface CheckpointOptions {
  statePath?: string;
  specsDir?: string;
  maxCheckpoints?: number;
}

export interface TimelineHook {
  recordEvent(event: {
    event_type: string;
    phase: number | string | null;
    agent: string | null;
    action: string;
    metadata?: Record<string, unknown>;
  }): void;
}

const DEFAULT_STATE_PATH = '.jumpstart/state/state.json';

// Module-level timeline hook (preserved from legacy)

let _timelineHook: TimelineHook | null = null;

// Module-level checkpoint counter (Pit Crew M4 Adv F12). Monotonic,
// bumped each createCheckpoint call. Mod-encoded into base36 for
// compact suffix.
let _checkpointCounter = 0;

/** Set the timeline instance for recording state events. Pass null to clear. */
export function setTimelineHook(timeline: TimelineHook | null): void {
  _timelineHook = timeline;
}

// Implementation

/** Default state structure (verbatim from legacy). */
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

/** Load state from disk; defaults on missing/corrupt.
 *
 *  Pit Crew M4 Adversary F13 (HIGH, confirmed exploit): legacy
 *  `JSON.parse` cast bypassed shape validation. A maliciously-crafted
 *  state.json with `"PWNED"` (string root) or `[1,2]` (array root)
 *  would type-confuse downstream consumers — `state.phase_history.push(...)`
 *  crashed with `Cannot read properties of undefined`. Post-fix:
 *  validate the parsed root is a plain object before returning, AND
 *  reject any nodes/edges with prototype-pollution-shaped keys.
 *  Soft-fall to defaults on validation failure (preserves legacy
 *  "soft-fail on corrupt" semantics).
 */
export function loadState(statePath?: string): WorkflowState {
  const p = statePath || DEFAULT_STATE_PATH;
  if (!existsSync(p)) {
    return defaultState();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return defaultState();
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return defaultState();
  }
  const obj = parsed as Record<string, unknown>;
  // Reject prototype-pollution-shaped keys that may leak in via
  // attacker-crafted state.json (Pit Crew M4 Adv F13 + companion to F2).
  for (const k of Object.keys(obj)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
      return defaultState();
    }
  }
  // Apply normalization-style defaults so missing/wrong-typed sub-fields
  // don't crash downstream consumers.
  const base = defaultState();
  return {
    ...base,
    ...obj,
    active_artifacts: Array.isArray(obj.active_artifacts) ? (obj.active_artifacts as string[]) : [],
    approved_artifacts: Array.isArray(obj.approved_artifacts)
      ? (obj.approved_artifacts as string[])
      : [],
    phase_history: Array.isArray(obj.phase_history)
      ? (obj.phase_history as PhaseHistoryEntry[])
      : [],
    // Pit Crew M4 Reviewer H3: preserve explicit null so a restored
    // checkpoint with null resume_context round-trips faithfully.
    // Only fall back to defaultState's shape when the field is
    // missing or wrong-typed (array, primitive).
    resume_context:
      obj.resume_context === null
        ? null
        : obj.resume_context &&
            typeof obj.resume_context === 'object' &&
            !Array.isArray(obj.resume_context)
          ? (obj.resume_context as ResumeContext)
          : 'resume_context' in obj
            ? null
            : base.resume_context,
  };
}

/** Persist state to disk. Auto-creates parent dir, stamps last_updated,
 *  trailing newline. */
export function saveState(state: WorkflowState, statePath?: string): { success: boolean } {
  const p = statePath || DEFAULT_STATE_PATH;
  const dir = dirname(p);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  state.last_updated = new Date().toISOString();
  writeFileSync(p, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return { success: true };
}

/**
 * Apply structured updates to state. Phase transitions push to
 * `phase_history` AND emit `phase_end`+`phase_start` timeline events
 * (when a hook is registered). Boolean updates (approved_artifact)
 * dedupe via includes-check.
 */
export function updateState(
  updates: StateUpdates,
  statePath?: string
): { success: boolean; state: WorkflowState } {
  const state = loadState(statePath);

  if (updates.phase !== undefined) {
    if (state.current_phase !== null && state.current_phase !== updates.phase) {
      state.phase_history.push({
        phase: state.current_phase,
        agent: state.current_agent,
        completed_at: new Date().toISOString(),
      });

      if (_timelineHook) {
        _timelineHook.recordEvent({
          event_type: 'phase_end',
          phase: state.current_phase,
          agent: state.current_agent,
          action: `Phase ${state.current_phase} completed (${state.current_agent || 'unknown'})`,
          metadata: { previous_phase: state.current_phase, new_phase: updates.phase },
        });
        _timelineHook.recordEvent({
          event_type: 'phase_start',
          phase: updates.phase,
          agent: updates.agent || null,
          action: `Phase ${updates.phase} started`,
          metadata: { previous_phase: state.current_phase },
        });
      }
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

/**
 * Synchronize active phase into BOTH state.json AND config.yaml
 * (`workflow.current_phase`). Keeps the dual sources aligned.
 *
 * Returns `{success: false, error}` on config write failure (legacy
 * semantics — does NOT throw).
 */
export function syncPhaseState(
  phase: number | string,
  options: SyncPhaseOptions = {}
): { success: boolean; state?: WorkflowState; error?: string } {
  const root = options.root || process.cwd();
  const statePath = options.statePath || join(root, '.jumpstart', 'state', 'state.json');
  const configPath = options.configPath || join(root, '.jumpstart', 'config.yaml');

  const updates: StateUpdates = { phase };
  if (options.agent !== undefined) {
    updates.agent = options.agent;
  }

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

/** Reset state to defaults. */
export function resetState(statePath?: string): {
  success: boolean;
  state: WorkflowState;
} {
  const state = defaultState();
  saveState(state, statePath);
  return { success: true, state };
}

// ─────────────────────────────────────────────────────────────────────────
// Checkpoints
// ─────────────────────────────────────────────────────────────────────────

/**
 * Create a checkpoint snapshot of current state. Auto-prunes to the
 * `maxCheckpoints` most recent (default 20).
 */
export function createCheckpoint(
  label: string,
  options: CheckpointOptions = {}
): { success: boolean; checkpoint: Checkpoint } {
  const statePath = options.statePath || DEFAULT_STATE_PATH;
  const specsDir = options.specsDir || 'specs';
  const maxCheckpoints = options.maxCheckpoints || 20;
  const state = loadState(statePath);

  if (!Array.isArray(state.checkpoints)) {
    state.checkpoints = [];
  }

  const artifactHashes: Record<string, string> = {};
  try {
    const files = walkDir(specsDir);
    for (const f of files) {
      if (f.endsWith('.md')) {
        const content = readFileSync(f, 'utf8');
        artifactHashes[f] = simpleHash(content);
      }
    }
  } catch {
    // specs dir may not exist yet — that's fine
  }

  const timestamp = new Date().toISOString();
  // Pit Crew M4 Adversary F12 (HIGH, confirmed exploit): legacy ID
  // was second-precision (`cp-2026-04-27T18-11-36`), so two
  // checkpoints created in the same second collided — `restoreCheckpoint`
  // returned the first match, the second became unreachable, and
  // pruning could drop the wrong one. Post-fix: use the FULL ISO
  // timestamp through milliseconds (slice(0,23) → `cp-2026-04-27T18-11-36-789Z`)
  // PLUS a process-monotonic counter to defend against bursty
  // sub-millisecond creation (rare but possible under fake timers /
  // jitter-free CI clocks).
  _checkpointCounter++;
  const checkpoint: Checkpoint = {
    id: `cp-${timestamp.replace(/[:.]/g, '-').slice(0, 23)}-${_checkpointCounter.toString(36)}`,
    label: label || 'auto',
    timestamp,
    phase: state.current_phase,
    step: state.current_step,
    agent: state.current_agent,
    approved_artifacts: [...(state.approved_artifacts || [])],
    resume_context: state.resume_context ? { ...state.resume_context } : null,
    artifact_hashes: artifactHashes,
  };

  state.checkpoints.push(checkpoint);

  if (_timelineHook) {
    _timelineHook.recordEvent({
      event_type: 'checkpoint_created',
      phase: state.current_phase,
      agent: state.current_agent,
      action: `Checkpoint created: ${label || 'auto'}`,
      metadata: { checkpoint_id: checkpoint.id, checkpoint_label: checkpoint.label },
    });
  }

  if (state.checkpoints.length > maxCheckpoints) {
    state.checkpoints = state.checkpoints.slice(-maxCheckpoints);
  }

  saveState(state, statePath);
  return { success: true, checkpoint };
}

/** Restore state from a named checkpoint (does NOT restore file contents). */
export function restoreCheckpoint(
  checkpointId: string,
  statePath?: string
): { success: boolean; restored_from?: Checkpoint; error?: string } {
  const p = statePath || DEFAULT_STATE_PATH;
  const state = loadState(p);

  if (!Array.isArray(state.checkpoints) || state.checkpoints.length === 0) {
    return { success: false, error: 'No checkpoints available' };
  }

  const checkpoint = state.checkpoints.find((cp) => cp.id === checkpointId);
  if (!checkpoint) {
    return { success: false, error: `Checkpoint not found: ${checkpointId}` };
  }

  state.current_phase = checkpoint.phase;
  state.current_step = checkpoint.step;
  state.current_agent = checkpoint.agent;
  state.approved_artifacts = [...(checkpoint.approved_artifacts || [])];
  // Pit Crew M4 Reviewer H3: legacy returns null when checkpoint has
  // no resume_context — preserve that contract so downstream consumers
  // can branch on `=== null`.
  state.resume_context = checkpoint.resume_context ? { ...checkpoint.resume_context } : null;
  state.last_completed_step = null;

  if (_timelineHook) {
    _timelineHook.recordEvent({
      event_type: 'rewind',
      phase: checkpoint.phase,
      agent: checkpoint.agent,
      action: `Restored to checkpoint: ${checkpoint.label} (${checkpointId})`,
      metadata: { checkpoint_id: checkpointId, target_phase_for_rewind: checkpoint.phase },
    });
  }

  saveState(state, p);
  return { success: true, restored_from: checkpoint };
}

/** List all checkpoints, most-recent-first. */
export function listCheckpoints(statePath?: string): Checkpoint[] {
  const state = loadState(statePath || DEFAULT_STATE_PATH);
  const checkpoints = Array.isArray(state.checkpoints) ? state.checkpoints : [];
  return [...checkpoints].reverse();
}

/** Prune checkpoints, keeping the N most recent. */
export function pruneCheckpoints(
  maxCount: number,
  statePath?: string
): { success: boolean; removed: number; remaining: number } {
  const p = statePath || DEFAULT_STATE_PATH;
  const state = loadState(p);

  if (!Array.isArray(state.checkpoints)) {
    return { success: true, removed: 0, remaining: 0 };
  }

  const before = state.checkpoints.length;
  if (before <= maxCount) {
    return { success: true, removed: 0, remaining: before };
  }

  state.checkpoints = state.checkpoints.slice(-maxCount);
  saveState(state, p);

  return { success: true, removed: before - maxCount, remaining: maxCount };
}

// Helpers

/** DJB2 hash (legacy parity — fast non-crypto checksum). */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash + str.charCodeAt(i);
    hash = hash & hash; // 32-bit
  }
  return (hash >>> 0).toString(16);
}

/** Recursive directory walk; returns absolute file paths. */
function walkDir(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full));
    } else {
      results.push(full);
    }
  }
  return results;
}
