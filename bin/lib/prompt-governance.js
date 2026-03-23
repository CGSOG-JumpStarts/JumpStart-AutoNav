/**
 * prompt-governance.js — Prompt and Agent Version Governance (Item 91)
 *
 * Version, diff, test, and approve prompts, personas, tools, and workflows.
 *
 * Usage:
 *   node bin/lib/prompt-governance.js register|version|diff|approve|list [options]
 *
 * State file: .jumpstart/state/prompt-governance.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'prompt-governance.json');

const ASSET_TYPES = ['prompt', 'persona', 'tool', 'workflow'];

function defaultState() {
  return { version: '1.0.0', assets: [], last_updated: null };
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

function registerAsset(name, type, content, options = {}) {
  if (!name || !type || !content) return { success: false, error: 'name, type, and content are required' };
  if (!ASSET_TYPES.includes(type)) {
    return { success: false, error: `Unknown type: ${type}. Valid: ${ASSET_TYPES.join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const asset = {
    id: `PGOV-${Date.now()}`,
    name,
    type,
    versions: [{
      version: '1.0.0',
      content,
      approved: false,
      created_at: new Date().toISOString()
    }],
    current_version: '1.0.0',
    created_at: new Date().toISOString()
  };

  state.assets.push(asset);
  saveState(state, stateFile);

  return { success: true, asset: { id: asset.id, name: asset.name, type: asset.type, version: asset.current_version } };
}

function addVersion(assetId, content, version, options = {}) {
  if (!assetId || !content || !version) return { success: false, error: 'assetId, content, and version are required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const asset = state.assets.find(a => a.id === assetId);
  if (!asset) return { success: false, error: `Asset ${assetId} not found` };

  asset.versions.push({ version, content, approved: false, created_at: new Date().toISOString() });
  asset.current_version = version;

  saveState(state, stateFile);

  return { success: true, asset_id: assetId, version };
}

function approveVersion(assetId, version, options = {}) {
  if (!assetId || !version) return { success: false, error: 'assetId and version are required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const asset = state.assets.find(a => a.id === assetId);
  if (!asset) return { success: false, error: `Asset ${assetId} not found` };

  const ver = asset.versions.find(v => v.version === version);
  if (!ver) return { success: false, error: `Version ${version} not found` };

  ver.approved = true;
  ver.approved_at = new Date().toISOString();
  ver.approved_by = options.approver || 'system';

  saveState(state, stateFile);

  return { success: true, asset_id: assetId, version, approved: true };
}

function listAssets(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  let assets = state.assets;
  if (options.type) assets = assets.filter(a => a.type === options.type);

  return {
    success: true,
    total: assets.length,
    assets: assets.map(a => ({
      id: a.id, name: a.name, type: a.type,
      current_version: a.current_version,
      versions_count: a.versions.length,
      latest_approved: (a.versions.filter(v => v.approved).pop() || {}).version || null
    }))
  };
}

module.exports = {
  registerAsset, addVersion, approveVersion, listAssets,
  loadState, saveState, defaultState,
  ASSET_TYPES
};
