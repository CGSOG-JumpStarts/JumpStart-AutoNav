/**
 * pattern-library.js — Inner-Source Pattern Library (Item 82)
 *
 * Approved implementation examples that agents can clone, adapt, and cite.
 *
 * Usage:
 *   node bin/lib/pattern-library.js register|search|get|list [options]
 *
 * State file: .jumpstart/state/pattern-library.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'pattern-library.json');

const PATTERN_CATEGORIES = ['api', 'data-access', 'auth', 'messaging', 'testing', 'deployment', 'error-handling', 'logging'];

function defaultState() {
  return { version: '1.0.0', patterns: [], last_updated: null };
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

function registerPattern(name, category, options = {}) {
  if (!name || !category) return { success: false, error: 'name and category are required' };
  if (!PATTERN_CATEGORIES.includes(category)) {
    return { success: false, error: `Unknown category: ${category}. Valid: ${PATTERN_CATEGORIES.join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const pattern = {
    id: `PAT-${Date.now()}`,
    name,
    category,
    description: options.description || '',
    language: options.language || 'javascript',
    code: options.code || '',
    tags: options.tags || [],
    approved: options.approved || false,
    created_at: new Date().toISOString()
  };

  state.patterns.push(pattern);
  saveState(state, stateFile);

  return { success: true, pattern };
}

function searchPatterns(query, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const q = (query || '').toLowerCase();
  let results = state.patterns;

  if (q) {
    results = results.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.tags.some(t => t.toLowerCase().includes(q))
    );
  }

  if (options.category) {
    results = results.filter(p => p.category === options.category);
  }

  return { success: true, total: results.length, patterns: results };
}

function getPattern(patternId, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const pattern = state.patterns.find(p => p.id === patternId);
  if (!pattern) return { success: false, error: `Pattern ${patternId} not found` };

  return { success: true, pattern };
}

function listPatterns(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    total: state.patterns.length,
    categories: PATTERN_CATEGORIES,
    patterns: state.patterns.map(p => ({ id: p.id, name: p.name, category: p.category, approved: p.approved }))
  };
}

module.exports = {
  registerPattern, searchPatterns, getPattern, listPatterns,
  loadState, saveState, defaultState,
  PATTERN_CATEGORIES
};
