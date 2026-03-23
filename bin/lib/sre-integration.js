/**
 * sre-integration.js — SRE Integration (Item 94)
 *
 * Generate monitors, alerts, runbooks, dashboards,
 * and error-budget alignment.
 *
 * Usage:
 *   node bin/lib/sre-integration.js generate|configure|report [options]
 *
 * State file: .jumpstart/state/sre-integration.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'sre-integration.json');

const MONITOR_TYPES = ['uptime', 'latency', 'error-rate', 'saturation', 'custom'];
const ALERT_SEVERITIES = ['critical', 'warning', 'info'];

function defaultState() {
  return { version: '1.0.0', monitors: [], alerts: [], runbooks: [], error_budgets: [], last_updated: null };
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

function generateMonitor(name, type, options = {}) {
  if (!name || !type) return { success: false, error: 'name and type are required' };
  if (!MONITOR_TYPES.includes(type)) {
    return { success: false, error: `Unknown type: ${type}. Valid: ${MONITOR_TYPES.join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const monitor = {
    id: `MON-${Date.now()}`,
    name,
    type,
    threshold: options.threshold || null,
    interval: options.interval || '60s',
    service: options.service || null,
    created_at: new Date().toISOString()
  };

  state.monitors.push(monitor);
  saveState(state, stateFile);

  return { success: true, monitor };
}

function generateAlert(name, severity, options = {}) {
  if (!name || !severity) return { success: false, error: 'name and severity are required' };
  if (!ALERT_SEVERITIES.includes(severity)) {
    return { success: false, error: `Unknown severity: ${severity}. Valid: ${ALERT_SEVERITIES.join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const alert = {
    id: `ALERT-${Date.now()}`,
    name,
    severity,
    condition: options.condition || null,
    notification_channels: options.channels || [],
    runbook_id: options.runbook_id || null,
    created_at: new Date().toISOString()
  };

  state.alerts.push(alert);
  saveState(state, stateFile);

  return { success: true, alert };
}

function generateRunbook(name, steps, options = {}) {
  if (!name || !steps) return { success: false, error: 'name and steps are required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const runbook = {
    id: `RB-${Date.now()}`,
    name,
    steps: Array.isArray(steps) ? steps.map((s, i) => ({ order: i + 1, action: s })) : [],
    service: options.service || null,
    created_at: new Date().toISOString()
  };

  state.runbooks.push(runbook);
  saveState(state, stateFile);

  return { success: true, runbook };
}

function configureErrorBudget(service, slo, options = {}) {
  if (!service || !slo) return { success: false, error: 'service and slo are required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const budget = {
    id: `EB-${Date.now()}`,
    service,
    slo_target: slo,
    budget_remaining: options.remaining || 100,
    window: options.window || '30d',
    created_at: new Date().toISOString()
  };

  state.error_budgets.push(budget);
  saveState(state, stateFile);

  return { success: true, error_budget: budget };
}

function generateReport(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    total_monitors: state.monitors.length,
    total_alerts: state.alerts.length,
    total_runbooks: state.runbooks.length,
    total_error_budgets: state.error_budgets.length,
    monitors: state.monitors,
    alerts: state.alerts,
    runbooks: state.runbooks,
    error_budgets: state.error_budgets
  };
}

module.exports = {
  generateMonitor, generateAlert, generateRunbook, configureErrorBudget, generateReport,
  loadState, saveState, defaultState,
  MONITOR_TYPES, ALERT_SEVERITIES
};
