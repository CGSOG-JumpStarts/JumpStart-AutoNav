/**
 * collaboration.js — Real-Time Collaboration Sessions (Item 65)
 *
 * Multiple humans and multiple agents working against
 * the same initiative safely with conflict detection.
 *
 * Usage:
 *   node bin/lib/collaboration.js create|join|status|lock [options]
 *
 * State file: .jumpstart/state/collaboration.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'collaboration.json');

const PARTICIPANT_ROLES = ['owner', 'editor', 'reviewer', 'observer'];

function defaultState() {
  return {
    version: '1.0.0',
    sessions: [],
    locks: [],
    last_updated: null
  };
}

function loadState(stateFile) {
  const fp = stateFile || DEFAULT_STATE_FILE;
  if (!fs.existsSync(fp)) return defaultState();
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch { return defaultState(); }
}

function saveState(state, stateFile) {
  const fp = stateFile || DEFAULT_STATE_FILE;
  const dir = path.dirname(fp);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  fs.writeFileSync(fp, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/**
 * Create a collaboration session.
 */
function createSession(name, options = {}) {
  if (!name) return { success: false, error: 'Session name is required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const session = {
    id: `COLLAB-${Date.now()}`,
    name,
    status: 'active',
    owner: options.owner || 'system',
    participants: [{ name: options.owner || 'system', role: 'owner', joined_at: new Date().toISOString() }],
    artifacts: options.artifacts || [],
    created_at: new Date().toISOString(),
    ended_at: null
  };

  state.sessions.push(session);
  saveState(state, stateFile);

  return { success: true, session };
}

/**
 * Join an existing session.
 */
function joinSession(sessionId, participant, options = {}) {
  if (!sessionId || !participant) return { success: false, error: 'sessionId and participant name are required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const session = state.sessions.find(s => s.id === sessionId);
  if (!session) return { success: false, error: `Session ${sessionId} not found` };
  if (session.status !== 'active') return { success: false, error: 'Session is not active' };

  const role = options.role || 'editor';
  if (!PARTICIPANT_ROLES.includes(role)) {
    return { success: false, error: `Invalid role. Valid: ${PARTICIPANT_ROLES.join(', ')}` };
  }

  session.participants.push({ name: participant, role, joined_at: new Date().toISOString() });
  saveState(state, stateFile);

  return { success: true, session };
}

/**
 * Acquire a lock on an artifact.
 */
function acquireLock(artifact, owner, options = {}) {
  if (!artifact || !owner) return { success: false, error: 'artifact and owner are required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const existingLock = state.locks.find(l => l.artifact === artifact && l.released_at === null);
  if (existingLock) {
    return { success: false, error: `Artifact ${artifact} is locked by ${existingLock.owner}` };
  }

  const lock = {
    id: `LOCK-${Date.now()}`,
    artifact,
    owner,
    acquired_at: new Date().toISOString(),
    released_at: null
  };

  state.locks.push(lock);
  saveState(state, stateFile);

  return { success: true, lock };
}

/**
 * Release a lock.
 */
function releaseLock(lockId, options = {}) {
  if (!lockId) return { success: false, error: 'lockId is required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const lock = state.locks.find(l => l.id === lockId);
  if (!lock) return { success: false, error: `Lock ${lockId} not found` };

  lock.released_at = new Date().toISOString();
  saveState(state, stateFile);

  return { success: true, lock };
}

/**
 * Get collaboration status.
 */
function getStatus(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    active_sessions: state.sessions.filter(s => s.status === 'active').length,
    active_locks: state.locks.filter(l => l.released_at === null).length,
    sessions: state.sessions,
    locks: state.locks.filter(l => l.released_at === null)
  };
}

module.exports = {
  createSession,
  joinSession,
  acquireLock,
  releaseLock,
  getStatus,
  loadState,
  saveState,
  defaultState,
  PARTICIPANT_ROLES
};
