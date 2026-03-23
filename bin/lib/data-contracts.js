/**
 * data-contracts.js — Data Contract Governance (Item 84)
 *
 * Schema evolution, versioning, lineage, and producer-consumer compatibility.
 *
 * Usage:
 *   node bin/lib/data-contracts.js register|validate|lineage|report [options]
 *
 * State file: .jumpstart/state/data-contracts.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'data-contracts.json');

const COMPATIBILITY_MODES = ['backward', 'forward', 'full', 'none'];

function defaultState() {
  return { version: '1.0.0', contracts: [], lineage: [], last_updated: null };
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

function registerContract(name, schema, options = {}) {
  if (!name || !schema) return { success: false, error: 'name and schema are required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const contract = {
    id: `DC-${Date.now()}`,
    name,
    version: options.version || '1.0.0',
    schema,
    producer: options.producer || null,
    consumers: options.consumers || [],
    compatibility: options.compatibility || 'backward',
    created_at: new Date().toISOString()
  };

  state.contracts.push(contract);
  saveState(state, stateFile);

  return { success: true, contract };
}

function validateCompatibility(contractId, newSchema, options = {}) {
  if (!contractId || !newSchema) return { success: false, error: 'contractId and newSchema are required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const contract = state.contracts.find(c => c.id === contractId);
  if (!contract) return { success: false, error: `Contract ${contractId} not found` };

  const oldFields = new Set(Object.keys(contract.schema));
  const newFields = new Set(Object.keys(newSchema));

  const added = [...newFields].filter(f => !oldFields.has(f));
  const removed = [...oldFields].filter(f => !newFields.has(f));

  let compatible = true;
  const issues = [];

  if (contract.compatibility === 'backward' && removed.length > 0) {
    compatible = false;
    issues.push({ type: 'breaking_removal', fields: removed });
  }
  if (contract.compatibility === 'forward' && added.length > 0) {
    compatible = false;
    issues.push({ type: 'forward_incompatible', fields: added });
  }

  return { success: true, compatible, issues, added, removed };
}

function trackLineage(sourceContract, targetContract, options = {}) {
  if (!sourceContract || !targetContract) return { success: false, error: 'source and target contracts are required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const entry = {
    source: sourceContract,
    target: targetContract,
    transformation: options.transformation || 'direct',
    created_at: new Date().toISOString()
  };

  state.lineage.push(entry);
  saveState(state, stateFile);

  return { success: true, lineage: entry };
}

function generateReport(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    total_contracts: state.contracts.length,
    total_lineage: state.lineage.length,
    contracts: state.contracts.map(c => ({ id: c.id, name: c.name, version: c.version, compatibility: c.compatibility })),
    lineage: state.lineage
  };
}

module.exports = {
  registerContract, validateCompatibility, trackLineage, generateReport,
  loadState, saveState, defaultState,
  COMPATIBILITY_MODES
};
