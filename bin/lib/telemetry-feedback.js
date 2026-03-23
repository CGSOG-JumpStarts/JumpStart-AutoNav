/**
 * telemetry-feedback.js — Production Telemetry Feedback Loop (Item 95)
 *
 * Feed real performance and reliability data back into
 * future planning and architecture.
 *
 * Usage:
 *   node bin/lib/telemetry-feedback.js ingest|analyze|report [options]
 *
 * State file: .jumpstart/state/telemetry-feedback.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'telemetry-feedback.json');

const METRIC_TYPES = ['latency', 'error-rate', 'throughput', 'availability', 'saturation', 'cost'];

function defaultState() {
  return { version: '1.0.0', metrics: [], insights: [], last_updated: null };
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

function ingestMetric(name, type, value, options = {}) {
  if (!name || !type) return { success: false, error: 'name and type are required' };
  if (!METRIC_TYPES.includes(type)) {
    return { success: false, error: `Unknown type: ${type}. Valid: ${METRIC_TYPES.join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const metric = {
    id: `TEL-${Date.now()}`,
    name,
    type,
    value,
    unit: options.unit || null,
    service: options.service || null,
    timestamp: new Date().toISOString()
  };

  state.metrics.push(metric);
  saveState(state, stateFile);

  return { success: true, metric };
}

function analyzeMetrics(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const byType = {};
  for (const m of state.metrics) {
    if (!byType[m.type]) byType[m.type] = [];
    byType[m.type].push(m.value);
  }

  const analysis = {};
  for (const [type, values] of Object.entries(byType)) {
    const nums = values.filter(v => typeof v === 'number');
    if (nums.length > 0) {
      analysis[type] = {
        count: nums.length,
        avg: Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100,
        min: Math.min(...nums),
        max: Math.max(...nums)
      };
    }
  }

  return { success: true, total_metrics: state.metrics.length, analysis };
}

function generateFeedbackReport(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);
  const analysis = analyzeMetrics(options);

  const recommendations = [];
  if (analysis.analysis.latency && analysis.analysis.latency.avg > 500) {
    recommendations.push('High average latency detected — consider caching or query optimization');
  }
  if (analysis.analysis['error-rate'] && analysis.analysis['error-rate'].avg > 5) {
    recommendations.push('Elevated error rate — review error handling and resilience patterns');
  }

  return {
    success: true,
    total_metrics: state.metrics.length,
    total_insights: state.insights.length,
    analysis: analysis.analysis,
    recommendations
  };
}

module.exports = {
  ingestMetric, analyzeMetrics, generateFeedbackReport,
  loadState, saveState, defaultState,
  METRIC_TYPES
};
