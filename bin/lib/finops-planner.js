/**
 * finops-planner.js — FinOps-Aware Architecture Planning (Item 35)
 *
 * Produce estimated run costs and optimization recommendations
 * before implementation.
 *
 * Usage:
 *   node bin/lib/finops-planner.js estimate|optimize|report [options]
 *
 * State file: .jumpstart/state/finops.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'finops.json');

const COST_CATEGORIES = ['compute', 'storage', 'network', 'database', 'ai-ml', 'monitoring', 'third-party', 'licensing'];

const CLOUD_PRICING_ESTIMATES = {
  compute: { unit: 'vCPU-hour', low: 0.02, medium: 0.05, high: 0.10 },
  storage: { unit: 'GB-month', low: 0.01, medium: 0.023, high: 0.10 },
  network: { unit: 'GB-transfer', low: 0.01, medium: 0.08, high: 0.12 },
  database: { unit: 'instance-hour', low: 0.02, medium: 0.10, high: 0.50 },
  'ai-ml': { unit: '1K-tokens', low: 0.001, medium: 0.01, high: 0.06 },
  monitoring: { unit: 'GB-logs-month', low: 0.25, medium: 0.50, high: 1.00 }
};

function defaultState() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    estimates: [],
    budgets: [],
    optimizations: []
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
 * Create a cost estimate for a service/component.
 *
 * @param {object} estimate - { name, components[] }
 * @param {object} [options]
 * @returns {object}
 */
function createEstimate(estimate, options = {}) {
  if (!estimate || !estimate.name) {
    return { success: false, error: 'estimate.name is required' };
  }

  const components = estimate.components || [];
  let totalMonthly = 0;
  const breakdown = [];

  for (const comp of components) {
    const category = comp.category || 'compute';
    const pricing = CLOUD_PRICING_ESTIMATES[category];
    const tier = comp.tier || 'medium';
    const quantity = comp.quantity || 1;
    const hours = comp.hours_per_month || 730; // ~24*30

    let monthlyCost;
    if (pricing) {
      const rate = pricing[tier] || pricing.medium;
      monthlyCost = rate * quantity * (category === 'storage' || category === 'monitoring' ? 1 : hours);
    } else {
      monthlyCost = comp.monthly_cost || 0;
    }

    breakdown.push({
      name: comp.name || category,
      category,
      quantity,
      monthly_cost: Math.round(monthlyCost * 100) / 100
    });
    totalMonthly += monthlyCost;
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const est = {
    id: `FIN-${Date.now().toString(36).toUpperCase()}`,
    name: estimate.name,
    breakdown,
    monthly_total: Math.round(totalMonthly * 100) / 100,
    annual_total: Math.round(totalMonthly * 12 * 100) / 100,
    created_at: new Date().toISOString()
  };

  state.estimates.push(est);
  saveState(state, stateFile);

  return { success: true, estimate: est };
}

/**
 * Get optimization recommendations.
 *
 * @param {object} [options]
 * @returns {object}
 */
function getOptimizations(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const recommendations = [];

  for (const est of state.estimates) {
    for (const comp of est.breakdown) {
      if (comp.category === 'compute' && comp.monthly_cost > 500) {
        recommendations.push({ estimate: est.name, component: comp.name, recommendation: 'Consider reserved instances or spot instances', potential_savings: '30-60%' });
      }
      if (comp.category === 'storage' && comp.monthly_cost > 100) {
        recommendations.push({ estimate: est.name, component: comp.name, recommendation: 'Implement storage tiering (hot/warm/cold)', potential_savings: '20-40%' });
      }
      if (comp.category === 'ai-ml' && comp.monthly_cost > 200) {
        recommendations.push({ estimate: est.name, component: comp.name, recommendation: 'Use smaller models for simple tasks, batch requests', potential_savings: '40-70%' });
      }
    }
  }

  return { success: true, recommendations, total: recommendations.length };
}

/**
 * Generate FinOps report.
 *
 * @param {object} [options]
 * @returns {object}
 */
function generateReport(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const totalMonthly = state.estimates.reduce((sum, e) => sum + e.monthly_total, 0);
  const byCategory = {};

  for (const est of state.estimates) {
    for (const comp of est.breakdown) {
      byCategory[comp.category] = (byCategory[comp.category] || 0) + comp.monthly_cost;
    }
  }

  return {
    success: true,
    total_estimates: state.estimates.length,
    total_monthly: Math.round(totalMonthly * 100) / 100,
    total_annual: Math.round(totalMonthly * 12 * 100) / 100,
    by_category: byCategory,
    estimates: state.estimates
  };
}

module.exports = {
  defaultState,
  loadState,
  saveState,
  createEstimate,
  getOptimizations,
  generateReport,
  COST_CATEGORIES,
  CLOUD_PRICING_ESTIMATES
};
