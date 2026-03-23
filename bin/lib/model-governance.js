/**
 * model-governance.js — Model Governance Workflows (Item 33)
 *
 * Track model choice, prompting strategy, evals, risks,
 * safety controls, and fallback models.
 *
 * Usage:
 *   node bin/lib/model-governance.js register|evaluate|report [options]
 *
 * State file: .jumpstart/state/model-governance.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'model-governance.json');

const MODEL_RISK_LEVELS = ['low', 'medium', 'high', 'critical'];
const MODEL_STATUSES = ['proposed', 'approved', 'deployed', 'deprecated', 'retired'];

function defaultState() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    models: [],
    evaluations: [],
    safety_controls: []
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
 * Register a model for governance tracking.
 *
 * @param {object} model - { name, provider, version, use_case, risk_level?, fallback? }
 * @param {object} [options]
 * @returns {object}
 */
function registerModel(model, options = {}) {
  if (!model || !model.name || !model.provider) {
    return { success: false, error: 'name and provider are required' };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const riskLevel = (model.risk_level || 'medium').toLowerCase();
  if (!MODEL_RISK_LEVELS.includes(riskLevel)) {
    return { success: false, error: `Invalid risk level. Must be one of: ${MODEL_RISK_LEVELS.join(', ')}` };
  }

  const newModel = {
    id: `MDL-${(state.models.length + 1).toString().padStart(3, '0')}`,
    name: model.name,
    provider: model.provider,
    version: model.version || 'latest',
    use_case: model.use_case || '',
    risk_level: riskLevel,
    status: 'proposed',
    fallback: model.fallback || null,
    prompting_strategy: model.prompting_strategy || null,
    safety_controls: model.safety_controls || [],
    data_handling: model.data_handling || null,
    registered_at: new Date().toISOString()
  };

  state.models.push(newModel);
  saveState(state, stateFile);

  return { success: true, model: newModel };
}

/**
 * Record a model evaluation.
 *
 * @param {string} modelId
 * @param {object} evaluation - { metrics, notes?, evaluator? }
 * @param {object} [options]
 * @returns {object}
 */
function recordEvaluation(modelId, evaluation, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const model = state.models.find(m => m.id === modelId);
  if (!model) return { success: false, error: `Model not found: ${modelId}` };

  const eval_ = {
    id: `EVAL-${Date.now().toString(36).toUpperCase()}`,
    model_id: modelId,
    metrics: evaluation.metrics || {},
    notes: evaluation.notes || '',
    evaluator: evaluation.evaluator || null,
    evaluated_at: new Date().toISOString()
  };

  state.evaluations.push(eval_);
  saveState(state, stateFile);

  return { success: true, evaluation: eval_ };
}

/**
 * Update model status.
 *
 * @param {string} modelId
 * @param {string} status
 * @param {object} [options]
 * @returns {object}
 */
function updateStatus(modelId, status, options = {}) {
  if (!MODEL_STATUSES.includes(status)) {
    return { success: false, error: `Invalid status. Must be one of: ${MODEL_STATUSES.join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const model = state.models.find(m => m.id === modelId);
  if (!model) return { success: false, error: `Model not found: ${modelId}` };

  model.status = status;
  model.status_updated_at = new Date().toISOString();
  saveState(state, stateFile);

  return { success: true, model };
}

/**
 * Generate model governance report.
 *
 * @param {object} [options]
 * @returns {object}
 */
function generateReport(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const byStatus = {};
  const byRisk = {};
  for (const m of state.models) {
    byStatus[m.status] = (byStatus[m.status] || 0) + 1;
    byRisk[m.risk_level] = (byRisk[m.risk_level] || 0) + 1;
  }

  return {
    success: true,
    total_models: state.models.length,
    total_evaluations: state.evaluations.length,
    by_status: byStatus,
    by_risk: byRisk,
    high_risk_models: state.models.filter(m => m.risk_level === 'high' || m.risk_level === 'critical'),
    models_without_fallback: state.models.filter(m => !m.fallback),
    models: state.models
  };
}

module.exports = {
  defaultState,
  loadState,
  saveState,
  registerModel,
  recordEvaluation,
  updateStatus,
  generateReport,
  MODEL_RISK_LEVELS,
  MODEL_STATUSES
};
