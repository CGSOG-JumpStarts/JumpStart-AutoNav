/**
 * collaboration.ts — Real-Time Collaboration Sessions port (T4.4.3, cluster L).
 *
 * Pure-library port of `bin/lib/collaboration.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `PARTICIPANT_ROLES` (constant array)
 *   - `defaultState()` / `loadState()` / `saveState()`
 *   - `createSession(name, options?)` => CreateResult
 *   - `joinSession(sessionId, participant, options?)` => JoinResult
 *   - `acquireLock(artifact, owner, options?)` => LockResult
 *   - `releaseLock(lockId, options?)` => LockResult
 *   - `getStatus(options?)` => StatusResult
 *
 * Behavior parity:
 *   - Default state path: `.jumpstart/state/collaboration.json`.
 *   - Default participant role on join: editor.
 *   - JSON parse failures load defaults silently.
 *   - JSON shape validation rejects `__proto__` / `constructor` / `prototype`.
 *
 * @see bin/lib/collaboration.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.3
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type ParticipantRole = 'owner' | 'editor' | 'reviewer' | 'observer';

export interface Participant {
  name: string;
  role: string;
  joined_at: string;
}

export interface CollaborationSession {
  id: string;
  name: string;
  status: 'active' | 'closed';
  owner: string;
  participants: Participant[];
  artifacts: string[];
  created_at: string;
  ended_at: string | null;
}

export interface CollaborationLock {
  id: string;
  artifact: string;
  owner: string;
  acquired_at: string;
  released_at: string | null;
}

export interface CollaborationState {
  version: string;
  sessions: CollaborationSession[];
  locks: CollaborationLock[];
  last_updated: string | null;
}

export interface CreateOptions {
  stateFile?: string;
  owner?: string;
  artifacts?: string[];
}

export interface CreateResult {
  success: boolean;
  session?: CollaborationSession;
  error?: string;
}

export interface JoinOptions {
  stateFile?: string;
  role?: string;
}

export interface JoinResult {
  success: boolean;
  session?: CollaborationSession;
  error?: string;
}

export interface LockOptions {
  stateFile?: string;
}

export interface LockResult {
  success: boolean;
  lock?: CollaborationLock;
  error?: string;
}

export interface StatusOptions {
  stateFile?: string;
}

export interface StatusResult {
  success: boolean;
  active_sessions: number;
  active_locks: number;
  sessions: CollaborationSession[];
  locks: CollaborationLock[];
}

const DEFAULT_STATE_FILE = join('.jumpstart', 'state', 'collaboration.json');

export const PARTICIPANT_ROLES: ParticipantRole[] = ['owner', 'editor', 'reviewer', 'observer'];

export function defaultState(): CollaborationState {
  return {
    version: '1.0.0',
    sessions: [],
    locks: [],
    last_updated: null,
  };
}

function _safeParseState(content: string): CollaborationState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') return null;
  }
  const base = defaultState();
  return {
    ...base,
    ...obj,
    sessions: Array.isArray(obj.sessions) ? (obj.sessions as CollaborationSession[]) : [],
    locks: Array.isArray(obj.locks) ? (obj.locks as CollaborationLock[]) : [],
  };
}

export function loadState(stateFile?: string): CollaborationState {
  const fp = stateFile || DEFAULT_STATE_FILE;
  if (!existsSync(fp)) return defaultState();
  const parsed = _safeParseState(readFileSync(fp, 'utf8'));
  return parsed || defaultState();
}

export function saveState(state: CollaborationState, stateFile?: string): void {
  const fp = stateFile || DEFAULT_STATE_FILE;
  const dir = dirname(fp);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  writeFileSync(fp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/**
 * Create a collaboration session.
 */
export function createSession(name: string, options: CreateOptions = {}): CreateResult {
  if (!name) return { success: false, error: 'Session name is required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const owner = options.owner || 'system';
  const session: CollaborationSession = {
    id: `COLLAB-${Date.now()}`,
    name,
    status: 'active',
    owner,
    participants: [{ name: owner, role: 'owner', joined_at: new Date().toISOString() }],
    artifacts: options.artifacts || [],
    created_at: new Date().toISOString(),
    ended_at: null,
  };

  state.sessions.push(session);
  saveState(state, stateFile);

  return { success: true, session };
}

/**
 * Join an existing session.
 */
export function joinSession(
  sessionId: string,
  participant: string,
  options: JoinOptions = {}
): JoinResult {
  if (!sessionId || !participant) {
    return { success: false, error: 'sessionId and participant name are required' };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return { success: false, error: `Session ${sessionId} not found` };
  if (session.status !== 'active') return { success: false, error: 'Session is not active' };

  const role = options.role || 'editor';
  if (!PARTICIPANT_ROLES.includes(role as ParticipantRole)) {
    return { success: false, error: `Invalid role. Valid: ${PARTICIPANT_ROLES.join(', ')}` };
  }

  session.participants.push({ name: participant, role, joined_at: new Date().toISOString() });
  saveState(state, stateFile);

  return { success: true, session };
}

/**
 * Acquire a lock on an artifact.
 */
export function acquireLock(
  artifact: string,
  owner: string,
  options: LockOptions = {}
): LockResult {
  if (!artifact || !owner) return { success: false, error: 'artifact and owner are required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const existingLock = state.locks.find((l) => l.artifact === artifact && l.released_at === null);
  if (existingLock) {
    return {
      success: false,
      error: `Artifact ${artifact} is locked by ${existingLock.owner}`,
    };
  }

  const lock: CollaborationLock = {
    id: `LOCK-${Date.now()}`,
    artifact,
    owner,
    acquired_at: new Date().toISOString(),
    released_at: null,
  };

  state.locks.push(lock);
  saveState(state, stateFile);

  return { success: true, lock };
}

/**
 * Release a lock.
 */
export function releaseLock(lockId: string, options: LockOptions = {}): LockResult {
  if (!lockId) return { success: false, error: 'lockId is required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const lock = state.locks.find((l) => l.id === lockId);
  if (!lock) return { success: false, error: `Lock ${lockId} not found` };

  lock.released_at = new Date().toISOString();
  saveState(state, stateFile);

  return { success: true, lock };
}

/**
 * Get collaboration status.
 */
export function getStatus(options: StatusOptions = {}): StatusResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    active_sessions: state.sessions.filter((s) => s.status === 'active').length,
    active_locks: state.locks.filter((l) => l.released_at === null).length,
    sessions: state.sessions,
    locks: state.locks.filter((l) => l.released_at === null),
  };
}
