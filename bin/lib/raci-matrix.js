/**
 * raci-matrix.js — RACI-Aware Approvals (Item 23)
 *
 * Define who is Responsible, Accountable, Consulted, Informed
 * for each phase and artifact.
 *
 * Usage:
 *   node bin/lib/raci-matrix.js define|check|report [options]
 *
 * State file: .jumpstart/state/raci-matrix.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'raci-matrix.json');

const RACI_ROLES = ['responsible', 'accountable', 'consulted', 'informed'];

const DEFAULT_PHASES = ['scout', 'challenger', 'analyst', 'pm', 'architect', 'developer'];

const DEFAULT_ARTIFACTS = [
  'specs/codebase-context.md',
  'specs/challenger-brief.md',
  'specs/product-brief.md',
  'specs/prd.md',
  'specs/architecture.md',
  'specs/implementation-plan.md'
];

/**
 * Default RACI state.
 * @returns {object}
 */
function defaultState() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    assignments: {},
    stakeholders: []
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
 * Define a RACI assignment for an artifact/phase.
 *
 * @param {string} artifact - Artifact or phase identifier.
 * @param {object} assignment - { responsible, accountable, consulted[], informed[] }
 * @param {object} [options]
 * @returns {object}
 */
function defineAssignment(artifact, assignment, options = {}) {
  if (!artifact) return { success: false, error: 'artifact is required' };
  if (!assignment || !assignment.accountable) {
    return { success: false, error: 'assignment.accountable is required' };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  state.assignments[artifact] = {
    artifact,
    responsible: assignment.responsible || assignment.accountable,
    accountable: assignment.accountable,
    consulted: Array.isArray(assignment.consulted) ? assignment.consulted : [],
    informed: Array.isArray(assignment.informed) ? assignment.informed : [],
    defined_at: new Date().toISOString()
  };

  // Track stakeholders
  const allPeople = [
    assignment.responsible,
    assignment.accountable,
    ...(assignment.consulted || []),
    ...(assignment.informed || [])
  ].filter(Boolean);

  for (const person of allPeople) {
    if (!state.stakeholders.includes(person)) {
      state.stakeholders.push(person);
    }
  }

  saveState(state, stateFile);

  return { success: true, artifact, assignment: state.assignments[artifact] };
}

/**
 * Check RACI compliance for approval actions.
 *
 * @param {string} artifact
 * @param {string} actor - Who is performing the action.
 * @param {string} action - 'approve' | 'review' | 'inform'
 * @param {object} [options]
 * @returns {object}
 */
function checkPermission(artifact, actor, action, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const assignment = state.assignments[artifact];
  if (!assignment) {
    return { success: true, allowed: true, reason: 'No RACI assignment defined — unrestricted' };
  }

  if (action === 'approve') {
    const allowed = assignment.accountable === actor || assignment.responsible === actor;
    return {
      success: true,
      allowed,
      reason: allowed
        ? `${actor} is ${assignment.accountable === actor ? 'Accountable' : 'Responsible'}`
        : `${actor} is not Responsible or Accountable. Need: ${assignment.accountable}`
    };
  }

  if (action === 'review') {
    const allowed = assignment.consulted.includes(actor) ||
                    assignment.responsible === actor ||
                    assignment.accountable === actor;
    return { success: true, allowed, reason: allowed ? 'Actor has review rights' : 'Actor is not in C/R/A' };
  }

  return { success: true, allowed: true, reason: 'Action permitted' };
}

/**
 * Generate a RACI matrix report.
 *
 * @param {object} [options]
 * @returns {object}
 */
function generateReport(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const matrix = Object.entries(state.assignments).map(([artifact, a]) => ({
    artifact,
    R: a.responsible,
    A: a.accountable,
    C: a.consulted.join(', '),
    I: a.informed.join(', ')
  }));

  const gaps = DEFAULT_ARTIFACTS.filter(a => !state.assignments[a]);

  return {
    success: true,
    matrix,
    stakeholders: state.stakeholders,
    total_assignments: matrix.length,
    gaps,
    coverage: DEFAULT_ARTIFACTS.length > 0
      ? Math.round(((DEFAULT_ARTIFACTS.length - gaps.length) / DEFAULT_ARTIFACTS.length) * 100)
      : 100
  };
}

module.exports = {
  defaultState,
  loadState,
  saveState,
  defineAssignment,
  checkPermission,
  generateReport,
  RACI_ROLES,
  DEFAULT_PHASES,
  DEFAULT_ARTIFACTS
};
