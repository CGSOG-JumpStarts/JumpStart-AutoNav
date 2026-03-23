/**
 * knowledge-graph.js — Knowledge Graph Across Initiatives (Item 81)
 *
 * Reuse patterns, controls, decisions, skills, and modules
 * across the enterprise.
 *
 * Usage:
 *   node bin/lib/knowledge-graph.js add|query|report [options]
 *
 * State file: .jumpstart/state/knowledge-graph.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'knowledge-graph.json');

const NODE_TYPES = ['pattern', 'decision', 'control', 'component', 'skill', 'module'];
const EDGE_TYPES = ['uses', 'implements', 'depends-on', 'related-to', 'supersedes'];

function defaultState() {
  return { version: '1.0.0', nodes: [], edges: [], last_updated: null };
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

function addNode(name, type, options = {}) {
  if (!name || !type) return { success: false, error: 'name and type are required' };
  if (!NODE_TYPES.includes(type)) {
    return { success: false, error: `Unknown type: ${type}. Valid: ${NODE_TYPES.join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const node = {
    id: `KG-${Date.now()}`,
    name,
    type,
    tags: options.tags || [],
    metadata: options.metadata || {},
    created_at: new Date().toISOString()
  };

  state.nodes.push(node);
  saveState(state, stateFile);

  return { success: true, node };
}

function addEdge(fromId, toId, edgeType, options = {}) {
  if (!fromId || !toId || !edgeType) return { success: false, error: 'fromId, toId, and edgeType are required' };
  if (!EDGE_TYPES.includes(edgeType)) {
    return { success: false, error: `Unknown edge type: ${edgeType}. Valid: ${EDGE_TYPES.join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const edge = { from: fromId, to: toId, type: edgeType, created_at: new Date().toISOString() };
  state.edges.push(edge);
  saveState(state, stateFile);

  return { success: true, edge };
}

function queryGraph(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  let nodes = state.nodes;
  if (options.type) nodes = nodes.filter(n => n.type === options.type);
  if (options.tag) nodes = nodes.filter(n => n.tags.includes(options.tag));
  if (options.search) {
    const q = options.search.toLowerCase();
    nodes = nodes.filter(n => n.name.toLowerCase().includes(q));
  }

  return {
    success: true,
    nodes: nodes.length,
    edges: state.edges.length,
    results: nodes,
    related_edges: state.edges.filter(e => nodes.some(n => n.id === e.from || n.id === e.to))
  };
}

function generateReport(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const byType = {};
  for (const n of state.nodes) { byType[n.type] = (byType[n.type] || 0) + 1; }

  return {
    success: true,
    total_nodes: state.nodes.length,
    total_edges: state.edges.length,
    by_type: byType
  };
}

module.exports = {
  addNode, addEdge, queryGraph, generateReport,
  loadState, saveState, defaultState,
  NODE_TYPES, EDGE_TYPES
};
