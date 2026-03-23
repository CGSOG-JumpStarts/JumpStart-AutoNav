/**
 * promptless-mode.js — Promptless Mode for Less Technical Users (Item 77)
 *
 * Wizard-driven workflows that still produce rigorous outputs.
 *
 * Usage:
 *   node bin/lib/promptless-mode.js start|step|status [options]
 *
 * State file: .jumpstart/state/promptless.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'promptless.json');

const WIZARDS = ['new-project', 'add-feature', 'review-spec', 'estimate', 'handoff'];

const WIZARD_STEPS = {
  'new-project': [
    { id: 'name', prompt: 'What is your project name?', type: 'text' },
    { id: 'domain', prompt: 'What industry is this for?', type: 'select', options: ['healthcare', 'fintech', 'retail', 'manufacturing', 'public-sector', 'general'] },
    { id: 'type', prompt: 'Is this a new or existing project?', type: 'select', options: ['greenfield', 'brownfield'] },
    { id: 'team_size', prompt: 'How large is your team?', type: 'select', options: ['1-3', '4-10', '10+'] }
  ],
  'add-feature': [
    { id: 'feature_name', prompt: 'What feature do you want to add?', type: 'text' },
    { id: 'priority', prompt: 'How urgent is this?', type: 'select', options: ['must-have', 'should-have', 'nice-to-have'] },
    { id: 'complexity', prompt: 'How complex do you think it is?', type: 'select', options: ['simple', 'moderate', 'complex'] }
  ],
  'review-spec': [
    { id: 'spec_file', prompt: 'Which specification file?', type: 'text' },
    { id: 'review_type', prompt: 'What kind of review?', type: 'select', options: ['completeness', 'quality', 'ambiguity'] }
  ]
};

function defaultState() {
  return { version: '1.0.0', sessions: [], last_updated: null };
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

function startWizard(wizardType, options = {}) {
  if (!WIZARDS.includes(wizardType)) {
    return { success: false, error: `Unknown wizard: ${wizardType}. Valid: ${WIZARDS.join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const session = {
    id: `WIZ-${Date.now()}`,
    wizard: wizardType,
    status: 'active',
    current_step: 0,
    steps: (WIZARD_STEPS[wizardType] || []).map(s => ({ ...s, answer: null })),
    created_at: new Date().toISOString()
  };

  state.sessions.push(session);
  saveState(state, stateFile);

  return { success: true, session, next_step: session.steps[0] || null };
}

function answerStep(sessionId, answer, options = {}) {
  if (!sessionId) return { success: false, error: 'sessionId is required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const session = state.sessions.find(s => s.id === sessionId);
  if (!session) return { success: false, error: `Session ${sessionId} not found` };

  if (session.current_step >= session.steps.length) {
    return { success: false, error: 'Wizard is already complete' };
  }

  session.steps[session.current_step].answer = answer;
  session.current_step++;

  const complete = session.current_step >= session.steps.length;
  if (complete) session.status = 'complete';

  saveState(state, stateFile);

  return {
    success: true,
    complete,
    next_step: complete ? null : session.steps[session.current_step],
    answers: Object.fromEntries(session.steps.filter(s => s.answer !== null).map(s => [s.id, s.answer]))
  };
}

function getWizardStatus(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    available_wizards: WIZARDS,
    sessions: state.sessions.map(s => ({
      id: s.id, wizard: s.wizard, status: s.status,
      progress: `${s.current_step}/${s.steps.length}`
    }))
  };
}

module.exports = {
  startWizard, answerStep, getWizardStatus,
  loadState, saveState, defaultState,
  WIZARDS, WIZARD_STEPS
};
