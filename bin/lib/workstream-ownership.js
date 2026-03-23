/**
 * workstream-ownership.js — Workstream Ownership Visualization (Item 79)
 *
 * Make dependencies and responsibilities visible across pods and teams.
 *
 * Usage:
 *   node bin/lib/workstream-ownership.js define|query|report [options]
 *
 * State file: .jumpstart/state/workstream-ownership.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'workstream-ownership.json');

function defaultState() {
  return { version: '1.0.0', workstreams: [], dependencies: [], last_updated: null };
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

function defineWorkstream(name, options = {}) {
  if (!name) return { success: false, error: 'Workstream name is required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const ws = {
    id: `WS-${Date.now()}`,
    name,
    team: options.team || null,
    owner: options.owner || null,
    status: options.status || 'active',
    components: options.components || [],
    created_at: new Date().toISOString()
  };

  state.workstreams.push(ws);
  saveState(state, stateFile);

  return { success: true, workstream: ws };
}

function addDependency(fromId, toId, options = {}) {
  if (!fromId || !toId) return { success: false, error: 'fromId and toId are required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const dep = {
    from: fromId,
    to: toId,
    type: options.type || 'depends-on',
    description: options.description || null,
    created_at: new Date().toISOString()
  };

  state.dependencies.push(dep);
  saveState(state, stateFile);

  return { success: true, dependency: dep };
}

function generateReport(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const byTeam = {};
  for (const ws of state.workstreams) {
    const team = ws.team || 'unassigned';
    if (!byTeam[team]) byTeam[team] = [];
    byTeam[team].push(ws.name);
  }

  return {
    success: true,
    total_workstreams: state.workstreams.length,
    total_dependencies: state.dependencies.length,
    by_team: byTeam,
    workstreams: state.workstreams,
    dependencies: state.dependencies
  };
}

module.exports = {
  defineWorkstream, addDependency, generateReport,
  loadState, saveState, defaultState
};
