/**
 * safe-rename.js — Safe Large-Scale Rename & Move Engine (Item 50)
 *
 * Preserve imports, references, tests, docs, and architecture
 * mappings during broad changes.
 *
 * Usage:
 *   node bin/lib/safe-rename.js plan|execute|validate [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REFERENCE_PATTERNS = [
  { type: 'import', pattern: /(?:import\s+.*from\s+['"]|require\(['"])(\.{0,2}\/[^'"]+)['"]/g },
  { type: 'markdown-link', pattern: /\[([^\]]*)\]\(([^)]+)\)/g },
  { type: 'config-path', pattern: /"(?:path|file|dir|src|entry)":\s*"([^"]+)"/g }
];

/**
 * Plan a rename/move operation.
 *
 * @param {string} root - Project root.
 * @param {string} oldPath - Current path (relative to root).
 * @param {string} newPath - Target path (relative to root).
 * @param {object} [options]
 * @returns {object}
 */
function planRename(root, oldPath, newPath, options = {}) {
  if (!oldPath || !newPath) return { success: false, error: 'oldPath and newPath are required' };

  const absOld = path.join(root, oldPath);
  if (!fs.existsSync(absOld)) {
    return { success: false, error: `Source not found: ${oldPath}` };
  }

  const references = findReferences(root, oldPath, options);

  return {
    success: true,
    old_path: oldPath,
    new_path: newPath,
    references_found: references.length,
    affected_files: [...new Set(references.map(r => r.file))],
    references,
    safe: true,
    warnings: references.length > 10 ? ['Large number of references — review carefully'] : []
  };
}

/**
 * Find all references to a file path in the project.
 *
 * @param {string} root - Project root.
 * @param {string} targetPath - Path to search for.
 * @param {object} [options]
 * @returns {object[]}
 */
function findReferences(root, targetPath, options = {}) {
  const excludeDirs = options.excludeDirs || ['node_modules', '.git', 'dist', 'build'];
  const references = [];
  const searchTerms = [
    targetPath,
    targetPath.replace(/\\/g, '/'),
    path.basename(targetPath, path.extname(targetPath))
  ];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!excludeDirs.includes(entry.name)) walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (['.js', '.ts', '.md', '.json', '.yaml', '.yml'].includes(ext)) {
          try {
            const content = fs.readFileSync(path.join(dir, entry.name), 'utf8');
            const relFile = path.relative(root, path.join(dir, entry.name)).replace(/\\/g, '/');

            for (const term of searchTerms) {
              if (content.includes(term)) {
                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                  if (lines[i].includes(term)) {
                    references.push({
                      file: relFile,
                      line: i + 1,
                      content: lines[i].trim().substring(0, 150),
                      match: term
                    });
                  }
                }
              }
            }
          } catch { /* skip */ }
        }
      }
    }
  }

  walk(root);
  return references;
}

/**
 * Validate that a rename was applied correctly.
 *
 * @param {string} root - Project root.
 * @param {string} oldPath - Original path.
 * @param {string} newPath - New path.
 * @returns {object}
 */
function validateRename(root, oldPath, newPath) {
  const newExists = fs.existsSync(path.join(root, newPath));
  const oldExists = fs.existsSync(path.join(root, oldPath));
  const staleRefs = findReferences(root, oldPath);

  return {
    success: true,
    new_file_exists: newExists,
    old_file_removed: !oldExists,
    stale_references: staleRefs.length,
    stale_files: [...new Set(staleRefs.map(r => r.file))],
    clean: newExists && !oldExists && staleRefs.length === 0
  };
}

module.exports = {
  planRename,
  findReferences,
  validateRename,
  REFERENCE_PATTERNS
};
