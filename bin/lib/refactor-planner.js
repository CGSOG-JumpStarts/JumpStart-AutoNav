/**
 * refactor-planner.js — Refactor Planner with Dependency Safety (Item 43)
 *
 * Model safe sequencing for large refactors and migrations.
 *
 * Usage:
 *   node bin/lib/refactor-planner.js plan|validate|report [options]
 *
 * State file: .jumpstart/state/refactor-plan.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'refactor-plan.json');

const REFACTOR_TYPES = ['rename', 'move', 'extract', 'inline', 'restructure', 'migrate', 'upgrade'];
const RISK_LEVELS = ['low', 'medium', 'high', 'critical'];

function defaultState() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    plans: [],
    completed: []
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
 * Create a refactor plan.
 *
 * @param {object} plan - { name, type, description, steps[], affected_files[] }
 * @param {object} [options]
 * @returns {object}
 */
function createPlan(plan, options = {}) {
  if (!plan || !plan.name || !plan.type) {
    return { success: false, error: 'name and type are required' };
  }

  if (!REFACTOR_TYPES.includes(plan.type)) {
    return { success: false, error: `Invalid type. Must be one of: ${REFACTOR_TYPES.join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const steps = (plan.steps || []).map((step, i) => ({
    order: i + 1,
    description: step.description || step,
    status: 'pending',
    dependencies: step.dependencies || [],
    risk: step.risk || 'low',
    rollback: step.rollback || null
  }));

  const newPlan = {
    id: `REF-${(state.plans.length + 1).toString().padStart(3, '0')}`,
    name: plan.name,
    type: plan.type,
    description: plan.description || '',
    steps,
    affected_files: plan.affected_files || [],
    status: 'draft',
    risk_level: steps.some(s => s.risk === 'critical') ? 'critical' : steps.some(s => s.risk === 'high') ? 'high' : 'medium',
    created_at: new Date().toISOString()
  };

  state.plans.push(newPlan);
  saveState(state, stateFile);

  return { success: true, plan: newPlan };
}

/**
 * Validate refactor plan dependencies.
 *
 * @param {string} planId
 * @param {object} [options]
 * @returns {object}
 */
function validatePlan(planId, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const plan = state.plans.find(p => p.id === planId);
  if (!plan) return { success: false, error: `Plan not found: ${planId}` };

  const issues = [];

  // Check circular dependencies
  for (const step of plan.steps) {
    for (const dep of step.dependencies) {
      const depStep = plan.steps.find(s => s.order === dep);
      if (depStep && depStep.dependencies.includes(step.order)) {
        issues.push({ type: 'circular-dependency', steps: [step.order, dep] });
      }
    }
  }

  // Check dependency ordering
  for (const step of plan.steps) {
    for (const dep of step.dependencies) {
      if (dep >= step.order) {
        issues.push({ type: 'invalid-order', step: step.order, depends_on: dep });
      }
    }
  }

  return {
    success: true,
    plan_id: planId,
    valid: issues.length === 0,
    issues,
    total_steps: plan.steps.length,
    risk_level: plan.risk_level
  };
}

/**
 * Generate refactor report.
 *
 * @param {object} [options]
 * @returns {object}
 */
function generateReport(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    total_plans: state.plans.length,
    completed: state.completed.length,
    active: state.plans.filter(p => p.status !== 'completed').length,
    by_type: state.plans.reduce((acc, p) => { acc[p.type] = (acc[p.type] || 0) + 1; return acc; }, {}),
    plans: state.plans
  };
}

module.exports = {
  defaultState,
  loadState,
  saveState,
  createPlan,
  validatePlan,
  generateReport,
  REFACTOR_TYPES,
  RISK_LEVELS
};
