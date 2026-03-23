/**
 * sla-slo.js — SLA & SLO Specification Support (Item 28)
 *
 * Make operational expectations first-class citizens in the PRD
 * and architecture.
 *
 * Usage:
 *   node bin/lib/sla-slo.js define|check|report [options]
 *
 * State file: .jumpstart/state/sla-slo.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'sla-slo.json');

const SLO_TYPES = ['availability', 'latency', 'throughput', 'error-rate', 'durability', 'freshness'];

const DEFAULT_SLO_TEMPLATES = {
  'web-api': [
    { type: 'availability', target: 99.9, unit: 'percent', window: '30d' },
    { type: 'latency', target: 200, unit: 'ms', percentile: 'p99', window: '30d' },
    { type: 'error-rate', target: 0.1, unit: 'percent', window: '30d' }
  ],
  'batch-processing': [
    { type: 'availability', target: 99.5, unit: 'percent', window: '30d' },
    { type: 'throughput', target: 1000, unit: 'records/sec', window: '1h' },
    { type: 'freshness', target: 60, unit: 'minutes', window: '24h' }
  ],
  'data-pipeline': [
    { type: 'availability', target: 99.0, unit: 'percent', window: '30d' },
    { type: 'freshness', target: 15, unit: 'minutes', window: '24h' },
    { type: 'durability', target: 99.999, unit: 'percent', window: '30d' }
  ]
};

function defaultState() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    slos: [],
    slas: [],
    error_budgets: []
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
 * Define an SLO.
 *
 * @param {object} slo - { name, service, type, target, unit, window, description? }
 * @param {object} [options]
 * @returns {object}
 */
function defineSLO(slo, options = {}) {
  if (!slo || !slo.name || !slo.service || !slo.target) {
    return { success: false, error: 'name, service, and target are required' };
  }

  const type = (slo.type || 'availability').toLowerCase();
  if (!SLO_TYPES.includes(type)) {
    return { success: false, error: `Invalid type. Must be one of: ${SLO_TYPES.join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const newSLO = {
    id: `SLO-${Date.now().toString(36).toUpperCase()}`,
    name: slo.name,
    service: slo.service,
    type,
    target: slo.target,
    unit: slo.unit || 'percent',
    window: slo.window || '30d',
    description: slo.description || '',
    created_at: new Date().toISOString()
  };

  state.slos.push(newSLO);
  saveState(state, stateFile);

  return { success: true, slo: newSLO };
}

/**
 * Apply an SLO template by service type.
 *
 * @param {string} serviceName
 * @param {string} templateType - 'web-api' | 'batch-processing' | 'data-pipeline'
 * @param {object} [options]
 * @returns {object}
 */
function applyTemplate(serviceName, templateType, options = {}) {
  const template = DEFAULT_SLO_TEMPLATES[templateType];
  if (!template) {
    return { success: false, error: `Unknown template: ${templateType}. Available: ${Object.keys(DEFAULT_SLO_TEMPLATES).join(', ')}` };
  }

  const results = [];
  for (const t of template) {
    const result = defineSLO({
      name: `${serviceName} ${t.type}`,
      service: serviceName,
      ...t
    }, options);
    results.push(result);
  }

  return { success: true, service: serviceName, template: templateType, slos_created: results.length };
}

/**
 * Check SLO coverage in specs.
 *
 * @param {string} root - Project root.
 * @param {object} [options]
 * @returns {object}
 */
function checkSLOCoverage(root, options = {}) {
  const stateFile = options.stateFile || path.join(root, DEFAULT_STATE_FILE);
  const state = loadState(stateFile);

  const archFile = path.join(root, 'specs', 'architecture.md');
  const prdFile = path.join(root, 'specs', 'prd.md');

  let archHasSLO = false;
  let prdHasSLO = false;

  if (fs.existsSync(archFile)) {
    try {
      const content = fs.readFileSync(archFile, 'utf8');
      archHasSLO = /\bSL[OA]\b|service.level|availability|latency.target/i.test(content);
    } catch { /* ignore */ }
  }

  if (fs.existsSync(prdFile)) {
    try {
      const content = fs.readFileSync(prdFile, 'utf8');
      prdHasSLO = /\bSL[OA]\b|service.level|availability|uptime/i.test(content);
    } catch { /* ignore */ }
  }

  return {
    success: true,
    defined_slos: state.slos.length,
    architecture_mentions_slo: archHasSLO,
    prd_mentions_slo: prdHasSLO,
    coverage: state.slos.length > 0 ? 'defined' : 'missing',
    recommendations: state.slos.length === 0 ? ['Define SLOs using `jumpstart-mode sla-slo define`'] : []
  };
}

/**
 * Generate SLO report.
 *
 * @param {object} [options]
 * @returns {object}
 */
function generateReport(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    slos: state.slos,
    slas: state.slas,
    total_slos: state.slos.length,
    total_slas: state.slas.length,
    by_service: state.slos.reduce((acc, s) => {
      acc[s.service] = acc[s.service] || [];
      acc[s.service].push(s);
      return acc;
    }, {}),
    by_type: state.slos.reduce((acc, s) => {
      acc[s.type] = (acc[s.type] || 0) + 1;
      return acc;
    }, {})
  };
}

module.exports = {
  defaultState,
  loadState,
  saveState,
  defineSLO,
  applyTemplate,
  checkSLOCoverage,
  generateReport,
  SLO_TYPES,
  DEFAULT_SLO_TEMPLATES
};
