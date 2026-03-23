/**
 * deterministic-artifacts.js — Deterministic Artifact Generation Mode (Item 56)
 *
 * Make outputs as stable as possible for governance and repeatability.
 *
 * Usage:
 *   node bin/lib/deterministic-artifacts.js normalize|verify|diff [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Normalize markdown content for deterministic comparison.
 *
 * @param {string} content - Markdown content.
 * @returns {string}
 */
function normalizeMarkdown(content) {
  return content
    .replace(/\r\n/g, '\n')                    // Normalize line endings
    .replace(/\t/g, '  ')                       // Tabs to spaces
    .replace(/[ \t]+$/gm, '')                   // Trailing whitespace
    .replace(/\n{3,}/g, '\n\n')                 // Max 2 consecutive newlines
    .replace(/<!--.*?-->/gs, '')                // Remove HTML comments
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\s]*/g, '[TIMESTAMP]')  // Normalize timestamps
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[UUID]')  // Normalize UUIDs
    .trim() + '\n';
}

/**
 * Generate a content hash for an artifact.
 *
 * @param {string} content
 * @returns {string}
 */
function hashContent(content) {
  const normalized = normalizeMarkdown(content);
  return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 16);
}

/**
 * Normalize a file for deterministic comparison.
 *
 * @param {string} filePath
 * @param {object} [options]
 * @returns {object}
 */
function normalizeFile(filePath, options = {}) {
  if (!fs.existsSync(filePath)) {
    return { success: false, error: `File not found: ${filePath}` };
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const normalized = normalizeMarkdown(content);
  const hash = hashContent(content);

  if (options.write) {
    fs.writeFileSync(filePath, normalized, 'utf8');
  }

  return {
    success: true,
    file: filePath,
    original_length: content.length,
    normalized_length: normalized.length,
    hash,
    modified: content !== normalized
  };
}

/**
 * Verify artifact stability between versions.
 *
 * @param {string} file1
 * @param {string} file2
 * @returns {object}
 */
function verifyStability(file1, file2) {
  if (!fs.existsSync(file1)) return { success: false, error: `File not found: ${file1}` };
  if (!fs.existsSync(file2)) return { success: false, error: `File not found: ${file2}` };

  const content1 = normalizeMarkdown(fs.readFileSync(file1, 'utf8'));
  const content2 = normalizeMarkdown(fs.readFileSync(file2, 'utf8'));
  const hash1 = hashContent(content1);
  const hash2 = hashContent(content2);

  const lines1 = content1.split('\n');
  const lines2 = content2.split('\n');
  let diffLines = 0;

  const maxLines = Math.max(lines1.length, lines2.length);
  for (let i = 0; i < maxLines; i++) {
    if (lines1[i] !== lines2[i]) diffLines++;
  }

  const similarity = maxLines > 0 ? Math.round(((maxLines - diffLines) / maxLines) * 100) : 100;

  return {
    success: true,
    identical: hash1 === hash2,
    similarity,
    hash1,
    hash2,
    diff_lines: diffLines,
    total_lines: maxLines
  };
}

/**
 * Batch normalize all spec files.
 *
 * @param {string} root
 * @param {object} [options]
 * @returns {object}
 */
function normalizeSpecs(root, options = {}) {
  const specsDir = path.join(root, 'specs');
  if (!fs.existsSync(specsDir)) {
    return { success: true, files: 0, message: 'No specs directory found' };
  }

  const results = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
      else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(normalizeFile(path.join(dir, entry.name), options));
      }
    }
  }
  walk(specsDir);

  return {
    success: true,
    files: results.length,
    modified: results.filter(r => r.modified).length,
    results
  };
}

module.exports = {
  normalizeMarkdown,
  hashContent,
  normalizeFile,
  verifyStability,
  normalizeSpecs
};
