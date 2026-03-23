/**
 * project-memory.js — Persistent Long-Term Project Memory
 *
 * Captures team decisions, rejected options, recurring pitfalls, and
 * tribal knowledge beyond artifact files. Acts as an ever-growing
 * organizational knowledge base for the project.
 *
 * Usage:
 *   node bin/lib/project-memory.js add|list|search|recall [options]
 *
 * State file: .jumpstart/state/project-memory.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_MEMORY_FILE = path.join('.jumpstart', 'state', 'project-memory.json');

const MEMORY_TYPES = ['decision', 'rejection', 'pitfall', 'tribal', 'insight', 'other'];

/**
 * Default memory store structure.
 * @returns {object}
 */
function defaultMemoryStore() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    entries: []
  };
}

/**
 * Load the memory store from disk.
 * @param {string} [memoryFile]
 * @returns {object}
 */
function loadMemoryStore(memoryFile) {
  const filePath = memoryFile || DEFAULT_MEMORY_FILE;
  if (!fs.existsSync(filePath)) {
    return defaultMemoryStore();
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return defaultMemoryStore();
  }
}

/**
 * Save the memory store to disk.
 * @param {object} store
 * @param {string} [memoryFile]
 */
function saveMemoryStore(store, memoryFile) {
  const filePath = memoryFile || DEFAULT_MEMORY_FILE;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  store.last_updated = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2) + '\n', 'utf8');
}

/**
 * Add a new memory entry to the store.
 *
 * @param {object} entry - { type, title, content, tags?, author?, phase? }
 * @param {object} [options]
 * @returns {object}
 */
function addMemory(entry, options = {}) {
  if (!entry || !entry.title || !entry.content) {
    return { success: false, error: 'entry.title and entry.content are required' };
  }

  const type = (entry.type || 'other').toLowerCase();
  if (!MEMORY_TYPES.includes(type)) {
    return { success: false, error: `type must be one of: ${MEMORY_TYPES.join(', ')}` };
  }

  const memoryFile = options.memoryFile || DEFAULT_MEMORY_FILE;
  const store = loadMemoryStore(memoryFile);

  const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const newEntry = {
    id,
    type,
    title: entry.title.trim(),
    content: entry.content.trim(),
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    author: entry.author || null,
    phase: entry.phase !== undefined ? entry.phase : null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  store.entries.push(newEntry);
  saveMemoryStore(store, memoryFile);

  return { success: true, entry: newEntry, total: store.entries.length };
}

/**
 * List memory entries, optionally filtered.
 *
 * @param {object} [filter] - { type?, tag?, phase? }
 * @param {object} [options]
 * @returns {object}
 */
function listMemories(filter = {}, options = {}) {
  const memoryFile = options.memoryFile || DEFAULT_MEMORY_FILE;
  const store = loadMemoryStore(memoryFile);

  let entries = store.entries;

  if (filter.type) {
    entries = entries.filter(e => e.type === filter.type);
  }

  if (filter.tag) {
    entries = entries.filter(e => e.tags && e.tags.includes(filter.tag));
  }

  if (filter.phase !== undefined && filter.phase !== null) {
    entries = entries.filter(e => e.phase === filter.phase);
  }

  return { success: true, entries, total: entries.length };
}

/**
 * Search memory entries by keyword in title or content.
 *
 * @param {string} keyword
 * @param {object} [options]
 * @returns {object}
 */
function searchMemories(keyword, options = {}) {
  if (!keyword || typeof keyword !== 'string') {
    return { success: false, error: 'keyword is required' };
  }

  const memoryFile = options.memoryFile || DEFAULT_MEMORY_FILE;
  const store = loadMemoryStore(memoryFile);

  const lower = keyword.toLowerCase();
  const entries = store.entries.filter(
    e =>
      e.title.toLowerCase().includes(lower) ||
      e.content.toLowerCase().includes(lower) ||
      (e.tags && e.tags.some(t => t.toLowerCase().includes(lower)))
  );

  return { success: true, keyword, entries, total: entries.length };
}

/**
 * Recall (get) a specific memory entry by ID.
 *
 * @param {string} id
 * @param {object} [options]
 * @returns {object}
 */
function recallMemory(id, options = {}) {
  const memoryFile = options.memoryFile || DEFAULT_MEMORY_FILE;
  const store = loadMemoryStore(memoryFile);

  const entry = store.entries.find(e => e.id === id);
  if (!entry) {
    return { success: false, error: `Memory entry not found: ${id}` };
  }

  return { success: true, entry };
}

/**
 * Delete a memory entry by ID.
 *
 * @param {string} id
 * @param {object} [options]
 * @returns {object}
 */
function deleteMemory(id, options = {}) {
  const memoryFile = options.memoryFile || DEFAULT_MEMORY_FILE;
  const store = loadMemoryStore(memoryFile);

  const idx = store.entries.findIndex(e => e.id === id);
  if (idx === -1) {
    return { success: false, error: `Memory entry not found: ${id}` };
  }

  const [removed] = store.entries.splice(idx, 1);
  saveMemoryStore(store, memoryFile);

  return { success: true, removed, total: store.entries.length };
}

/**
 * Get memory statistics grouped by type.
 *
 * @param {object} [options]
 * @returns {object}
 */
function getMemoryStats(options = {}) {
  const memoryFile = options.memoryFile || DEFAULT_MEMORY_FILE;
  const store = loadMemoryStore(memoryFile);

  const byType = {};
  for (const type of MEMORY_TYPES) {
    byType[type] = store.entries.filter(e => e.type === type).length;
  }

  return {
    total: store.entries.length,
    by_type: byType,
    last_updated: store.last_updated
  };
}

module.exports = {
  loadMemoryStore,
  saveMemoryStore,
  defaultMemoryStore,
  addMemory,
  listMemories,
  searchMemories,
  recallMemory,
  deleteMemory,
  getMemoryStats,
  MEMORY_TYPES
};
