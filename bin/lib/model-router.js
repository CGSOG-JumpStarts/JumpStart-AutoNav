/**
 * model-router.js — Multi-Model Routing (Item 54)
 *
 * Use different models for planning, coding, review, diagramming,
 * and summarization.
 *
 * Usage:
 *   node bin/lib/model-router.js route|config|report [options]
 *
 * Config: .jumpstart/model-routing.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_FILE = path.join('.jumpstart', 'model-routing.json');

const TASK_TYPES = ['planning', 'coding', 'review', 'diagramming', 'summarization', 'testing', 'documentation', 'analysis'];

const DEFAULT_ROUTING = {
  planning: { model: 'claude-3-opus', reason: 'Complex reasoning for architecture decisions' },
  coding: { model: 'claude-3-sonnet', reason: 'Balanced quality and speed for code generation' },
  review: { model: 'gpt-4o', reason: 'Thorough code review capabilities' },
  diagramming: { model: 'claude-3-haiku', reason: 'Fast diagram generation' },
  summarization: { model: 'claude-3-haiku', reason: 'Efficient summarization' },
  testing: { model: 'claude-3-sonnet', reason: 'Good test generation quality' },
  documentation: { model: 'claude-3-haiku', reason: 'Efficient doc generation' },
  analysis: { model: 'claude-3-opus', reason: 'Deep analysis capabilities' }
};

/**
 * Load routing configuration.
 *
 * @param {string} [configFile]
 * @returns {object}
 */
function loadConfig(configFile) {
  const filePath = configFile || DEFAULT_CONFIG_FILE;
  if (!fs.existsSync(filePath)) return { routing: { ...DEFAULT_ROUTING } };
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return { routing: { ...DEFAULT_ROUTING } }; }
}

/**
 * Save routing configuration.
 *
 * @param {object} config
 * @param {string} [configFile]
 */
function saveConfig(config, configFile) {
  const filePath = configFile || DEFAULT_CONFIG_FILE;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

/**
 * Route a task to the appropriate model.
 *
 * @param {string} taskType - Type of task to route.
 * @param {object} [options]
 * @returns {object}
 */
function routeTask(taskType, options = {}) {
  if (!TASK_TYPES.includes(taskType)) {
    return { success: false, error: `Invalid task type. Must be one of: ${TASK_TYPES.join(', ')}` };
  }

  const configFile = options.configFile || DEFAULT_CONFIG_FILE;
  const config = loadConfig(configFile);
  const routing = config.routing || DEFAULT_ROUTING;
  const route = routing[taskType] || DEFAULT_ROUTING[taskType];

  return {
    success: true,
    task_type: taskType,
    model: route.model,
    reason: route.reason,
    overridden: !!(config.routing && config.routing[taskType])
  };
}

/**
 * Configure routing for a task type.
 *
 * @param {string} taskType
 * @param {string} model
 * @param {object} [options]
 * @returns {object}
 */
function configureRoute(taskType, model, options = {}) {
  if (!TASK_TYPES.includes(taskType)) {
    return { success: false, error: `Invalid task type. Must be one of: ${TASK_TYPES.join(', ')}` };
  }

  const configFile = options.configFile || DEFAULT_CONFIG_FILE;
  const config = loadConfig(configFile);
  if (!config.routing) config.routing = { ...DEFAULT_ROUTING };

  config.routing[taskType] = {
    model,
    reason: options.reason || `Custom routing to ${model}`,
    configured_at: new Date().toISOString()
  };

  saveConfig(config, configFile);

  return { success: true, task_type: taskType, model, routing: config.routing };
}

/**
 * Get routing report.
 *
 * @param {object} [options]
 * @returns {object}
 */
function generateReport(options = {}) {
  const configFile = options.configFile || DEFAULT_CONFIG_FILE;
  const config = loadConfig(configFile);
  const routing = config.routing || DEFAULT_ROUTING;

  const models = [...new Set(Object.values(routing).map(r => r.model))];

  return {
    success: true,
    task_types: TASK_TYPES.length,
    configured_routes: Object.keys(routing).length,
    unique_models: models.length,
    models,
    routing
  };
}

module.exports = {
  loadConfig,
  saveConfig,
  routeTask,
  configureRoute,
  generateReport,
  TASK_TYPES,
  DEFAULT_ROUTING
};
