/**
 * codebase-retrieval.js — Codebase-Native Retrieval Layer (Item 41)
 *
 * Retrieve the right files, ADRs, test patterns, and prior
 * implementations automatically during execution.
 *
 * Usage:
 *   node bin/lib/codebase-retrieval.js query|index|status [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const RETRIEVABLE_TYPES = ['adrs', 'test-patterns', 'implementations', 'specs', 'configs'];

const FILE_PATTERNS = {
  adrs: ['specs/decisions/*.md', 'docs/decisions/*.md', 'adr/*.md'],
  'test-patterns': ['tests/**/*.test.*', 'test/**/*.test.*', '__tests__/**/*'],
  specs: ['specs/*.md', 'docs/*.md'],
  configs: ['.jumpstart/*.yaml', '.jumpstart/*.json', 'package.json', 'tsconfig.json']
};

/**
 * Index project files by type.
 *
 * @param {string} root - Project root.
 * @param {object} [options]
 * @returns {object}
 */
function indexProject(root, options = {}) {
  const index = {};
  const excludeDirs = options.excludeDirs || ['node_modules', '.git', 'dist', 'build'];

  function walk(dir, relDir) {
    if (!fs.existsSync(dir)) return [];
    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = path.join(relDir, entry.name);
      if (entry.isDirectory()) {
        if (!excludeDirs.includes(entry.name)) {
          results.push(...walk(path.join(dir, entry.name), rel));
        }
      } else if (entry.isFile()) {
        results.push(rel.replace(/\\/g, '/'));
      }
    }
    return results;
  }

  const allFiles = walk(root, '');

  // Categorize files
  index.adrs = allFiles.filter(f => /specs\/decisions\/|docs\/decisions\/|^adr\//i.test(f) && f.endsWith('.md'));
  index['test-patterns'] = allFiles.filter(f => /\.test\.|\.spec\.|__tests__/i.test(f));
  index.specs = allFiles.filter(f => /^specs\/.*\.md$/i.test(f));
  index.configs = allFiles.filter(f => /package\.json$|tsconfig|\.jumpstart\//i.test(f));
  index.implementations = allFiles.filter(f => /^src\//i.test(f));

  return {
    success: true,
    total_files: allFiles.length,
    indexed: Object.entries(index).reduce((sum, [, files]) => sum + files.length, 0),
    categories: Object.entries(index).map(([type, files]) => ({ type, count: files.length })),
    index
  };
}

/**
 * Query for relevant files based on context.
 *
 * @param {string} root - Project root.
 * @param {string} query - Search query.
 * @param {object} [options]
 * @returns {object}
 */
function queryFiles(root, query, options = {}) {
  if (!query) return { success: false, error: 'query is required' };

  const idx = indexProject(root, options);
  const queryLower = query.toLowerCase();
  const results = [];

  // Search through all indexed files
  for (const [type, files] of Object.entries(idx.index)) {
    for (const file of files) {
      const absPath = path.join(root, file);
      try {
        const content = fs.readFileSync(absPath, 'utf8');
        if (content.toLowerCase().includes(queryLower) || file.toLowerCase().includes(queryLower)) {
          const lines = content.split('\n');
          const matchingLines = lines
            .map((line, i) => ({ line: i + 1, content: line }))
            .filter(l => l.content.toLowerCase().includes(queryLower))
            .slice(0, 5);

          results.push({
            file,
            type,
            matches: matchingLines.length,
            preview: matchingLines
          });
        }
      } catch { /* skip */ }
    }
  }

  // Sort by match count
  results.sort((a, b) => b.matches - a.matches);

  return {
    success: true,
    query,
    total_results: results.length,
    results: results.slice(0, options.limit || 20)
  };
}

module.exports = {
  indexProject,
  queryFiles,
  RETRIEVABLE_TYPES,
  FILE_PATTERNS
};
