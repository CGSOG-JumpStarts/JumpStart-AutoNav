/**
 * evidence-collector.js — Evidence Collection Automation (Item 25)
 *
 * Auto-package screenshots, logs, tests, policy checks,
 * architecture diagrams, and approvals for audits.
 *
 * Usage:
 *   node bin/lib/evidence-collector.js collect|package|status [options]
 *
 * Output: .jumpstart/evidence/
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_OUTPUT_DIR = path.join('.jumpstart', 'evidence');
const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'evidence.json');

const EVIDENCE_TYPES = ['test-results', 'approval-records', 'policy-checks', 'architecture-diagrams',
  'security-scans', 'coverage-reports', 'audit-logs', 'screenshots', 'compliance-checks'];

/**
 * Default evidence state.
 * @returns {object}
 */
function defaultState() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    collections: [],
    evidence_items: []
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
 * Collect evidence from the project.
 *
 * @param {string} root - Project root.
 * @param {object} [options]
 * @returns {object}
 */
function collectEvidence(root, options = {}) {
  const stateFile = options.stateFile || path.join(root, DEFAULT_STATE_FILE);
  const state = loadState(stateFile);
  const items = [];

  // Collect approval records
  const approvalFile = path.join(root, '.jumpstart', 'state', 'role-approvals.json');
  if (fs.existsSync(approvalFile)) {
    items.push({ type: 'approval-records', source: approvalFile, collected_at: new Date().toISOString() });
  }

  // Collect policy check results
  const policyFile = path.join(root, '.jumpstart', 'policies.json');
  if (fs.existsSync(policyFile)) {
    items.push({ type: 'policy-checks', source: policyFile, collected_at: new Date().toISOString() });
  }

  // Collect spec artifacts as architecture evidence
  const specsDir = path.join(root, 'specs');
  if (fs.existsSync(specsDir)) {
    const specs = fs.readdirSync(specsDir).filter(f => f.endsWith('.md'));
    for (const spec of specs) {
      items.push({ type: 'architecture-diagrams', source: path.join('specs', spec), collected_at: new Date().toISOString() });
    }
  }

  // Collect test results if available
  const testDirs = ['tests', 'test', '__tests__'];
  for (const td of testDirs) {
    const testDir = path.join(root, td);
    if (fs.existsSync(testDir)) {
      items.push({ type: 'test-results', source: td, collected_at: new Date().toISOString() });
      break;
    }
  }

  state.evidence_items.push(...items);
  state.collections.push({
    id: `ev-${Date.now()}`,
    collected_at: new Date().toISOString(),
    items_count: items.length,
    types: [...new Set(items.map(i => i.type))]
  });

  saveState(state, stateFile);

  return {
    success: true,
    items_collected: items.length,
    types: [...new Set(items.map(i => i.type))],
    collection_id: state.collections[state.collections.length - 1].id
  };
}

/**
 * Package evidence into an audit-ready bundle.
 *
 * @param {string} root - Project root.
 * @param {object} [options]
 * @returns {object}
 */
function packageEvidence(root, options = {}) {
  const stateFile = options.stateFile || path.join(root, DEFAULT_STATE_FILE);
  const state = loadState(stateFile);
  const outputDir = options.outputDir || path.join(root, DEFAULT_OUTPUT_DIR);

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const manifest = {
    package_id: `audit-${Date.now()}`,
    created_at: new Date().toISOString(),
    project_root: root,
    total_items: state.evidence_items.length,
    types: [...new Set(state.evidence_items.map(i => i.type))],
    collections: state.collections.length,
    items: state.evidence_items
  };

  const manifestPath = path.join(outputDir, 'audit-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  return {
    success: true,
    package_id: manifest.package_id,
    output: manifestPath,
    total_items: manifest.total_items,
    types: manifest.types
  };
}

/**
 * Get evidence collection status.
 *
 * @param {object} [options]
 * @returns {object}
 */
function getStatus(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    total_items: state.evidence_items.length,
    collections: state.collections.length,
    types: [...new Set(state.evidence_items.map(i => i.type))],
    last_collection: state.collections.length > 0
      ? state.collections[state.collections.length - 1]
      : null
  };
}

module.exports = {
  defaultState,
  loadState,
  saveState,
  collectEvidence,
  packageEvidence,
  getStatus,
  EVIDENCE_TYPES
};
