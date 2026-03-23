/**
 * environment-promotion.js — Environment Promotion Governance (Item 22)
 *
 * Track readiness from dev to test to stage to prod with
 * quality gates tied to environments.
 *
 * Usage:
 *   node bin/lib/environment-promotion.js promote|status|gate [options]
 *
 * State file: .jumpstart/state/environment-promotion.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'environment-promotion.json');

const ENVIRONMENTS = ['dev', 'test', 'staging', 'prod'];

const DEFAULT_GATES = {
  dev: ['unit-tests', 'lint', 'build'],
  test: ['integration-tests', 'coverage-threshold', 'security-scan'],
  staging: ['e2e-tests', 'performance-tests', 'approval-required'],
  prod: ['release-readiness', 'change-advisory', 'final-approval']
};

/**
 * Default promotion state.
 * @returns {object}
 */
function defaultState() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    current_environment: 'dev',
    environments: ENVIRONMENTS.map(env => ({
      name: env,
      status: env === 'dev' ? 'active' : 'pending',
      gates: (DEFAULT_GATES[env] || []).map(g => ({ name: g, passed: false, checked_at: null })),
      promoted_at: null,
      promoted_by: null
    })),
    promotion_history: []
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
 * Check if an environment's gates are all passed.
 *
 * @param {string} environment
 * @param {object} [options]
 * @returns {object}
 */
function checkGates(environment, options = {}) {
  if (!ENVIRONMENTS.includes(environment)) {
    return { success: false, error: `Invalid environment: ${environment}. Must be one of: ${ENVIRONMENTS.join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);
  const env = state.environments.find(e => e.name === environment);
  if (!env) return { success: false, error: `Environment not found: ${environment}` };

  const passed = env.gates.filter(g => g.passed);
  const failed = env.gates.filter(g => !g.passed);

  return {
    success: true,
    environment,
    all_passed: failed.length === 0,
    passed: passed.map(g => g.name),
    pending: failed.map(g => g.name),
    total: env.gates.length,
    ready_to_promote: failed.length === 0
  };
}

/**
 * Record a gate check result.
 *
 * @param {string} environment
 * @param {string} gateName
 * @param {boolean} passed
 * @param {object} [options]
 * @returns {object}
 */
function recordGateResult(environment, gateName, passed, options = {}) {
  if (!ENVIRONMENTS.includes(environment)) {
    return { success: false, error: `Invalid environment: ${environment}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);
  const env = state.environments.find(e => e.name === environment);
  if (!env) return { success: false, error: `Environment not found: ${environment}` };

  const gate = env.gates.find(g => g.name === gateName);
  if (!gate) return { success: false, error: `Gate not found: ${gateName}` };

  gate.passed = passed;
  gate.checked_at = new Date().toISOString();
  saveState(state, stateFile);

  return { success: true, environment, gate: gateName, passed, checked_at: gate.checked_at };
}

/**
 * Promote to the next environment.
 *
 * @param {string} targetEnv
 * @param {object} [options]
 * @returns {object}
 */
function promote(targetEnv, options = {}) {
  if (!ENVIRONMENTS.includes(targetEnv)) {
    return { success: false, error: `Invalid environment: ${targetEnv}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const targetIdx = ENVIRONMENTS.indexOf(targetEnv);
  const currentIdx = ENVIRONMENTS.indexOf(state.current_environment);

  if (targetIdx <= currentIdx) {
    return { success: false, error: `Cannot promote backward from ${state.current_environment} to ${targetEnv}` };
  }

  // Check all intermediate gates
  for (let i = currentIdx; i < targetIdx; i++) {
    const env = state.environments.find(e => e.name === ENVIRONMENTS[i]);
    if (env) {
      const pending = env.gates.filter(g => !g.passed);
      if (pending.length > 0) {
        return {
          success: false,
          error: `Gates not passed for ${ENVIRONMENTS[i]}: ${pending.map(g => g.name).join(', ')}`
        };
      }
    }
  }

  state.current_environment = targetEnv;
  const envObj = state.environments.find(e => e.name === targetEnv);
  if (envObj) {
    envObj.status = 'active';
    envObj.promoted_at = new Date().toISOString();
    envObj.promoted_by = options.promotedBy || null;
  }

  state.promotion_history.push({
    from: ENVIRONMENTS[currentIdx],
    to: targetEnv,
    promoted_at: new Date().toISOString(),
    promoted_by: options.promotedBy || null
  });

  saveState(state, stateFile);

  return {
    success: true,
    from: ENVIRONMENTS[currentIdx],
    to: targetEnv,
    current_environment: state.current_environment
  };
}

/**
 * Get promotion status.
 *
 * @param {object} [options]
 * @returns {object}
 */
function getStatus(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    current_environment: state.current_environment,
    environments: state.environments.map(e => ({
      name: e.name,
      status: e.status,
      gates_passed: e.gates.filter(g => g.passed).length,
      gates_total: e.gates.length,
      ready: e.gates.every(g => g.passed)
    })),
    promotion_history: state.promotion_history
  };
}

module.exports = {
  defaultState,
  loadState,
  saveState,
  checkGates,
  recordGateResult,
  promote,
  getStatus,
  ENVIRONMENTS,
  DEFAULT_GATES
};
