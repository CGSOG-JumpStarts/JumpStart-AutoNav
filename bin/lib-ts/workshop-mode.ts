/**
 * workshop-mode.ts — live workshop mode port (T4.3.3, cluster H).
 *
 * Pure-library port of `bin/lib/workshop-mode.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `WORKSHOP_TYPES` (constant array)
 *   - `OUTPUT_ARTIFACTS` (constant array)
 *   - `defaultState()` => WorkshopState
 *   - `loadState(stateFile?)` => WorkshopState
 *   - `saveState(state, stateFile?)`
 *   - `startSession(name, options?)` => StartSessionResult
 *   - `captureInsight(sessionId, text, options?)` => CaptureResult
 *   - `convertToArtifact(sessionId, artifactType, options?)` =>
 *     ConvertArtifactResult
 *   - `getSessionStatus(options?)` => SessionStatusResult
 *
 * Behavior parity:
 *   - Default state path: `.jumpstart/state/workshop.json`.
 *   - Session ID format: `WS-<unix-ms>`. Capture ID: `CAP-<unix-ms>`.
 *   - Default workshop type: `discovery` (matched against
 *     `WORKSHOP_TYPES`).
 *   - JSON parse failures load default state silently.
 *
 * @see bin/lib/workshop-mode.js (legacy reference)
 * @see specs/implementation-plan.md T4.3.3
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Public types

export type WorkshopType = 'discovery' | 'ideation' | 'refinement' | 'retrospective';

export type OutputArtifact = 'challenger-brief' | 'product-brief' | 'prd';

export interface WorkshopCapture {
  id: string;
  text: string;
  category: string;
  author: string;
  timestamp: string;
}

export interface WorkshopSession {
  id: string;
  name: string;
  type: string;
  status: 'active' | 'closed';
  facilitator: string | null;
  participants: string[];
  captures: WorkshopCapture[];
  created_at: string;
  ended_at: string | null;
}

export interface WorkshopState {
  version: string;
  sessions: WorkshopSession[];
  last_updated: string | null;
}

export interface StartSessionOptions {
  stateFile?: string;
  type?: string;
  facilitator?: string | null;
  participants?: string[];
}

export interface StartSessionResult {
  success: boolean;
  session?: WorkshopSession;
  error?: string;
}

export interface CaptureOptions {
  stateFile?: string;
  category?: string;
  author?: string;
}

export interface CaptureResult {
  success: boolean;
  capture?: WorkshopCapture;
  error?: string;
}

export interface ConvertArtifactOptions {
  stateFile?: string;
}

export interface ConvertArtifactResult {
  success: boolean;
  artifact_type?: string;
  session_name?: string;
  sections?: Record<string, string[]>;
  captures_used?: number;
  error?: string;
}

export interface SessionStatusOptions {
  stateFile?: string;
}

export interface SessionStatusEntry {
  id: string;
  name: string;
  type: string;
  status: string;
  captures: number;
}

export interface SessionStatusResult {
  success: boolean;
  total_sessions: number;
  active: number;
  sessions: SessionStatusEntry[];
}

// Constants (verbatim from legacy)

const DEFAULT_STATE_FILE = join('.jumpstart', 'state', 'workshop.json');

export const WORKSHOP_TYPES: WorkshopType[] = [
  'discovery',
  'ideation',
  'refinement',
  'retrospective',
];

export const OUTPUT_ARTIFACTS: OutputArtifact[] = ['challenger-brief', 'product-brief', 'prd'];

// Implementation

/** Default state structure. */
export function defaultState(): WorkshopState {
  return {
    version: '1.0.0',
    sessions: [],
    last_updated: null,
  };
}

/** Load state from disk; defaults on missing/corrupt. */
export function loadState(stateFile?: string): WorkshopState {
  const fp = stateFile || DEFAULT_STATE_FILE;
  if (!existsSync(fp)) return defaultState();
  try {
    return JSON.parse(readFileSync(fp, 'utf8')) as WorkshopState;
  } catch {
    return defaultState();
  }
}

/** Persist state to disk. Auto-creates parent dir, stamps last_updated. */
export function saveState(state: WorkshopState, stateFile?: string): void {
  const fp = stateFile || DEFAULT_STATE_FILE;
  const dir = dirname(fp);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  writeFileSync(fp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/** Start a new workshop session. */
export function startSession(name: string, options: StartSessionOptions = {}): StartSessionResult {
  if (!name) return { success: false, error: 'Session name is required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const session: WorkshopSession = {
    id: `WS-${Date.now()}`,
    name,
    type: options.type || 'discovery',
    status: 'active',
    facilitator: options.facilitator || null,
    participants: options.participants || [],
    captures: [],
    created_at: new Date().toISOString(),
    ended_at: null,
  };

  if (!WORKSHOP_TYPES.includes(session.type as WorkshopType)) {
    return {
      success: false,
      error: `Unknown type: ${session.type}. Valid: ${WORKSHOP_TYPES.join(', ')}`,
    };
  }

  state.sessions.push(session);
  saveState(state, stateFile);

  return { success: true, session };
}

/** Capture a workshop insight or decision. */
export function captureInsight(
  sessionId: string,
  text: string,
  options: CaptureOptions = {}
): CaptureResult {
  if (!sessionId || !text) return { success: false, error: 'sessionId and text are required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return { success: false, error: `Session ${sessionId} not found` };

  const capture: WorkshopCapture = {
    id: `CAP-${Date.now()}`,
    text,
    category: options.category || 'insight',
    author: options.author || 'anonymous',
    timestamp: new Date().toISOString(),
  };

  session.captures.push(capture);
  saveState(state, stateFile);

  return { success: true, capture };
}

/** Convert session captures to an artifact outline. */
export function convertToArtifact(
  sessionId: string,
  artifactType: string,
  options: ConvertArtifactOptions = {}
): ConvertArtifactResult {
  if (!sessionId || !artifactType) {
    return { success: false, error: 'sessionId and artifactType are required' };
  }
  if (!OUTPUT_ARTIFACTS.includes(artifactType as OutputArtifact)) {
    return {
      success: false,
      error: `Unknown artifact type. Valid: ${OUTPUT_ARTIFACTS.join(', ')}`,
    };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return { success: false, error: `Session ${sessionId} not found` };

  const sections = session.captures.reduce<Record<string, string[]>>((acc, cap) => {
    const cat = cap.category || 'general';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(cap.text);
    return acc;
  }, {});

  return {
    success: true,
    artifact_type: artifactType,
    session_name: session.name,
    sections,
    captures_used: session.captures.length,
  };
}

/** Snapshot of total/active sessions and per-session metadata. */
export function getSessionStatus(options: SessionStatusOptions = {}): SessionStatusResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    total_sessions: state.sessions.length,
    active: state.sessions.filter((s) => s.status === 'active').length,
    sessions: state.sessions.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      status: s.status,
      captures: s.captures.length,
    })),
  };
}
