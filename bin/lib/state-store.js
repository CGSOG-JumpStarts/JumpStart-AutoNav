/**
 * state-store.js — Stateful Workflow Persistence (Item 39)
 *
 * Maintains workflow state across interruptions. Persists current phase,
 * active artifacts, last completed step, and resume context.
 *
 * Usage:
 *   echo '{"action":"save","phase":2,"step":3}' | node bin/lib/state-store.js
 *   echo '{"action":"load"}' | node bin/lib/state-store.js
 *   echo '{"action":"reset"}' | node bin/lib/state-store.js
 *
 * Output (stdout JSON):
 *   { "success": true, "state": { ... } }
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { readFileSync, writeFileSync, mkdirSync, existsSync } = require('fs');
const { join, dirname } = require('path');

const DEFAULT_STATE_PATH = '.jumpstart/state/state.json';

/**
 * Default state structure.
 * @returns {object}
 */
function defaultState() {
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
      timestamp: null
    }
  };
}

/**
 * Load state from disk.
 * @param {string} [statePath] - Path to state file
 * @returns {object}
 */
export function loadState(statePath) {
  const path = statePath || DEFAULT_STATE_PATH;
  if (!existsSync(path)) {
    return defaultState();
  }
  try {
    const content = readFileSync(path, 'utf8');
    return JSON.parse(content);
  } catch {
    return defaultState();
  }
}

/**
 * Save state to disk.
 * @param {object} state - State to persist
 * @param {string} [statePath] - Path to state file
 * @returns {{ success: boolean }}
 */
export function saveState(state, statePath) {
  const path = statePath || DEFAULT_STATE_PATH;
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  state.last_updated = new Date().toISOString();
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n', 'utf8');
  return { success: true };
}

/**
 * Update state with new phase/step information.
 * @param {object} updates - Fields to update
 * @param {string} [statePath] - Path to state file
 * @returns {{ success: boolean, state: object }}
 */
export function updateState(updates, statePath) {
  const state = loadState(statePath);

  if (updates.phase !== undefined) {
    if (state.current_phase !== null && state.current_phase !== updates.phase) {
      state.phase_history.push({
        phase: state.current_phase,
        agent: state.current_agent,
        completed_at: new Date().toISOString()
      });
    }
    state.current_phase = updates.phase;
  }

  if (updates.agent !== undefined) state.current_agent = updates.agent;
  if (updates.step !== undefined) state.current_step = updates.step;
  if (updates.last_completed_step !== undefined) state.last_completed_step = updates.last_completed_step;
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
 * Reset state to default.
 * @param {string} [statePath] - Path to state file
 * @returns {{ success: boolean, state: object }}
 */
export function resetState(statePath) {
  const state = defaultState();
  saveState(state, statePath);
  return { success: true, state };
}

// ─── Checkpoint Functions (UX Feature 10) ────────────────────────────────────

/**
 * Create a checkpoint — a snapshot of the current workflow state.
 * @param {string} label - Human-readable label for the checkpoint
 * @param {object} [options]
 * @param {string} [options.statePath] - State file path
 * @param {string} [options.specsDir] - Specs directory to hash
 * @param {number} [options.maxCheckpoints] - Max checkpoints to keep (default 20)
 * @returns {{ success: boolean, checkpoint: object }}
 */
export function createCheckpoint(label, options = {}) {
  const statePath = options.statePath || DEFAULT_STATE_PATH;
  const specsDir = options.specsDir || 'specs';
  const maxCheckpoints = options.maxCheckpoints || 20;
  const state = loadState(statePath);

  // Ensure checkpoints array exists
  if (!Array.isArray(state.checkpoints)) {
    state.checkpoints = [];
  }

  // Build artifact hashes
  const artifactHashes = {};
  try {
    const files = _walkDir(specsDir);
    for (const f of files) {
      if (f.endsWith('.md')) {
        const content = readFileSync(f, 'utf8');
        artifactHashes[f] = _simpleHash(content);
      }
    }
  } catch {
    // specs dir may not exist yet — that's fine
  }

  const timestamp = new Date().toISOString();
  const checkpoint = {
    id: `cp-${timestamp.replace(/[:.]/g, '-').slice(0, 19)}`,
    label: label || 'auto',
    timestamp,
    phase: state.current_phase,
    step: state.current_step,
    agent: state.current_agent,
    approved_artifacts: [...(state.approved_artifacts || [])],
    resume_context: state.resume_context ? { ...state.resume_context } : null,
    artifact_hashes: artifactHashes
  };

  state.checkpoints.push(checkpoint);

  // Prune old checkpoints
  if (state.checkpoints.length > maxCheckpoints) {
    state.checkpoints = state.checkpoints.slice(-maxCheckpoints);
  }

  saveState(state, statePath);
  return { success: true, checkpoint };
}

/**
 * Restore workflow state from a checkpoint.
 * Restores phase, step, agent, and resume_context. Does NOT restore file contents.
 * @param {string} checkpointId - The checkpoint ID to restore from
 * @param {string} [statePath] - State file path
 * @returns {{ success: boolean, restored_from: object, error?: string }}
 */
export function restoreCheckpoint(checkpointId, statePath) {
  const path = statePath || DEFAULT_STATE_PATH;
  const state = loadState(path);

  if (!Array.isArray(state.checkpoints) || state.checkpoints.length === 0) {
    return { success: false, error: 'No checkpoints available' };
  }

  const checkpoint = state.checkpoints.find(cp => cp.id === checkpointId);
  if (!checkpoint) {
    return { success: false, error: `Checkpoint not found: ${checkpointId}` };
  }

  // Restore state fields
  state.current_phase = checkpoint.phase;
  state.current_step = checkpoint.step;
  state.current_agent = checkpoint.agent;
  state.approved_artifacts = [...(checkpoint.approved_artifacts || [])];
  state.resume_context = checkpoint.resume_context ? { ...checkpoint.resume_context } : null;
  state.last_completed_step = null;

  saveState(state, path);
  return { success: true, restored_from: checkpoint };
}

/**
 * List all checkpoints, most recent first.
 * @param {string} [statePath] - State file path
 * @returns {object[]} Array of checkpoint objects
 */
export function listCheckpoints(statePath) {
  const state = loadState(statePath || DEFAULT_STATE_PATH);
  const checkpoints = Array.isArray(state.checkpoints) ? state.checkpoints : [];
  return [...checkpoints].reverse();
}

/**
 * Prune checkpoints, keeping only the N most recent.
 * @param {number} maxCount - Max checkpoints to keep
 * @param {string} [statePath] - State file path
 * @returns {{ success: boolean, removed: number, remaining: number }}
 */
export function pruneCheckpoints(maxCount, statePath) {
  const path = statePath || DEFAULT_STATE_PATH;
  const state = loadState(path);

  if (!Array.isArray(state.checkpoints)) {
    return { success: true, removed: 0, remaining: 0 };
  }

  const before = state.checkpoints.length;
  if (before <= maxCount) {
    return { success: true, removed: 0, remaining: before };
  }

  state.checkpoints = state.checkpoints.slice(-maxCount);
  saveState(state, path);

  return { success: true, removed: before - maxCount, remaining: maxCount };
}

/**
 * Simple DJB2 hash for checkpoint content hashing.
 * @param {string} str
 * @returns {string}
 */
function _simpleHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  return (hash >>> 0).toString(16);
}

/**
 * Walk a directory recursively and return file paths.
 * @param {string} dir
 * @returns {string[]}
 */
function _walkDir(dir) {
  const results = [];
  if (!existsSync(dir)) return results;
  const { readdirSync, statSync } = require('fs');
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(..._walkDir(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

// CLI mode
if (process.argv[1] && process.argv[1].endsWith('state-store.js')) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const data = JSON.parse(input || '{}');
      const action = data.action || 'load';
      let result;

      switch (action) {
        case 'save':
          result = updateState(data, data.state_path);
          break;
        case 'load':
          result = { success: true, state: loadState(data.state_path) };
          break;
        case 'reset':
          result = resetState(data.state_path);
          break;
        case 'checkpoint-create':
          result = createCheckpoint(data.label, { statePath: data.state_path, specsDir: data.specs_dir });
          break;
        case 'checkpoint-list':
          result = { success: true, checkpoints: listCheckpoints(data.state_path) };
          break;
        case 'checkpoint-restore':
          result = restoreCheckpoint(data.checkpoint_id, data.state_path);
          break;
        default:
          result = { error: `Unknown action: ${action}` };
      }

      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } catch (err) {
      process.stderr.write(JSON.stringify({ error: err.message }) + '\n');
      process.exit(1);
    }
  });
}
