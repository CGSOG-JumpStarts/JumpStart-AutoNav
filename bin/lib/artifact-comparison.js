/**
 * artifact-comparison.js — Artifact Comparison Across Versions (Item 78)
 *
 * Show what changed in business terms and why it matters.
 *
 * Usage:
 *   node bin/lib/artifact-comparison.js compare|history [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const CHANGE_CATEGORIES = ['added', 'removed', 'modified', 'moved'];

function compareArtifacts(contentA, contentB, options = {}) {
  if (!contentA || !contentB) return { success: false, error: 'Both contents are required' };

  const linesA = contentA.split('\n');
  const linesB = contentB.split('\n');

  const sectionsA = extractSections(linesA);
  const sectionsB = extractSections(linesB);

  const changes = [];
  const allKeys = new Set([...Object.keys(sectionsA), ...Object.keys(sectionsB)]);

  for (const key of allKeys) {
    if (!sectionsA[key]) {
      changes.push({ section: key, type: 'added', summary: `New section: ${key}` });
    } else if (!sectionsB[key]) {
      changes.push({ section: key, type: 'removed', summary: `Removed section: ${key}` });
    } else if (sectionsA[key] !== sectionsB[key]) {
      changes.push({ section: key, type: 'modified', summary: `Modified section: ${key}` });
    }
  }

  return {
    success: true,
    total_changes: changes.length,
    changes,
    lines_before: linesA.length,
    lines_after: linesB.length,
    line_diff: linesB.length - linesA.length
  };
}

function extractSections(lines) {
  const sections = {};
  let current = '_header';
  let content = [];

  for (const line of lines) {
    if (line.match(/^#+\s/)) {
      if (content.length > 0) sections[current] = content.join('\n');
      current = line.replace(/^#+\s+/, '').trim();
      content = [];
    } else {
      content.push(line);
    }
  }
  if (content.length > 0) sections[current] = content.join('\n');

  return sections;
}

function compareFiles(fileA, fileB, options = {}) {
  if (!fs.existsSync(fileA)) return { success: false, error: `File not found: ${fileA}` };
  if (!fs.existsSync(fileB)) return { success: false, error: `File not found: ${fileB}` };

  const contentA = fs.readFileSync(fileA, 'utf8');
  const contentB = fs.readFileSync(fileB, 'utf8');

  const result = compareArtifacts(contentA, contentB, options);
  result.file_a = fileA;
  result.file_b = fileB;
  return result;
}

function getArtifactHistory(root, artifactName, options = {}) {
  const archiveDir = path.join(root, '.jumpstart', 'archive');
  const versions = [];

  if (fs.existsSync(archiveDir)) {
    for (const f of fs.readdirSync(archiveDir)) {
      if (f.includes(artifactName)) {
        versions.push({ file: f, path: path.join(archiveDir, f) });
      }
    }
  }

  const currentPath = path.join(root, 'specs', artifactName);
  if (fs.existsSync(currentPath)) {
    versions.push({ file: artifactName, path: currentPath, current: true });
  }

  return { success: true, artifact: artifactName, versions: versions.length, history: versions };
}

module.exports = {
  compareArtifacts, compareFiles, getArtifactHistory, extractSections,
  CHANGE_CATEGORIES
};
