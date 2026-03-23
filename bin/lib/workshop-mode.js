/**
 * workshop-mode.js — Live Workshop Mode (Item 64)
 *
 * Facilitate discovery sessions and convert outputs directly
 * into challenger brief, product brief, and PRD.
 *
 * Usage:
 *   node bin/lib/workshop-mode.js start|capture|convert|status [options]
 *
 * State file: .jumpstart/state/workshop.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'workshop.json');

const WORKSHOP_TYPES = ['discovery', 'ideation', 'refinement', 'retrospective'];
const OUTPUT_ARTIFACTS = ['challenger-brief', 'product-brief', 'prd'];

function defaultState() {
  return {
    version: '1.0.0',
    sessions: [],
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
 * Start a new workshop session.
 */
function startSession(name, options = {}) {
  if (!name) return { success: false, error: 'Session name is required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const session = {
    id: `WS-${Date.now()}`,
    name,
    type: options.type || 'discovery',
    status: 'active',
    facilitator: options.facilitator || null,
    participants: options.participants || [],
    captures: [],
    created_at: new Date().toISOString(),
    ended_at: null
  };

  if (!WORKSHOP_TYPES.includes(session.type)) {
    return { success: false, error: `Unknown type: ${session.type}. Valid: ${WORKSHOP_TYPES.join(', ')}` };
  }

  state.sessions.push(session);
  saveState(state, stateFile);

  return { success: true, session };
}

/**
 * Capture a workshop insight or decision.
 */
function captureInsight(sessionId, text, options = {}) {
  if (!sessionId || !text) return { success: false, error: 'sessionId and text are required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const session = state.sessions.find(s => s.id === sessionId);
  if (!session) return { success: false, error: `Session ${sessionId} not found` };

  const capture = {
    id: `CAP-${Date.now()}`,
    text,
    category: options.category || 'insight',
    author: options.author || 'anonymous',
    timestamp: new Date().toISOString()
  };

  session.captures.push(capture);
  saveState(state, stateFile);

  return { success: true, capture };
}

/**
 * Convert session captures to artifact outline.
 */
function convertToArtifact(sessionId, artifactType, options = {}) {
  if (!sessionId || !artifactType) return { success: false, error: 'sessionId and artifactType are required' };
  if (!OUTPUT_ARTIFACTS.includes(artifactType)) {
    return { success: false, error: `Unknown artifact type. Valid: ${OUTPUT_ARTIFACTS.join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const session = state.sessions.find(s => s.id === sessionId);
  if (!session) return { success: false, error: `Session ${sessionId} not found` };

  const sections = session.captures.reduce((acc, cap) => {
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
    captures_used: session.captures.length
  };
}

/**
 * Get session status.
 */
function getSessionStatus(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    total_sessions: state.sessions.length,
    active: state.sessions.filter(s => s.status === 'active').length,
    sessions: state.sessions.map(s => ({
      id: s.id,
      name: s.name,
      type: s.type,
      status: s.status,
      captures: s.captures.length
    }))
  };
}

module.exports = {
  startSession,
  captureInsight,
  convertToArtifact,
  getSessionStatus,
  loadState,
  saveState,
  defaultState,
  WORKSHOP_TYPES,
  OUTPUT_ARTIFACTS
};
