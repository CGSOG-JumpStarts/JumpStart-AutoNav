/**
 * design-system.js — Design System Integration (Item 69)
 *
 * Connect to enterprise design tokens, component libraries,
 * accessibility standards, and brand rules.
 *
 * Usage:
 *   node bin/lib/design-system.js register|check|report [options]
 *
 * State file: .jumpstart/state/design-system.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'design-system.json');

const TOKEN_CATEGORIES = ['color', 'typography', 'spacing', 'elevation', 'breakpoint', 'motion'];
const ACCESSIBILITY_LEVELS = ['A', 'AA', 'AAA'];

function defaultState() {
  return { version: '1.0.0', tokens: {}, components: [], accessibility: { level: 'AA' }, brand: {}, last_updated: null };
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

/**
 * Register design tokens.
 */
function registerTokens(category, tokens, options = {}) {
  if (!category || !tokens) return { success: false, error: 'category and tokens are required' };
  if (!TOKEN_CATEGORIES.includes(category)) {
    return { success: false, error: `Unknown category: ${category}. Valid: ${TOKEN_CATEGORIES.join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);
  state.tokens[category] = tokens;
  saveState(state, stateFile);

  return { success: true, category, token_count: Object.keys(tokens).length };
}

/**
 * Register a component.
 */
function registerComponent(name, spec, options = {}) {
  if (!name) return { success: false, error: 'Component name is required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const component = {
    name,
    props: spec.props || [],
    accessibility: spec.accessibility || [],
    tokens_used: spec.tokens_used || [],
    registered_at: new Date().toISOString()
  };

  state.components.push(component);
  saveState(state, stateFile);

  return { success: true, component };
}

/**
 * Check design system compliance.
 */
function checkCompliance(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const issues = [];
  const tokenCategories = Object.keys(state.tokens);
  
  for (const required of ['color', 'typography', 'spacing']) {
    if (!tokenCategories.includes(required)) {
      issues.push({ type: 'missing_tokens', category: required, severity: 'warning' });
    }
  }

  for (const comp of state.components) {
    if (!comp.accessibility || comp.accessibility.length === 0) {
      issues.push({ type: 'missing_accessibility', component: comp.name, severity: 'warning' });
    }
  }

  return {
    success: true,
    compliant: issues.length === 0,
    issues,
    token_categories: tokenCategories.length,
    components: state.components.length,
    accessibility_level: state.accessibility.level
  };
}

/**
 * Generate design system report.
 */
function generateReport(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    tokens: Object.fromEntries(Object.entries(state.tokens).map(([k, v]) => [k, Object.keys(v).length])),
    components: state.components.length,
    accessibility_level: state.accessibility.level,
    brand: state.brand
  };
}

module.exports = {
  registerTokens, registerComponent, checkCompliance, generateReport,
  loadState, saveState, defaultState, TOKEN_CATEGORIES, ACCESSIBILITY_LEVELS
};
