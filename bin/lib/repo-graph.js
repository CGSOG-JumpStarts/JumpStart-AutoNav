/**
 * repo-graph.js — Automated Repo Understanding Graph
 *
 * Builds and persists a semantic graph of domains, modules, APIs,
 * ownership, decisions, and dependencies for a project repository.
 *
 * Usage:
 *   node bin/lib/repo-graph.js build|query|export [options]
 *
 * Output file: .jumpstart/state/repo-graph.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_GRAPH_FILE = path.join('.jumpstart', 'state', 'repo-graph.json');

/**
 * Default empty graph structure.
 * @returns {object}
 */
function defaultRepoGraph() {
  return {
    version: '1.0.0',
    generated_at: new Date().toISOString(),
    last_updated: null,
    nodes: {},   // id → { id, type, name, metadata }
    edges: []    // { from, to, relationship }
  };
}

/**
 * Load a repo graph from disk.
 * @param {string} [graphFile]
 * @returns {object}
 */
function loadRepoGraph(graphFile) {
  const filePath = graphFile || DEFAULT_GRAPH_FILE;
  if (!fs.existsSync(filePath)) {
    return defaultRepoGraph();
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return defaultRepoGraph();
  }
}

/**
 * Save a repo graph to disk.
 * @param {object} graph
 * @param {string} [graphFile]
 */
function saveRepoGraph(graph, graphFile) {
  const filePath = graphFile || DEFAULT_GRAPH_FILE;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  graph.last_updated = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(graph, null, 2) + '\n', 'utf8');
}

/**
 * Add or update a node in the graph.
 * @param {object} graph
 * @param {string} id
 * @param {string} type - domain|module|api|file|decision|owner|dependency
 * @param {object} [metadata]
 */
function upsertNode(graph, id, type, metadata = {}) {
  graph.nodes[id] = {
    ...(graph.nodes[id] || {}),
    id,
    type,
    ...metadata,
    updated_at: new Date().toISOString()
  };
}

/**
 * Add an edge between two nodes (avoids duplicates).
 * @param {object} graph
 * @param {string} from
 * @param {string} to
 * @param {string} relationship
 */
function addEdge(graph, from, to, relationship) {
  const exists = graph.edges.some(
    e => e.from === from && e.to === to && e.relationship === relationship
  );
  if (!exists) {
    graph.edges.push({ from, to, relationship });
  }
}

/**
 * Build the semantic graph from the project file system.
 * Scans src/, specs/, and config files to auto-discover structure.
 *
 * @param {string} root - Project root.
 * @param {object} [options]
 * @returns {object} Populated graph.
 */
function buildRepoGraph(root, options = {}) {
  const graph = defaultRepoGraph();
  const srcDir = path.join(root, options.srcDir || 'src');
  const specsDir = path.join(root, 'specs');
  const graphFile = options.graphFile || path.join(root, DEFAULT_GRAPH_FILE);

  // 1. Scan src directory for modules and files
  if (fs.existsSync(srcDir)) {
    upsertNode(graph, 'src', 'module', { name: 'Source Root', path: 'src' });

    const walk = (dir, parentId) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(root, full).replace(/\\/g, '/');
        const nodeId = `file:${rel}`;

        if (entry.isDirectory()) {
          upsertNode(graph, nodeId, 'module', { name: entry.name, path: rel });
          addEdge(graph, parentId, nodeId, 'contains');
          walk(full, nodeId);
        } else if (entry.isFile()) {
          // Classify file type
          let fileType = 'file';
          const lower = entry.name.toLowerCase();
          if (lower.includes('api') || lower.includes('route') || lower.includes('endpoint')) {
            fileType = 'api';
          } else if (lower.includes('model') || lower.includes('schema') || lower.includes('entity')) {
            fileType = 'model';
          } else if (lower.includes('service') || lower.includes('controller')) {
            fileType = 'service';
          }

          upsertNode(graph, nodeId, fileType, { name: entry.name, path: rel });
          addEdge(graph, parentId, nodeId, 'contains');

          // Extract any ownership annotations (e.g., @owner comments)
          try {
            const content = fs.readFileSync(full, 'utf8');
            const ownerMatch = content.match(/@owner[:\s]+(\S+)/i);
            if (ownerMatch) {
              const ownerId = `owner:${ownerMatch[1]}`;
              upsertNode(graph, ownerId, 'owner', { name: ownerMatch[1] });
              addEdge(graph, ownerId, nodeId, 'owns');
            }
          } catch {
            // skip unreadable files
          }
        }
      }
    };

    walk(srcDir, 'src');
  }

  // 2. Scan specs for decisions
  const decisionsDir = path.join(specsDir, 'decisions');
  if (fs.existsSync(decisionsDir)) {
    upsertNode(graph, 'decisions', 'module', { name: 'Architecture Decisions', path: 'specs/decisions' });
    for (const file of fs.readdirSync(decisionsDir)) {
      if (file.endsWith('.md')) {
        const nodeId = `decision:${file}`;
        const adrPath = path.join(decisionsDir, file);
        let title = file;
        try {
          const content = fs.readFileSync(adrPath, 'utf8');
          const titleMatch = content.match(/^# (.+)/m);
          if (titleMatch) title = titleMatch[1];
        } catch {
          // use filename as title
        }
        upsertNode(graph, nodeId, 'decision', { name: title, path: `specs/decisions/${file}` });
        addEdge(graph, 'decisions', nodeId, 'contains');
      }
    }
  }

  // 3. Add spec files as nodes
  const specFiles = ['challenger-brief.md', 'product-brief.md', 'prd.md', 'architecture.md', 'implementation-plan.md'];
  upsertNode(graph, 'specs', 'module', { name: 'Specifications', path: 'specs' });
  for (const sf of specFiles) {
    const specPath = path.join(specsDir, sf);
    if (fs.existsSync(specPath)) {
      const nodeId = `spec:${sf}`;
      upsertNode(graph, nodeId, 'spec', { name: sf, path: `specs/${sf}` });
      addEdge(graph, 'specs', nodeId, 'contains');
    }
  }

  const nodeCount = Object.keys(graph.nodes).length;
  const edgeCount = graph.edges.length;

  saveRepoGraph(graph, graphFile);

  return {
    success: true,
    node_count: nodeCount,
    edge_count: edgeCount,
    graph_file: graphFile
  };
}

/**
 * Query the graph for nodes matching a type or name pattern.
 *
 * @param {object} graph
 * @param {object} query - { type?, nameContains? }
 * @returns {object[]} Matching nodes.
 */
function queryGraph(graph, query = {}) {
  let nodes = Object.values(graph.nodes);

  if (query.type) {
    nodes = nodes.filter(n => n.type === query.type);
  }

  if (query.nameContains) {
    const lower = query.nameContains.toLowerCase();
    nodes = nodes.filter(n => n.name && n.name.toLowerCase().includes(lower));
  }

  if (query.id) {
    nodes = nodes.filter(n => n.id === query.id);
  }

  return nodes;
}

/**
 * Find all neighbours of a node (one-hop).
 *
 * @param {object} graph
 * @param {string} nodeId
 * @returns {{ incoming: object[], outgoing: object[] }}
 */
function getNeighbours(graph, nodeId) {
  const outgoing = graph.edges
    .filter(e => e.from === nodeId)
    .map(e => ({ node: graph.nodes[e.to] || { id: e.to }, relationship: e.relationship }));

  const incoming = graph.edges
    .filter(e => e.to === nodeId)
    .map(e => ({ node: graph.nodes[e.from] || { id: e.from }, relationship: e.relationship }));

  return { incoming, outgoing };
}

module.exports = {
  defaultRepoGraph,
  loadRepoGraph,
  saveRepoGraph,
  upsertNode,
  addEdge,
  buildRepoGraph,
  queryGraph,
  getNeighbours
};
