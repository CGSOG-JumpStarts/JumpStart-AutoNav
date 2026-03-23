/**
 * semantic-diff.js — Cross-artifact Semantic Diffing
 *
 * Detects meaning changes, not just text changes, across PRD,
 * architecture, APIs, and tests.
 *
 * Usage:
 *   node bin/lib/semantic-diff.js compare <path1> <path2> [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SECTION_HEADING = /^(#{1,6})\s+(.+)$/gm;
const REQUIREMENT_PATTERN = /\b(REQ-\d+|E\d+-S\d+|NFR-\d+|UC-\d+|FR-\d+|AC-\d+|M\d+-T\d+)\b/g;
const API_ENDPOINT = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)/g;
const TABLE_ROW = /^\|(.+)\|$/gm;

/**
 * Extract structural sections from markdown.
 * @param {string} content
 * @returns {object[]}
 */
function extractSections(content) {
  const sections = [];
  const lines = content.split('\n');
  let currentSection = { heading: '(preamble)', level: 0, content: [], startLine: 0 };

  for (let i = 0; i < lines.length; i++) {
    const headingMatch = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (currentSection.content.length > 0 || currentSection.heading !== '(preamble)') {
        currentSection.content = currentSection.content.join('\n').trim();
        sections.push(currentSection);
      }
      currentSection = {
        heading: headingMatch[2].trim(),
        level: headingMatch[1].length,
        content: [],
        startLine: i + 1
      };
    } else {
      currentSection.content.push(lines[i]);
    }
  }
  currentSection.content = currentSection.content.join('\n').trim();
  sections.push(currentSection);

  return sections;
}

/**
 * Extract requirement references from content.
 * @param {string} content
 * @returns {string[]}
 */
function extractRequirements(content) {
  const matches = content.match(REQUIREMENT_PATTERN) || [];
  return [...new Set(matches)].sort();
}

/**
 * Extract API endpoints from content.
 * @param {string} content
 * @returns {object[]}
 */
function extractApiEndpoints(content) {
  const endpoints = [];
  let match;
  const pattern = new RegExp(API_ENDPOINT.source, 'g');
  while ((match = pattern.exec(content)) !== null) {
    endpoints.push({ method: match[1], path: match[2] });
  }
  return endpoints;
}

/**
 * Extract key-value pairs from table rows.
 * @param {string} content
 * @returns {string[][]}
 */
function extractTableData(content) {
  const rows = [];
  let match;
  const pattern = new RegExp(TABLE_ROW.source, 'gm');
  while ((match = pattern.exec(content)) !== null) {
    const cells = match[1].split('|').map(c => c.trim()).filter(c => c.length > 0);
    if (cells.some(c => /^[-:]+$/.test(c))) continue; // skip separator rows
    rows.push(cells);
  }
  return rows;
}

/**
 * Normalize text for comparison: lowercase, collapse whitespace, strip punctuation.
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
  return text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compute simple similarity ratio between two strings (0-1).
 * Uses set-based word overlap (Jaccard-like).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function textSimilarity(a, b) {
  const wordsA = new Set(normalizeText(a).split(' ').filter(w => w.length > 2));
  const wordsB = new Set(normalizeText(b).split(' ').filter(w => w.length > 2));
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = new Set([...wordsA, ...wordsB]).size;
  return union === 0 ? 1 : intersection / union;
}

/**
 * Compare two artifacts and find semantic differences.
 *
 * @param {string} contentA - Original content.
 * @param {string} contentB - Modified content.
 * @param {object} [options]
 * @returns {object}
 */
function compareArtifacts(contentA, contentB, options = {}) {
  const sectionsA = extractSections(contentA);
  const sectionsB = extractSections(contentB);

  const sectionChanges = [];
  const headingsA = sectionsA.map(s => s.heading);
  const headingsB = sectionsB.map(s => s.heading);

  // Detect added sections
  for (const sec of sectionsB) {
    if (!headingsA.includes(sec.heading)) {
      sectionChanges.push({
        type: 'section_added',
        heading: sec.heading,
        severity: 'info'
      });
    }
  }

  // Detect removed sections
  for (const sec of sectionsA) {
    if (!headingsB.includes(sec.heading)) {
      sectionChanges.push({
        type: 'section_removed',
        heading: sec.heading,
        severity: 'warning'
      });
    }
  }

  // Detect modified sections
  for (const secA of sectionsA) {
    const secB = sectionsB.find(s => s.heading === secA.heading);
    if (secB) {
      const similarity = textSimilarity(secA.content, secB.content);
      if (similarity < 0.95) {
        sectionChanges.push({
          type: 'section_modified',
          heading: secA.heading,
          similarity: Math.round(similarity * 100),
          severity: similarity < 0.5 ? 'critical' : similarity < 0.8 ? 'warning' : 'info'
        });
      }
    }
  }

  // Requirement changes
  const reqsA = extractRequirements(contentA);
  const reqsB = extractRequirements(contentB);
  const addedReqs = reqsB.filter(r => !reqsA.includes(r));
  const removedReqs = reqsA.filter(r => !reqsB.includes(r));

  // API endpoint changes
  const apisA = extractApiEndpoints(contentA);
  const apisB = extractApiEndpoints(contentB);
  const apiKeysA = apisA.map(a => `${a.method} ${a.path}`);
  const apiKeysB = apisB.map(a => `${a.method} ${a.path}`);
  const addedApis = apiKeysB.filter(k => !apiKeysA.includes(k));
  const removedApis = apiKeysA.filter(k => !apiKeysB.includes(k));

  // Table changes
  const tablesA = extractTableData(contentA);
  const tablesB = extractTableData(contentB);

  const overallSimilarity = textSimilarity(contentA, contentB);
  const hasBreakingChanges = removedReqs.length > 0 || removedApis.length > 0
    || sectionChanges.some(c => c.severity === 'critical');

  return {
    success: true,
    overall_similarity: Math.round(overallSimilarity * 100),
    has_breaking_changes: hasBreakingChanges,
    section_changes: sectionChanges,
    requirement_changes: {
      added: addedReqs,
      removed: removedReqs,
      total_before: reqsA.length,
      total_after: reqsB.length
    },
    api_changes: {
      added: addedApis,
      removed: removedApis,
      total_before: apisA.length,
      total_after: apisB.length
    },
    table_changes: {
      rows_before: tablesA.length,
      rows_after: tablesB.length
    },
    summary: {
      sections_added: sectionChanges.filter(c => c.type === 'section_added').length,
      sections_removed: sectionChanges.filter(c => c.type === 'section_removed').length,
      sections_modified: sectionChanges.filter(c => c.type === 'section_modified').length,
      requirements_added: addedReqs.length,
      requirements_removed: removedReqs.length,
      apis_added: addedApis.length,
      apis_removed: removedApis.length
    }
  };
}

/**
 * Compare two artifact files on disk.
 *
 * @param {string} pathA - Path to original artifact.
 * @param {string} pathB - Path to modified artifact.
 * @param {object} [options]
 * @returns {object}
 */
function compareFiles(pathA, pathB, options = {}) {
  if (!fs.existsSync(pathA)) {
    return { success: false, error: `File not found: ${pathA}` };
  }
  if (!fs.existsSync(pathB)) {
    return { success: false, error: `File not found: ${pathB}` };
  }

  const contentA = fs.readFileSync(pathA, 'utf8');
  const contentB = fs.readFileSync(pathB, 'utf8');

  const result = compareArtifacts(contentA, contentB, options);
  result.file_a = pathA;
  result.file_b = pathB;
  return result;
}

/**
 * Detect cross-artifact consistency issues across multiple spec files.
 *
 * @param {string} root - Project root.
 * @param {object} [options]
 * @returns {object}
 */
function crossArtifactDiff(root, options = {}) {
  const specsDir = path.join(root, 'specs');
  if (!fs.existsSync(specsDir)) {
    return { success: false, error: 'specs/ directory not found' };
  }

  const artifacts = {};
  const artifactFiles = ['challenger-brief.md', 'product-brief.md', 'prd.md', 'architecture.md', 'implementation-plan.md'];

  for (const file of artifactFiles) {
    const fullPath = path.join(specsDir, file);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      artifacts[file] = {
        content,
        requirements: extractRequirements(content),
        apis: extractApiEndpoints(content),
        sections: extractSections(content)
      };
    }
  }

  const inconsistencies = [];

  // Check requirement coverage flow (upstream → downstream)
  const orderedKeys = Object.keys(artifacts);
  for (let i = 0; i < orderedKeys.length - 1; i++) {
    const upstream = artifacts[orderedKeys[i]];
    const downstream = artifacts[orderedKeys[i + 1]];
    if (!upstream || !downstream) continue;

    const missingDownstream = upstream.requirements.filter(r => !downstream.requirements.includes(r));
    if (missingDownstream.length > 0) {
      inconsistencies.push({
        type: 'requirement_gap',
        upstream: orderedKeys[i],
        downstream: orderedKeys[i + 1],
        missing_requirements: missingDownstream,
        severity: 'warning'
      });
    }
  }

  return {
    success: true,
    artifacts_analyzed: Object.keys(artifacts).length,
    inconsistencies,
    summary: {
      total_inconsistencies: inconsistencies.length,
      requirement_gaps: inconsistencies.filter(i => i.type === 'requirement_gap').length
    }
  };
}

module.exports = {
  extractSections,
  extractRequirements,
  extractApiEndpoints,
  extractTableData,
  normalizeText,
  textSimilarity,
  compareArtifacts,
  compareFiles,
  crossArtifactDiff
};
