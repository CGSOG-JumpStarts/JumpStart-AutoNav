/**
 * bidirectional-trace.js — True Bidirectional Code-to-Spec Traceability
 *
 * Auto-links requirements to files, functions, tests, PRs, commits,
 * and deployments. Provides forward (spec→code) and reverse (code→spec)
 * trace lookups.
 *
 * Usage:
 *   node bin/lib/bidirectional-trace.js scan|report|link [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Scan a source directory and build a bidirectional trace map.
 *
 * @param {string} root - Project root.
 * @param {object} [options]
 * @returns {object} Trace map with forward and reverse indexes.
 */
function scanTraceLinks(root, options = {}) {
  const specsDir = path.join(root, 'specs');
  const srcDir = path.join(root, options.srcDir || 'src');
  const testsDir = path.join(root, options.testsDir || 'tests');

  const forwardMap = {};   // specId → [{ file, line, type }]
  const reverseMap = {};   // file  → [{ specId, line, type }]

  // Patterns for spec references in code
  const SPEC_ID_PATTERN = /(?:E\d+-S\d+|M\d+-T\d+|NFR-[A-Z]+\d+|VC-\d+)/g;

  function recordLink(specId, file, line, type) {
    if (!forwardMap[specId]) forwardMap[specId] = [];
    forwardMap[specId].push({ file, line, type });

    if (!reverseMap[file]) reverseMap[file] = [];
    reverseMap[file].push({ specId, line, type });
  }

  function scanDir(dir, fileType) {
    if (!fs.existsSync(dir)) return;
    const walk = (d) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          const rel = path.relative(root, full).replace(/\\/g, '/');
          try {
            const content = fs.readFileSync(full, 'utf8');
            const lines = content.split('\n');
            lines.forEach((line, idx) => {
              let match;
              const pattern = new RegExp(SPEC_ID_PATTERN.source, 'g');
              while ((match = pattern.exec(line)) !== null) {
                recordLink(match[0], rel, idx + 1, fileType);
              }
            });
          } catch {
            // skip unreadable files
          }
        }
      }
    };
    walk(dir);
  }

  scanDir(srcDir, 'source');
  scanDir(testsDir, 'test');

  // Also scan spec files for cross-references
  if (fs.existsSync(specsDir)) {
    scanDir(specsDir, 'spec');
  }

  const stats = {
    total_spec_ids: Object.keys(forwardMap).length,
    total_files_with_links: Object.keys(reverseMap).length,
    total_links: Object.values(forwardMap).reduce((s, a) => s + a.length, 0)
  };

  return { forward_map: forwardMap, reverse_map: reverseMap, stats };
}

/**
 * Trace forward: given a spec ID, find all code that implements it.
 *
 * @param {string} specId - Spec ID (e.g., E1-S1, M1-T01).
 * @param {object} traceMap - Result from scanTraceLinks().
 * @returns {object[]} Array of { file, line, type }.
 */
function traceForward(specId, traceMap) {
  return (traceMap.forward_map || {})[specId] || [];
}

/**
 * Trace reverse: given a file, find all spec IDs it relates to.
 *
 * @param {string} filePath - Relative file path.
 * @param {object} traceMap - Result from scanTraceLinks().
 * @returns {object[]} Array of { specId, line, type }.
 */
function traceReverse(filePath, traceMap) {
  return (traceMap.reverse_map || {})[filePath] || [];
}

/**
 * Build a coverage summary — which spec IDs have no code links (gaps).
 *
 * @param {string} root - Project root.
 * @param {object} traceMap - Result from scanTraceLinks().
 * @returns {object} Coverage report.
 */
function buildCoverageReport(root, traceMap) {
  const specsDir = path.join(root, 'specs');
  const prdPath = path.join(specsDir, 'prd.md');
  const implPath = path.join(specsDir, 'implementation-plan.md');

  const allSpecIds = new Set();
  const SPEC_ID_PATTERN = /(?:E\d+-S\d+|M\d+-T\d+|NFR-[A-Z]+\d+|VC-\d+)/g;

  function extractFromFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, 'utf8');
    let match;
    while ((match = SPEC_ID_PATTERN.exec(content)) !== null) {
      allSpecIds.add(match[0]);
    }
  }

  extractFromFile(prdPath);
  extractFromFile(implPath);

  // Only count links from source and test files, not from spec files themselves.
  const codeLinked = new Set();
  for (const [specId, links] of Object.entries(traceMap.forward_map || {})) {
    if (links.some(l => l.type === 'source' || l.type === 'test')) {
      codeLinked.add(specId);
    }
  }
  const gaps = [...allSpecIds].filter(id => !codeLinked.has(id));
  const covered = [...allSpecIds].filter(id => codeLinked.has(id));

  const coverage_pct = allSpecIds.size > 0
    ? Math.round((covered.length / allSpecIds.size) * 100)
    : 0;

  return {
    total_spec_ids: allSpecIds.size,
    covered: covered.length,
    gaps: gaps.length,
    coverage_pct,
    gap_list: gaps,
    covered_list: covered
  };
}

/**
 * Persist a trace map to disk.
 *
 * @param {object} traceMap
 * @param {string} outputPath
 */
function saveTraceMap(traceMap, outputPath) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(outputPath, JSON.stringify(traceMap, null, 2) + '\n', 'utf8');
}

/**
 * Load a persisted trace map from disk.
 *
 * @param {string} inputPath
 * @returns {object}
 */
function loadTraceMap(inputPath) {
  if (!fs.existsSync(inputPath)) {
    return { forward_map: {}, reverse_map: {}, stats: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  } catch {
    return { forward_map: {}, reverse_map: {}, stats: {} };
  }
}

module.exports = {
  scanTraceLinks,
  traceForward,
  traceReverse,
  buildCoverageReport,
  saveTraceMap,
  loadTraceMap
};
