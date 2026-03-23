/**
 * risk-register.js — Risk Register Generation & Tracking (Item 29)
 *
 * Create, update, and monitor business, delivery, security,
 * and operational risks.
 *
 * Usage:
 *   node bin/lib/risk-register.js add|update|list|report [options]
 *
 * State file: .jumpstart/state/risk-register.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'risk-register.json');

const RISK_CATEGORIES = ['business', 'delivery', 'security', 'operational', 'compliance', 'technical'];
const RISK_LIKELIHOODS = ['rare', 'unlikely', 'possible', 'likely', 'almost-certain'];
const RISK_IMPACTS = ['negligible', 'minor', 'moderate', 'major', 'critical'];
const RISK_STATUSES = ['identified', 'mitigating', 'accepted', 'resolved', 'closed'];

const RISK_SCORE_MATRIX = {
  'rare': { negligible: 1, minor: 2, moderate: 3, major: 4, critical: 5 },
  'unlikely': { negligible: 2, minor: 4, moderate: 6, major: 8, critical: 10 },
  'possible': { negligible: 3, minor: 6, moderate: 9, major: 12, critical: 15 },
  'likely': { negligible: 4, minor: 8, moderate: 12, major: 16, critical: 20 },
  'almost-certain': { negligible: 5, minor: 10, moderate: 15, major: 20, critical: 25 }
};

function defaultState() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    risks: [],
    mitigations: []
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
 * Add a new risk.
 *
 * @param {object} risk - { title, category, description, likelihood, impact, owner?, mitigation? }
 * @param {object} [options]
 * @returns {object}
 */
function addRisk(risk, options = {}) {
  if (!risk || !risk.title || !risk.description) {
    return { success: false, error: 'title and description are required' };
  }

  const category = (risk.category || 'technical').toLowerCase();
  if (!RISK_CATEGORIES.includes(category)) {
    return { success: false, error: `Invalid category. Must be one of: ${RISK_CATEGORIES.join(', ')}` };
  }

  const likelihood = (risk.likelihood || 'possible').toLowerCase();
  const impact = (risk.impact || 'moderate').toLowerCase();

  if (!RISK_LIKELIHOODS.includes(likelihood)) {
    return { success: false, error: `Invalid likelihood. Must be one of: ${RISK_LIKELIHOODS.join(', ')}` };
  }
  if (!RISK_IMPACTS.includes(impact)) {
    return { success: false, error: `Invalid impact. Must be one of: ${RISK_IMPACTS.join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const score = RISK_SCORE_MATRIX[likelihood][impact];

  const newRisk = {
    id: `RISK-${(state.risks.length + 1).toString().padStart(3, '0')}`,
    title: risk.title,
    description: risk.description,
    category,
    likelihood,
    impact,
    score,
    status: 'identified',
    owner: risk.owner || null,
    mitigation: risk.mitigation || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  state.risks.push(newRisk);
  saveState(state, stateFile);

  return { success: true, risk: newRisk };
}

/**
 * Update a risk's status or details.
 *
 * @param {string} riskId
 * @param {object} updates
 * @param {object} [options]
 * @returns {object}
 */
function updateRisk(riskId, updates, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const risk = state.risks.find(r => r.id === riskId);
  if (!risk) return { success: false, error: `Risk not found: ${riskId}` };

  if (updates.status && RISK_STATUSES.includes(updates.status)) risk.status = updates.status;
  if (updates.mitigation) risk.mitigation = updates.mitigation;
  if (updates.owner) risk.owner = updates.owner;
  if (updates.likelihood && RISK_LIKELIHOODS.includes(updates.likelihood)) {
    risk.likelihood = updates.likelihood;
    risk.score = RISK_SCORE_MATRIX[risk.likelihood][risk.impact];
  }
  if (updates.impact && RISK_IMPACTS.includes(updates.impact)) {
    risk.impact = updates.impact;
    risk.score = RISK_SCORE_MATRIX[risk.likelihood][risk.impact];
  }

  risk.updated_at = new Date().toISOString();
  saveState(state, stateFile);

  return { success: true, risk };
}

/**
 * List risks with optional filter.
 *
 * @param {object} [filter]
 * @param {object} [options]
 * @returns {object}
 */
function listRisks(filter = {}, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);
  let risks = state.risks;

  if (filter.category) risks = risks.filter(r => r.category === filter.category);
  if (filter.status) risks = risks.filter(r => r.status === filter.status);
  if (filter.minScore) risks = risks.filter(r => r.score >= filter.minScore);

  return { success: true, risks, total: risks.length };
}

/**
 * Generate risk report.
 *
 * @param {object} [options]
 * @returns {object}
 */
function generateReport(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const byCategory = {};
  const byStatus = {};
  let totalScore = 0;

  for (const risk of state.risks) {
    byCategory[risk.category] = (byCategory[risk.category] || 0) + 1;
    byStatus[risk.status] = (byStatus[risk.status] || 0) + 1;
    totalScore += risk.score;
  }

  const highRisks = state.risks.filter(r => r.score >= 15);
  const unmitigated = state.risks.filter(r => !r.mitigation && r.status === 'identified');

  return {
    success: true,
    total_risks: state.risks.length,
    by_category: byCategory,
    by_status: byStatus,
    average_score: state.risks.length > 0 ? Math.round(totalScore / state.risks.length) : 0,
    high_risks: highRisks.length,
    unmitigated: unmitigated.length,
    top_risks: state.risks.sort((a, b) => b.score - a.score).slice(0, 5)
  };
}

module.exports = {
  defaultState,
  loadState,
  saveState,
  addRisk,
  updateRisk,
  listRisks,
  generateReport,
  RISK_CATEGORIES,
  RISK_LIKELIHOODS,
  RISK_IMPACTS,
  RISK_STATUSES,
  RISK_SCORE_MATRIX
};
