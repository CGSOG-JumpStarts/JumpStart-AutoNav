/**
 * domain-ontology.js — Domain Ontology Support (Item 83)
 *
 * Canonical terms, entities, events, and constraints per business domain.
 *
 * Usage:
 *   node bin/lib/domain-ontology.js define|query|validate|report [options]
 *
 * State file: .jumpstart/state/domain-ontology.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'domain-ontology.json');

const ELEMENT_TYPES = ['entity', 'event', 'command', 'value-object', 'aggregate', 'constraint'];

function defaultState() {
  return { version: '1.0.0', domains: {}, last_updated: null };
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

function defineElement(domain, name, type, options = {}) {
  if (!domain || !name || !type) return { success: false, error: 'domain, name, and type are required' };
  if (!ELEMENT_TYPES.includes(type)) {
    return { success: false, error: `Unknown type: ${type}. Valid: ${ELEMENT_TYPES.join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  if (!state.domains[domain]) state.domains[domain] = { elements: [], relationships: [] };

  const element = {
    id: `ONT-${Date.now()}`,
    name,
    type,
    description: options.description || '',
    properties: options.properties || [],
    constraints: options.constraints || [],
    created_at: new Date().toISOString()
  };

  state.domains[domain].elements.push(element);
  saveState(state, stateFile);

  return { success: true, element };
}

function queryOntology(domain, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  if (!state.domains[domain]) return { success: true, domain, elements: [], total: 0 };

  let elements = state.domains[domain].elements;
  if (options.type) elements = elements.filter(e => e.type === options.type);

  return { success: true, domain, elements, total: elements.length };
}

function validateTermUsage(domain, text, options = {}) {
  if (!domain || !text) return { success: false, error: 'domain and text are required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const domainData = state.domains[domain];
  if (!domainData) return { success: true, domain, issues: [], canonical_terms: 0 };

  const canonicalNames = domainData.elements.map(e => e.name.toLowerCase());
  const issues = [];

  // Check for near-misses
  const words = text.toLowerCase().split(/\W+/);
  for (const name of canonicalNames) {
    const nameWords = name.split(/\s+/);
    for (const nw of nameWords) {
      if (nw.length > 3 && words.some(w => w !== nw && levenshtein(w, nw) <= 2 && levenshtein(w, nw) > 0)) {
        issues.push({ type: 'possible_typo', canonical: name, severity: 'warning' });
      }
    }
  }

  return {
    success: true,
    domain,
    issues,
    canonical_terms: canonicalNames.length
  };
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

function generateReport(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const domains = Object.keys(state.domains);
  const report = { success: true, total_domains: domains.length, domains: {} };

  for (const d of domains) {
    const elements = state.domains[d].elements;
    const byType = {};
    for (const e of elements) byType[e.type] = (byType[e.type] || 0) + 1;
    report.domains[d] = { total_elements: elements.length, by_type: byType };
  }

  return report;
}

module.exports = {
  defineElement, queryOntology, validateTermUsage, generateReport,
  loadState, saveState, defaultState,
  ELEMENT_TYPES
};
