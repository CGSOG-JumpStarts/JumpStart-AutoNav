/**
 * incident-feedback.js — Incident-to-Spec Feedback Loop (Item 52)
 *
 * Convert production incidents into requirements, NFR updates,
 * and architecture improvements.
 *
 * Usage:
 *   node bin/lib/incident-feedback.js log|analyze|report [options]
 *
 * State file: .jumpstart/state/incidents.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'incidents.json');

const INCIDENT_SEVERITIES = ['sev1', 'sev2', 'sev3', 'sev4'];
const INCIDENT_CATEGORIES = ['availability', 'performance', 'security', 'data-loss', 'functionality', 'ux'];

function defaultState() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    incidents: [],
    spec_updates: []
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
 * Log a production incident.
 *
 * @param {object} incident - { title, severity, category, description, root_cause?, impact? }
 * @param {object} [options]
 * @returns {object}
 */
function logIncident(incident, options = {}) {
  if (!incident || !incident.title || !incident.severity) {
    return { success: false, error: 'title and severity are required' };
  }

  if (!INCIDENT_SEVERITIES.includes(incident.severity)) {
    return { success: false, error: `Invalid severity. Must be one of: ${INCIDENT_SEVERITIES.join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const inc = {
    id: `INC-${(state.incidents.length + 1).toString().padStart(4, '0')}`,
    title: incident.title,
    severity: incident.severity,
    category: incident.category || 'functionality',
    description: incident.description || '',
    root_cause: incident.root_cause || null,
    impact: incident.impact || null,
    spec_updates_generated: false,
    logged_at: new Date().toISOString()
  };

  state.incidents.push(inc);
  saveState(state, stateFile);

  return { success: true, incident: inc };
}

/**
 * Analyze incident and generate spec update recommendations.
 *
 * @param {string} incidentId
 * @param {object} [options]
 * @returns {object}
 */
function analyzeIncident(incidentId, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const incident = state.incidents.find(i => i.id === incidentId);
  if (!incident) return { success: false, error: `Incident not found: ${incidentId}` };

  const recommendations = [];

  if (incident.category === 'availability') {
    recommendations.push({ type: 'nfr', spec: 'architecture.md', update: 'Add/update availability SLO', priority: 'high' });
    recommendations.push({ type: 'requirement', spec: 'prd.md', update: 'Add monitoring requirement', priority: 'medium' });
  }
  if (incident.category === 'performance') {
    recommendations.push({ type: 'nfr', spec: 'architecture.md', update: 'Add/update latency SLO', priority: 'high' });
  }
  if (incident.category === 'security') {
    recommendations.push({ type: 'requirement', spec: 'prd.md', update: 'Add security hardening requirement', priority: 'critical' });
    recommendations.push({ type: 'architecture', spec: 'architecture.md', update: 'Review security architecture', priority: 'high' });
  }
  if (incident.severity === 'sev1') {
    recommendations.push({ type: 'architecture', spec: 'architecture.md', update: 'Add circuit breaker or failover', priority: 'critical' });
  }

  incident.spec_updates_generated = true;
  state.spec_updates.push({
    incident_id: incidentId,
    recommendations,
    generated_at: new Date().toISOString()
  });
  saveState(state, stateFile);

  return { success: true, incident_id: incidentId, recommendations, total: recommendations.length };
}

/**
 * Generate incident feedback report.
 *
 * @param {object} [options]
 * @returns {object}
 */
function generateReport(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    total_incidents: state.incidents.length,
    by_severity: state.incidents.reduce((acc, i) => { acc[i.severity] = (acc[i.severity] || 0) + 1; return acc; }, {}),
    by_category: state.incidents.reduce((acc, i) => { acc[i.category] = (acc[i.category] || 0) + 1; return acc; }, {}),
    spec_updates_pending: state.incidents.filter(i => !i.spec_updates_generated).length,
    total_spec_updates: state.spec_updates.length,
    incidents: state.incidents
  };
}

module.exports = {
  defaultState,
  loadState,
  saveState,
  logIncident,
  analyzeIncident,
  generateReport,
  INCIDENT_SEVERITIES,
  INCIDENT_CATEGORIES
};
