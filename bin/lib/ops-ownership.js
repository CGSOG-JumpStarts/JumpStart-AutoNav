/**
 * ops-ownership.js — Operational Ownership Modeling (Item 39)
 *
 * Require clear service owner, escalation path, on-call model,
 * and support plan.
 *
 * Usage:
 *   node bin/lib/ops-ownership.js define|check|report [options]
 *
 * State file: .jumpstart/state/ops-ownership.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'ops-ownership.json');

const OWNERSHIP_FIELDS = ['service_owner', 'team', 'escalation_path', 'oncall_model', 'support_hours', 'runbook_url', 'sla_tier'];

function defaultState() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    services: []
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
 * Define operational ownership for a service.
 *
 * @param {object} service - { name, service_owner, team, escalation_path[], oncall_model, support_hours, runbook_url?, sla_tier? }
 * @param {object} [options]
 * @returns {object}
 */
function defineOwnership(service, options = {}) {
  if (!service || !service.name || !service.service_owner) {
    return { success: false, error: 'name and service_owner are required' };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const svc = {
    id: `OPS-${(state.services.length + 1).toString().padStart(3, '0')}`,
    name: service.name,
    service_owner: service.service_owner,
    team: service.team || null,
    escalation_path: service.escalation_path || [],
    oncall_model: service.oncall_model || 'business-hours',
    support_hours: service.support_hours || '9x5',
    runbook_url: service.runbook_url || null,
    sla_tier: service.sla_tier || 'silver',
    defined_at: new Date().toISOString()
  };

  // Replace if already exists
  const idx = state.services.findIndex(s => s.name === service.name);
  if (idx >= 0) state.services[idx] = svc;
  else state.services.push(svc);

  saveState(state, stateFile);

  return { success: true, service: svc };
}

/**
 * Check ownership completeness.
 *
 * @param {object} [options]
 * @returns {object}
 */
function checkCompleteness(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const incomplete = [];
  for (const svc of state.services) {
    const missing = [];
    if (!svc.service_owner) missing.push('service_owner');
    if (!svc.team) missing.push('team');
    if (!svc.escalation_path || svc.escalation_path.length === 0) missing.push('escalation_path');
    if (!svc.runbook_url) missing.push('runbook_url');

    if (missing.length > 0) {
      incomplete.push({ service: svc.name, missing });
    }
  }

  return {
    success: true,
    total_services: state.services.length,
    complete: state.services.length - incomplete.length,
    incomplete: incomplete.length,
    findings: incomplete,
    all_complete: incomplete.length === 0
  };
}

/**
 * Generate ops ownership report.
 *
 * @param {object} [options]
 * @returns {object}
 */
function generateReport(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const byTeam = {};
  const byTier = {};
  for (const svc of state.services) {
    const team = svc.team || 'unassigned';
    byTeam[team] = (byTeam[team] || 0) + 1;
    byTier[svc.sla_tier] = (byTier[svc.sla_tier] || 0) + 1;
  }

  return {
    success: true,
    total_services: state.services.length,
    by_team: byTeam,
    by_tier: byTier,
    services: state.services
  };
}

module.exports = {
  defaultState,
  loadState,
  saveState,
  defineOwnership,
  checkCompleteness,
  generateReport,
  OWNERSHIP_FIELDS
};
