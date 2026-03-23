/**
 * data-classification.js — Data Classification & Handling Controls (Item 30)
 *
 * Tag systems and features by public/internal/confidential/restricted
 * and adapt prompts and policies.
 *
 * Usage:
 *   node bin/lib/data-classification.js classify|check|report [options]
 *
 * State file: .jumpstart/state/data-classification.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'data-classification.json');

const CLASSIFICATION_LEVELS = ['public', 'internal', 'confidential', 'restricted'];

const HANDLING_REQUIREMENTS = {
  public: { encryption_at_rest: false, encryption_in_transit: false, access_logging: false, retention_policy: false },
  internal: { encryption_at_rest: false, encryption_in_transit: true, access_logging: false, retention_policy: true },
  confidential: { encryption_at_rest: true, encryption_in_transit: true, access_logging: true, retention_policy: true },
  restricted: { encryption_at_rest: true, encryption_in_transit: true, access_logging: true, retention_policy: true, mfa_required: true, data_masking: true }
};

const DATA_TYPE_DEFAULTS = {
  PII: 'confidential',
  PHI: 'restricted',
  PCI: 'restricted',
  credentials: 'restricted',
  'business-sensitive': 'confidential',
  'public-content': 'public',
  'internal-docs': 'internal'
};

function defaultState() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    classifications: [],
    data_assets: []
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
 * Classify a system or feature.
 *
 * @param {object} asset - { name, type, data_types[], description? }
 * @param {object} [options]
 * @returns {object}
 */
function classifyAsset(asset, options = {}) {
  if (!asset || !asset.name) {
    return { success: false, error: 'asset.name is required' };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  // Auto-classify based on data types
  let level = 'public';
  const dataTypes = asset.data_types || [];
  for (const dt of dataTypes) {
    const defaultLevel = DATA_TYPE_DEFAULTS[dt];
    if (defaultLevel) {
      const idx = CLASSIFICATION_LEVELS.indexOf(defaultLevel);
      const currentIdx = CLASSIFICATION_LEVELS.indexOf(level);
      if (idx > currentIdx) level = defaultLevel;
    }
  }

  // Allow override
  if (asset.classification && CLASSIFICATION_LEVELS.includes(asset.classification)) {
    level = asset.classification;
  }

  const classification = {
    id: `DC-${(state.data_assets.length + 1).toString().padStart(3, '0')}`,
    name: asset.name,
    type: asset.type || 'system',
    data_types: dataTypes,
    classification: level,
    handling: HANDLING_REQUIREMENTS[level],
    description: asset.description || '',
    classified_at: new Date().toISOString()
  };

  state.data_assets.push(classification);
  saveState(state, stateFile);

  return { success: true, asset: classification };
}

/**
 * Check classification compliance.
 *
 * @param {object} [options]
 * @returns {object}
 */
function checkCompliance(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const violations = [];
  for (const asset of state.data_assets) {
    const requirements = HANDLING_REQUIREMENTS[asset.classification];
    if (!requirements) continue;

    if (requirements.encryption_at_rest && !asset.encryption_at_rest_verified) {
      violations.push({ asset: asset.name, requirement: 'encryption_at_rest', classification: asset.classification });
    }
    if (requirements.encryption_in_transit && !asset.encryption_in_transit_verified) {
      violations.push({ asset: asset.name, requirement: 'encryption_in_transit', classification: asset.classification });
    }
  }

  return {
    success: true,
    total_assets: state.data_assets.length,
    violations: violations.length,
    compliant: violations.length === 0,
    findings: violations
  };
}

/**
 * Generate classification report.
 *
 * @param {object} [options]
 * @returns {object}
 */
function generateReport(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const byLevel = {};
  for (const level of CLASSIFICATION_LEVELS) {
    byLevel[level] = state.data_assets.filter(a => a.classification === level).length;
  }

  return {
    success: true,
    total_assets: state.data_assets.length,
    by_level: byLevel,
    restricted_assets: state.data_assets.filter(a => a.classification === 'restricted'),
    confidential_assets: state.data_assets.filter(a => a.classification === 'confidential'),
    assets: state.data_assets
  };
}

module.exports = {
  defaultState,
  loadState,
  saveState,
  classifyAsset,
  checkCompliance,
  generateReport,
  CLASSIFICATION_LEVELS,
  HANDLING_REQUIREMENTS,
  DATA_TYPE_DEFAULTS
};
