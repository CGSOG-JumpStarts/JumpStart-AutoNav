/**
 * dependency-upgrade.js — Dependency Upgrade Autopilot (Item 51)
 *
 * Plan, test, patch, and validate framework/library upgrades
 * in a governed manner.
 *
 * Usage:
 *   node bin/lib/dependency-upgrade.js scan|plan|report [options]
 *
 * State file: .jumpstart/state/dependency-upgrades.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'dependency-upgrades.json');

const UPGRADE_TYPES = ['patch', 'minor', 'major'];
const RISK_BY_TYPE = { patch: 'low', minor: 'medium', major: 'high' };

function defaultState() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    scans: [],
    upgrade_plans: []
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
 * Scan for available dependency upgrades.
 *
 * @param {string} root - Project root.
 * @param {object} [options]
 * @returns {object}
 */
function scanUpgrades(root, options = {}) {
  const packageFile = path.join(root, 'package.json');
  if (!fs.existsSync(packageFile)) {
    return { success: false, error: 'package.json not found' };
  }

  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8')); }
  catch { return { success: false, error: 'Invalid package.json' }; }

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const candidates = [];

  for (const [name, version] of Object.entries(deps)) {
    const clean = version.replace(/^[\^~>=<]/, '');
    candidates.push({
      name,
      current_version: clean,
      specified: version,
      type: version.startsWith('^') ? 'minor-range' : version.startsWith('~') ? 'patch-range' : 'fixed',
      is_dev: !!(pkg.devDependencies && pkg.devDependencies[name])
    });
  }

  const stateFile = options.stateFile || path.join(root, DEFAULT_STATE_FILE);
  const state = loadState(stateFile);
  state.scans.push({
    scanned_at: new Date().toISOString(),
    total: candidates.length
  });
  saveState(state, stateFile);

  return { success: true, dependencies: candidates, total: candidates.length };
}

/**
 * Create an upgrade plan.
 *
 * @param {object} plan - { name, upgrades[] }
 * @param {object} [options]
 * @returns {object}
 */
function createUpgradePlan(plan, options = {}) {
  if (!plan || !plan.name) return { success: false, error: 'plan.name is required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const upgradePlan = {
    id: `UPG-${(state.upgrade_plans.length + 1).toString().padStart(3, '0')}`,
    name: plan.name,
    upgrades: (plan.upgrades || []).map(u => ({
      package: u.package || u.name,
      from: u.from || u.current_version,
      to: u.to || u.target_version,
      type: u.type || 'minor',
      risk: RISK_BY_TYPE[u.type] || 'medium',
      status: 'planned',
      test_result: null
    })),
    status: 'draft',
    created_at: new Date().toISOString()
  };

  state.upgrade_plans.push(upgradePlan);
  saveState(state, stateFile);

  return { success: true, plan: upgradePlan };
}

/**
 * Generate upgrade report.
 *
 * @param {object} [options]
 * @returns {object}
 */
function generateReport(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    total_plans: state.upgrade_plans.length,
    total_scans: state.scans.length,
    plans: state.upgrade_plans,
    last_scan: state.scans.length > 0 ? state.scans[state.scans.length - 1] : null
  };
}

module.exports = {
  defaultState,
  loadState,
  saveState,
  scanUpgrades,
  createUpgradePlan,
  generateReport,
  UPGRADE_TYPES,
  RISK_BY_TYPE
};
