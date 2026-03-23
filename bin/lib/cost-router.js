/**
 * cost-router.js — Cost-Aware Model Routing (Item 55)
 *
 * Optimize quality and speed against budget targets.
 *
 * Usage:
 *   node bin/lib/cost-router.js route|budget|report [options]
 *
 * Config: .jumpstart/cost-routing.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_FILE = path.join('.jumpstart', 'cost-routing.json');

const MODEL_COSTS = {
  'gpt-4o': { input_per_1k: 0.005, output_per_1k: 0.015, quality: 90, speed: 80 },
  'gpt-4-turbo': { input_per_1k: 0.01, output_per_1k: 0.03, quality: 92, speed: 70 },
  'gpt-3.5-turbo': { input_per_1k: 0.0005, output_per_1k: 0.0015, quality: 70, speed: 95 },
  'claude-3-opus': { input_per_1k: 0.015, output_per_1k: 0.075, quality: 95, speed: 60 },
  'claude-3-sonnet': { input_per_1k: 0.003, output_per_1k: 0.015, quality: 88, speed: 85 },
  'claude-3-haiku': { input_per_1k: 0.00025, output_per_1k: 0.00125, quality: 75, speed: 95 }
};

const BUDGET_PROFILES = {
  economy: { max_per_task: 0.10, prefer: 'cheapest', min_quality: 65 },
  balanced: { max_per_task: 0.50, prefer: 'balanced', min_quality: 80 },
  premium: { max_per_task: 2.00, prefer: 'best-quality', min_quality: 90 }
};

function loadConfig(configFile) {
  const filePath = configFile || DEFAULT_CONFIG_FILE;
  if (!fs.existsSync(filePath)) return { budget_profile: 'balanced', spending: [] };
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return { budget_profile: 'balanced', spending: [] }; }
}

function saveConfig(config, configFile) {
  const filePath = configFile || DEFAULT_CONFIG_FILE;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

/**
 * Route to the most cost-effective model.
 *
 * @param {object} task - { type, estimated_tokens?, min_quality? }
 * @param {object} [options]
 * @returns {object}
 */
function routeByCost(task, options = {}) {
  const configFile = options.configFile || DEFAULT_CONFIG_FILE;
  const config = loadConfig(configFile);
  const profile = BUDGET_PROFILES[config.budget_profile] || BUDGET_PROFILES.balanced;
  const minQuality = task.min_quality || profile.min_quality;

  const candidates = Object.entries(MODEL_COSTS)
    .filter(([, costs]) => costs.quality >= minQuality)
    .map(([model, costs]) => {
      const tokens = task.estimated_tokens || 1000;
      const cost = (tokens / 1000) * costs.input_per_1k + (tokens / 1000) * costs.output_per_1k;
      return { model, cost: Math.round(cost * 10000) / 10000, quality: costs.quality, speed: costs.speed };
    })
    .sort((a, b) => {
      if (profile.prefer === 'cheapest') return a.cost - b.cost;
      if (profile.prefer === 'best-quality') return b.quality - a.quality;
      return (b.quality + b.speed) / 2 - (a.quality + a.speed) / 2; // balanced
    });

  const selected = candidates[0];

  return {
    success: true,
    selected_model: selected ? selected.model : null,
    estimated_cost: selected ? selected.cost : 0,
    quality: selected ? selected.quality : 0,
    budget_profile: config.budget_profile,
    alternatives: candidates.slice(1, 3)
  };
}

/**
 * Record spending.
 *
 * @param {string} model
 * @param {number} tokens
 * @param {object} [options]
 * @returns {object}
 */
function recordSpending(model, tokens, options = {}) {
  const configFile = options.configFile || DEFAULT_CONFIG_FILE;
  const config = loadConfig(configFile);
  const costs = MODEL_COSTS[model];

  if (!costs) return { success: false, error: `Unknown model: ${model}` };

  const cost = (tokens / 1000) * (costs.input_per_1k + costs.output_per_1k);

  if (!config.spending) config.spending = [];
  config.spending.push({
    model,
    tokens,
    cost: Math.round(cost * 10000) / 10000,
    recorded_at: new Date().toISOString()
  });

  saveConfig(config, configFile);

  return { success: true, model, tokens, cost: Math.round(cost * 10000) / 10000 };
}

/**
 * Generate cost report.
 *
 * @param {object} [options]
 * @returns {object}
 */
function generateReport(options = {}) {
  const configFile = options.configFile || DEFAULT_CONFIG_FILE;
  const config = loadConfig(configFile);
  const spending = config.spending || [];

  const totalCost = spending.reduce((sum, s) => sum + s.cost, 0);
  const byModel = spending.reduce((acc, s) => { acc[s.model] = (acc[s.model] || 0) + s.cost; return acc; }, {});

  return {
    success: true,
    budget_profile: config.budget_profile,
    total_cost: Math.round(totalCost * 100) / 100,
    total_requests: spending.length,
    by_model: byModel,
    recent: spending.slice(-10)
  };
}

module.exports = {
  loadConfig,
  saveConfig,
  routeByCost,
  recordSpending,
  generateReport,
  MODEL_COSTS,
  BUDGET_PROFILES
};
