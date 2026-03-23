/**
 * agent-checkpoint.js — Agent Self-Checkpoint & Resume (Item 57)
 *
 * Recover gracefully from interrupted runs or model failures.
 *
 * Usage:
 *   node bin/lib/agent-checkpoint.js save|restore|list|clean [options]
 *
 * State file: .jumpstart/state/agent-checkpoints.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'agent-checkpoints.json');

const CHECKPOINT_TYPES = ['phase-start', 'phase-end', 'task-start', 'task-end', 'error-recovery', 'manual'];

function defaultState() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    checkpoints: [],
    recovery_log: []
  };
}

function loadState(stateFile) {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  if (!fs.existsSync(filePath)) return defaultState();
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return defaultState(); }
}

function saveState(state, stateFile) {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/**
 * Save a checkpoint.
 *
 * @param {object} checkpoint - { agent, phase?, task?, context, type? }
 * @param {object} [options]
 * @returns {object}
 */
function saveCheckpoint(checkpoint, options = {}) {
  if (!checkpoint || !checkpoint.agent) {
    return { success: false, error: 'agent is required' };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const cp = {
    id: `CP-${Date.now().toString(36).toUpperCase()}`,
    agent: checkpoint.agent,
    phase: checkpoint.phase || null,
    task: checkpoint.task || null,
    type: checkpoint.type || 'manual',
    context: checkpoint.context || {},
    files_snapshot: checkpoint.files_snapshot || [],
    saved_at: new Date().toISOString()
  };

  state.checkpoints.push(cp);

  // Keep only last 50 checkpoints
  if (state.checkpoints.length > 50) {
    state.checkpoints = state.checkpoints.slice(-50);
  }

  saveState(state, stateFile);

  return { success: true, checkpoint: cp };
}

/**
 * Restore from a checkpoint.
 *
 * @param {string} [checkpointId] - If omitted, restores from latest.
 * @param {object} [options]
 * @returns {object}
 */
function restoreCheckpoint(checkpointId, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  let checkpoint;
  if (checkpointId) {
    checkpoint = state.checkpoints.find(c => c.id === checkpointId);
  } else {
    checkpoint = state.checkpoints[state.checkpoints.length - 1];
  }

  if (!checkpoint) {
    return { success: false, error: checkpointId ? `Checkpoint not found: ${checkpointId}` : 'No checkpoints available' };
  }

  state.recovery_log.push({
    checkpoint_id: checkpoint.id,
    restored_at: new Date().toISOString()
  });
  saveState(state, stateFile);

  return {
    success: true,
    checkpoint,
    agent: checkpoint.agent,
    phase: checkpoint.phase,
    task: checkpoint.task,
    context: checkpoint.context
  };
}

/**
 * List available checkpoints.
 *
 * @param {object} [filter] - { agent?, phase?, type? }
 * @param {object} [options]
 * @returns {object}
 */
function listCheckpoints(filter = {}, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);
  let checkpoints = state.checkpoints;

  if (filter.agent) checkpoints = checkpoints.filter(c => c.agent === filter.agent);
  if (filter.phase) checkpoints = checkpoints.filter(c => c.phase === filter.phase);
  if (filter.type) checkpoints = checkpoints.filter(c => c.type === filter.type);

  return { success: true, checkpoints, total: checkpoints.length };
}

/**
 * Clean old checkpoints.
 *
 * @param {object} [options] - { keep? }
 * @returns {object}
 */
function cleanCheckpoints(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);
  const keep = options.keep || 10;
  const removed = Math.max(0, state.checkpoints.length - keep);

  state.checkpoints = state.checkpoints.slice(-keep);
  saveState(state, stateFile);

  return { success: true, removed, remaining: state.checkpoints.length };
}

module.exports = {
  defaultState,
  loadState,
  saveState,
  saveCheckpoint,
  restoreCheckpoint,
  listCheckpoints,
  cleanCheckpoints,
  CHECKPOINT_TYPES
};
