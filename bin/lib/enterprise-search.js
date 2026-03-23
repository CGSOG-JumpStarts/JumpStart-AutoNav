/**
 * enterprise-search.js — Enterprise Search Over Artifacts (Item 96)
 *
 * Ask questions across specs, code, ADRs, incidents, and release records.
 *
 * Usage:
 *   node bin/lib/enterprise-search.js index|search|report [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SEARCHABLE_TYPES = ['spec', 'code', 'adr', 'incident', 'release', 'config'];

function indexProject(root, options = {}) {
  const index = {
    root,
    indexed_at: new Date().toISOString(),
    entries: []
  };

  // Index specs
  const specsDir = path.join(root, 'specs');
  if (fs.existsSync(specsDir)) {
    indexDirectory(specsDir, 'spec', root, index.entries);
  }

  // Index decisions
  const decisionsDir = path.join(root, 'specs', 'decisions');
  if (fs.existsSync(decisionsDir)) {
    indexDirectory(decisionsDir, 'adr', root, index.entries);
  }

  // Index source
  const srcDir = path.join(root, 'src');
  if (fs.existsSync(srcDir)) {
    indexDirectory(srcDir, 'code', root, index.entries, ['.js', '.ts', '.py', '.java', '.go']);
  }

  // Index config
  const configFile = path.join(root, '.jumpstart', 'config.yaml');
  if (fs.existsSync(configFile)) {
    index.entries.push({
      type: 'config',
      path: '.jumpstart/config.yaml',
      size: fs.statSync(configFile).size
    });
  }

  return { success: true, total_entries: index.entries.length, index };
}

function indexDirectory(dir, type, root, entries, extensions) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (extensions && !extensions.includes(ext)) continue;
      if (entry.name.startsWith('.')) continue;
      const fp = path.join(dir, entry.name);
      const relPath = path.relative(root, fp).replace(/\\/g, '/');
      entries.push({ type, path: relPath, name: entry.name, size: fs.statSync(fp).size });
    } else if (entry.isDirectory() && !['node_modules', '.git', 'dist'].includes(entry.name)) {
      indexDirectory(path.join(dir, entry.name), type, root, entries, extensions);
    }
  }
}

function searchProject(root, query, options = {}) {
  if (!query) return { success: false, error: 'Search query is required' };

  const q = query.toLowerCase();
  const results = [];
  const searchDirs = [
    { dir: path.join(root, 'specs'), type: 'spec' },
    { dir: path.join(root, 'specs', 'decisions'), type: 'adr' },
    { dir: path.join(root, 'src'), type: 'code' }
  ];

  for (const { dir, type } of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    searchInDirectory(dir, q, type, root, results, options.maxResults || 20);
  }

  return {
    success: true,
    query,
    total_results: results.length,
    results: results.slice(0, options.maxResults || 20)
  };
}

function searchInDirectory(dir, query, type, root, results, maxResults) {
  if (!fs.existsSync(dir) || results.length >= maxResults) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (results.length >= maxResults) return;
    if (entry.isFile() && !entry.name.startsWith('.')) {
      try {
        const fp = path.join(dir, entry.name);
        const content = fs.readFileSync(fp, 'utf8');
        if (content.toLowerCase().includes(query)) {
          const relPath = path.relative(root, fp).replace(/\\/g, '/');
          const lines = content.split('\n');
          const matchingLines = lines
            .map((l, i) => ({ line: i + 1, text: l.trim() }))
            .filter(l => l.text.toLowerCase().includes(query))
            .slice(0, 3);

          results.push({ type, path: relPath, matches: matchingLines.length, preview: matchingLines });
        }
      } catch { /* skip binary/unreadable */ }
    } else if (entry.isDirectory() && !['node_modules', '.git', 'dist'].includes(entry.name)) {
      searchInDirectory(path.join(dir, entry.name), query, type, root, results, maxResults);
    }
  }
}

module.exports = {
  indexProject, searchProject,
  SEARCHABLE_TYPES
};
