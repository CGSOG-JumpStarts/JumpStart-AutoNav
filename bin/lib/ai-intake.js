/**
 * ai-intake.js — AI Use Case Intake Templates (Item 34)
 *
 * Standardize enterprise intake for business value, data sensitivity,
 * model risk, and operating model.
 *
 * Usage:
 *   node bin/lib/ai-intake.js create|list|assess [options]
 *
 * State file: .jumpstart/state/ai-intake.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'ai-intake.json');

const INTAKE_SECTIONS = ['business-value', 'data-sensitivity', 'model-risk', 'operating-model', 'ethical-review', 'compliance-requirements'];

const RISK_TIERS = [
  { tier: 1, label: 'Low Risk', description: 'No PII, internal tools, low business impact' },
  { tier: 2, label: 'Medium Risk', description: 'Some PII, customer-facing, moderate impact' },
  { tier: 3, label: 'High Risk', description: 'Sensitive data, critical decisions, high impact' },
  { tier: 4, label: 'Critical Risk', description: 'Regulated domain, autonomous decisions, severe impact' }
];

function defaultState() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    intakes: []
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
 * Create a new AI use case intake.
 *
 * @param {object} intake - { name, description, sponsor, business_value, data_types[], model_type? }
 * @param {object} [options]
 * @returns {object}
 */
function createIntake(intake, options = {}) {
  if (!intake || !intake.name || !intake.description) {
    return { success: false, error: 'name and description are required' };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  // Auto-assess risk tier
  const dataTypes = intake.data_types || [];
  let riskTier = 1;
  if (dataTypes.some(dt => ['PHI', 'PCI'].includes(dt))) riskTier = 4;
  else if (dataTypes.some(dt => ['PII', 'credentials'].includes(dt))) riskTier = 3;
  else if (dataTypes.some(dt => ['business-sensitive', 'internal'].includes(dt))) riskTier = 2;

  const newIntake = {
    id: `AI-${(state.intakes.length + 1).toString().padStart(3, '0')}`,
    name: intake.name,
    description: intake.description,
    sponsor: intake.sponsor || null,
    business_value: intake.business_value || '',
    data_types: dataTypes,
    model_type: intake.model_type || null,
    risk_tier: riskTier,
    risk_label: RISK_TIERS[riskTier - 1].label,
    status: 'draft',
    sections_completed: [],
    created_at: new Date().toISOString()
  };

  state.intakes.push(newIntake);
  saveState(state, stateFile);

  return { success: true, intake: newIntake };
}

/**
 * List intakes with optional filter.
 *
 * @param {object} [filter]
 * @param {object} [options]
 * @returns {object}
 */
function listIntakes(filter = {}, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);
  let intakes = state.intakes;

  if (filter.status) intakes = intakes.filter(i => i.status === filter.status);
  if (filter.risk_tier) intakes = intakes.filter(i => i.risk_tier === filter.risk_tier);

  return { success: true, intakes, total: intakes.length };
}

/**
 * Assess intake completeness.
 *
 * @param {string} intakeId
 * @param {object} [options]
 * @returns {object}
 */
function assessIntake(intakeId, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const intake = state.intakes.find(i => i.id === intakeId);
  if (!intake) return { success: false, error: `Intake not found: ${intakeId}` };

  const completedSections = intake.sections_completed || [];
  const missingSections = INTAKE_SECTIONS.filter(s => !completedSections.includes(s));
  const completeness = Math.round((completedSections.length / INTAKE_SECTIONS.length) * 100);

  return {
    success: true,
    intake_id: intakeId,
    completeness,
    completed_sections: completedSections,
    missing_sections: missingSections,
    risk_tier: intake.risk_tier,
    ready_for_review: completeness >= 80
  };
}

module.exports = {
  defaultState,
  loadState,
  saveState,
  createIntake,
  listIntakes,
  assessIntake,
  INTAKE_SECTIONS,
  RISK_TIERS
};
