/**
 * reference-architectures.js — Org-wide Reusable Reference Architectures
 *
 * Let teams instantiate approved patterns for RAG, agent apps,
 * API platforms, event-driven systems, etc.
 *
 * Registry: .jumpstart/reference-architectures.json
 *
 * Usage:
 *   node bin/lib/reference-architectures.js list|get|register|instantiate [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_REGISTRY_FILE = path.join('.jumpstart', 'reference-architectures.json');

const PATTERN_CATEGORIES = ['api-platform', 'event-driven', 'rag', 'agent-app', 'microservices', 'monolith', 'serverless', 'data-pipeline', 'other'];

/**
 * Built-in reference architecture templates.
 */
const BUILTIN_PATTERNS = [
  {
    id: 'rag-pipeline',
    name: 'RAG Pipeline',
    category: 'rag',
    description: 'Retrieval-Augmented Generation pipeline with vector store, embeddings, and LLM orchestration.',
    components: ['document-ingestion', 'embedding-service', 'vector-store', 'retrieval-engine', 'llm-orchestrator', 'api-gateway'],
    tech_stack: { suggested: ['langchain', 'pinecone', 'openai', 'fastapi'] },
    structure: {
      'src/ingestion/': 'Document ingestion and chunking',
      'src/embeddings/': 'Embedding generation',
      'src/retrieval/': 'Vector search and retrieval',
      'src/orchestrator/': 'LLM orchestration and prompt management',
      'src/api/': 'API endpoints',
      'tests/': 'Test suites'
    },
    nfrs: ['latency < 2s p95', 'embedding refresh < 1h', 'context window management']
  },
  {
    id: 'agent-app',
    name: 'Agent Application',
    category: 'agent-app',
    description: 'Multi-agent application with tool use, memory, and planning capabilities.',
    components: ['agent-core', 'tool-registry', 'memory-store', 'planner', 'executor', 'api-layer'],
    tech_stack: { suggested: ['openai', 'langchain', 'redis', 'express'] },
    structure: {
      'src/agents/': 'Agent definitions and personas',
      'src/tools/': 'Tool implementations',
      'src/memory/': 'Memory and state management',
      'src/planner/': 'Planning and orchestration',
      'src/api/': 'API endpoints',
      'tests/': 'Test suites'
    },
    nfrs: ['response time < 5s', 'tool execution timeout 30s', 'conversation history management']
  },
  {
    id: 'api-platform',
    name: 'API Platform',
    category: 'api-platform',
    description: 'RESTful API platform with authentication, rate limiting, and monitoring.',
    components: ['api-gateway', 'auth-service', 'rate-limiter', 'business-logic', 'data-layer', 'monitoring'],
    tech_stack: { suggested: ['express', 'postgresql', 'redis', 'jwt'] },
    structure: {
      'src/routes/': 'API route definitions',
      'src/middleware/': 'Auth, rate limiting, validation',
      'src/services/': 'Business logic',
      'src/models/': 'Data models',
      'src/config/': 'Configuration',
      'tests/': 'Test suites'
    },
    nfrs: ['latency < 200ms p95', 'rate limit 1000 req/min', '99.9% availability']
  },
  {
    id: 'event-driven',
    name: 'Event-Driven System',
    category: 'event-driven',
    description: 'Event-driven microservice architecture with message broker and event sourcing.',
    components: ['event-producer', 'message-broker', 'event-consumer', 'event-store', 'projection-service', 'api-layer'],
    tech_stack: { suggested: ['kafka', 'nodejs', 'postgresql', 'elasticsearch'] },
    structure: {
      'src/events/': 'Event definitions and schemas',
      'src/producers/': 'Event producers',
      'src/consumers/': 'Event consumers and handlers',
      'src/projections/': 'Read model projections',
      'src/api/': 'Query API',
      'tests/': 'Test suites'
    },
    nfrs: ['event processing < 100ms', 'at-least-once delivery', 'event ordering guarantees']
  }
];

/**
 * Default registry.
 * @returns {object}
 */
function defaultRegistry() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    patterns: [...BUILTIN_PATTERNS],
    custom_patterns: [],
    instantiation_history: []
  };
}

/**
 * Load registry from disk.
 * @param {string} [registryFile]
 * @returns {object}
 */
function loadRegistry(registryFile) {
  const filePath = registryFile || DEFAULT_REGISTRY_FILE;
  if (!fs.existsSync(filePath)) {
    return defaultRegistry();
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    // Ensure built-in patterns are always present
    if (!data.patterns) data.patterns = [...BUILTIN_PATTERNS];
    return data;
  } catch {
    return defaultRegistry();
  }
}

/**
 * Save registry to disk.
 * @param {object} registry
 * @param {string} [registryFile]
 */
function saveRegistry(registry, registryFile) {
  const filePath = registryFile || DEFAULT_REGISTRY_FILE;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(registry, null, 2) + '\n', 'utf8');
}

/**
 * List available reference architectures.
 *
 * @param {object} [filter]
 * @param {object} [options]
 * @returns {object}
 */
function listPatterns(filter = {}, options = {}) {
  const registryFile = options.registryFile || DEFAULT_REGISTRY_FILE;
  const registry = loadRegistry(registryFile);

  let allPatterns = [...registry.patterns, ...(registry.custom_patterns || [])];

  if (filter.category) {
    allPatterns = allPatterns.filter(p => p.category === filter.category);
  }

  return {
    success: true,
    patterns: allPatterns.map(p => ({
      id: p.id,
      name: p.name,
      category: p.category,
      description: p.description,
      components: p.components.length
    })),
    total: allPatterns.length,
    categories: [...new Set(allPatterns.map(p => p.category))]
  };
}

/**
 * Get detailed reference architecture.
 *
 * @param {string} patternId
 * @param {object} [options]
 * @returns {object}
 */
function getPattern(patternId, options = {}) {
  const registryFile = options.registryFile || DEFAULT_REGISTRY_FILE;
  const registry = loadRegistry(registryFile);

  const allPatterns = [...registry.patterns, ...(registry.custom_patterns || [])];
  const pattern = allPatterns.find(p => p.id === patternId);

  if (!pattern) {
    return { success: false, error: `Pattern not found: ${patternId}` };
  }

  return { success: true, pattern };
}

/**
 * Register a custom reference architecture.
 *
 * @param {object} pattern
 * @param {object} [options]
 * @returns {object}
 */
function registerPattern(pattern, options = {}) {
  if (!pattern || !pattern.name || !pattern.description) {
    return { success: false, error: 'name and description are required' };
  }

  const registryFile = options.registryFile || DEFAULT_REGISTRY_FILE;
  const registry = loadRegistry(registryFile);

  const id = pattern.id || pattern.name.toLowerCase().replace(/\s+/g, '-');
  const allPatterns = [...registry.patterns, ...(registry.custom_patterns || [])];
  if (allPatterns.find(p => p.id === id)) {
    return { success: false, error: `Pattern "${id}" already exists` };
  }

  const newPattern = {
    id,
    name: pattern.name.trim(),
    category: PATTERN_CATEGORIES.includes(pattern.category) ? pattern.category : 'other',
    description: pattern.description.trim(),
    components: pattern.components || [],
    tech_stack: pattern.tech_stack || { suggested: [] },
    structure: pattern.structure || {},
    nfrs: pattern.nfrs || [],
    custom: true,
    created_at: new Date().toISOString()
  };

  if (!registry.custom_patterns) registry.custom_patterns = [];
  registry.custom_patterns.push(newPattern);
  saveRegistry(registry, registryFile);

  return { success: true, pattern: newPattern };
}

/**
 * Instantiate a reference architecture in a project.
 *
 * @param {string} patternId
 * @param {string} root - Project root.
 * @param {object} [options]
 * @returns {object}
 */
function instantiatePattern(patternId, root, options = {}) {
  const registryFile = options.registryFile || path.join(root, DEFAULT_REGISTRY_FILE);
  const registry = loadRegistry(registryFile);
  const allPatterns = [...registry.patterns, ...(registry.custom_patterns || [])];
  const pattern = allPatterns.find(p => p.id === patternId);

  if (!pattern) {
    return { success: false, error: `Pattern not found: ${patternId}` };
  }

  const created = [];
  const skipped = [];

  // Create directory structure
  for (const [dir, description] of Object.entries(pattern.structure || {})) {
    const fullDir = path.join(root, dir);
    if (!fs.existsSync(fullDir)) {
      fs.mkdirSync(fullDir, { recursive: true });
      // Create a README.md in each directory
      const readmePath = path.join(fullDir, 'README.md');
      fs.writeFileSync(readmePath, `# ${dir.replace(/\/$/, '').split('/').pop()}\n\n${description}\n\nPart of the **${pattern.name}** reference architecture.\n`, 'utf8');
      created.push(dir);
    } else {
      skipped.push(dir);
    }
  }

  // Record instantiation
  registry.instantiation_history = registry.instantiation_history || [];
  registry.instantiation_history.push({
    pattern_id: patternId,
    instantiated_at: new Date().toISOString(),
    root: path.resolve(root),
    directories_created: created.length
  });
  saveRegistry(registry, registryFile);

  return {
    success: true,
    pattern: patternId,
    pattern_name: pattern.name,
    directories_created: created,
    directories_skipped: skipped,
    components: pattern.components,
    suggested_tech_stack: pattern.tech_stack,
    nfrs: pattern.nfrs
  };
}

module.exports = {
  defaultRegistry,
  loadRegistry,
  saveRegistry,
  listPatterns,
  getPattern,
  registerPattern,
  instantiatePattern,
  BUILTIN_PATTERNS,
  PATTERN_CATEGORIES
};
