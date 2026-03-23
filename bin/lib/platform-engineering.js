/**
 * platform-engineering.js — Platform Engineering Integration (Item 86)
 *
 * Connect to golden paths, service templates, IDP portals,
 * and paved-road tooling.
 *
 * Usage:
 *   node bin/lib/platform-engineering.js register|list|instantiate|report [options]
 *
 * State file: .jumpstart/state/platform-engineering.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'platform-engineering.json');

const TEMPLATE_TYPES = ['service', 'library', 'worker', 'api-gateway', 'frontend'];
const GOLDEN_PATH_STAGES = ['scaffold', 'ci-cd', 'observability', 'security', 'deployment'];

function defaultState() {
  return { version: '1.0.0', templates: [], golden_paths: [], instances: [], last_updated: null };
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

function registerTemplate(name, type, options = {}) {
  if (!name || !type) return { success: false, error: 'name and type are required' };
  if (!TEMPLATE_TYPES.includes(type)) {
    return { success: false, error: `Unknown type: ${type}. Valid: ${TEMPLATE_TYPES.join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const template = {
    id: `PLAT-${Date.now()}`,
    name,
    type,
    tech_stack: options.tech_stack || [],
    golden_path_stages: options.stages || GOLDEN_PATH_STAGES,
    version: options.version || '1.0.0',
    created_at: new Date().toISOString()
  };

  state.templates.push(template);
  saveState(state, stateFile);

  return { success: true, template };
}

function listTemplates(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  let templates = state.templates;
  if (options.type) templates = templates.filter(t => t.type === options.type);

  return { success: true, total: templates.length, templates };
}

function instantiateTemplate(templateId, projectName, options = {}) {
  if (!templateId || !projectName) return { success: false, error: 'templateId and projectName are required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const template = state.templates.find(t => t.id === templateId);
  if (!template) return { success: false, error: `Template ${templateId} not found` };

  const instance = {
    id: `INST-${Date.now()}`,
    template_id: templateId,
    template_name: template.name,
    project_name: projectName,
    status: 'created',
    created_at: new Date().toISOString()
  };

  state.instances.push(instance);
  saveState(state, stateFile);

  return { success: true, instance };
}

function generateReport(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    total_templates: state.templates.length,
    total_instances: state.instances.length,
    by_type: state.templates.reduce((acc, t) => { acc[t.type] = (acc[t.type] || 0) + 1; return acc; }, {}),
    templates: state.templates,
    instances: state.instances
  };
}

module.exports = {
  registerTemplate, listTemplates, instantiateTemplate, generateReport,
  loadState, saveState, defaultState,
  TEMPLATE_TYPES, GOLDEN_PATH_STAGES
};
