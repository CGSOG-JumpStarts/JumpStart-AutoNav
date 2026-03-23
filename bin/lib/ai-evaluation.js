/**
 * ai-evaluation.js — Evaluation Framework for AI Systems (Item 90)
 *
 * Groundedness, hallucination, safety, latency, cost,
 * and business KPI eval packs.
 *
 * Usage:
 *   node bin/lib/ai-evaluation.js evaluate|report|configure [options]
 *
 * State file: .jumpstart/state/ai-evaluation.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'ai-evaluation.json');

const EVAL_DIMENSIONS = ['groundedness', 'hallucination', 'safety', 'latency', 'cost', 'relevance', 'coherence'];

function defaultState() {
  return { version: '1.0.0', evaluations: [], benchmarks: [], last_updated: null };
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

function evaluate(name, scores, options = {}) {
  if (!name || !scores) return { success: false, error: 'name and scores are required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const evaluation = {
    id: `EVAL-${Date.now()}`,
    name,
    scores,
    overall: Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / Object.keys(scores).length),
    model: options.model || null,
    use_case: options.use_case || null,
    evaluated_at: new Date().toISOString()
  };

  state.evaluations.push(evaluation);
  saveState(state, stateFile);

  return { success: true, evaluation };
}

function generateReport(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const avgScores = {};
  for (const dim of EVAL_DIMENSIONS) {
    const vals = state.evaluations.filter(e => e.scores[dim] !== undefined).map(e => e.scores[dim]);
    avgScores[dim] = vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }

  return {
    success: true,
    total_evaluations: state.evaluations.length,
    average_scores: avgScores,
    evaluations: state.evaluations
  };
}

function configureBenchmark(name, thresholds, options = {}) {
  if (!name || !thresholds) return { success: false, error: 'name and thresholds are required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const benchmark = {
    id: `BENCH-${Date.now()}`,
    name,
    thresholds,
    created_at: new Date().toISOString()
  };

  state.benchmarks.push(benchmark);
  saveState(state, stateFile);

  return { success: true, benchmark };
}

module.exports = {
  evaluate, generateReport, configureBenchmark,
  loadState, saveState, defaultState,
  EVAL_DIMENSIONS
};
