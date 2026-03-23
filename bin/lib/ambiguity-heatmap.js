/**
 * ambiguity-heatmap.js — Requirement Ambiguity Heatmap (Item 71)
 *
 * Highlight vague language, missing constraints, undefined terms,
 * and assumption density.
 *
 * Usage:
 *   node bin/lib/ambiguity-heatmap.js scan|report [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const VAGUE_TERMS = [
  'should', 'could', 'might', 'possibly', 'maybe', 'approximately',
  'reasonable', 'appropriate', 'adequate', 'sufficient', 'as needed',
  'etc', 'and so on', 'as appropriate', 'in a timely manner',
  'user-friendly', 'intuitive', 'seamless', 'robust', 'scalable',
  'performant', 'efficient', 'flexible', 'simple', 'easy'
];

const MISSING_CONSTRAINT_PATTERNS = [
  { pattern: /\bfast\b/gi, suggestion: 'Define specific latency target (e.g., <200ms p95)' },
  { pattern: /\bsecure\b/gi, suggestion: 'Specify security controls (encryption, auth, audit)' },
  { pattern: /\bhigh availability\b/gi, suggestion: 'Define uptime SLA (e.g., 99.9%)' },
  { pattern: /\blarge scale\b/gi, suggestion: 'Quantify expected load (users, requests/sec)' },
  { pattern: /\breal[- ]?time\b/gi, suggestion: 'Define latency requirement (e.g., <1s, <100ms)' }
];

/**
 * Scan text for ambiguity indicators.
 */
function scanAmbiguity(text, options = {}) {
  if (!text) return { success: false, error: 'Text content is required' };

  const lines = text.split('\n');
  const findings = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check vague terms
    for (const term of VAGUE_TERMS) {
      const regex = new RegExp(`\\b${term}\\b`, 'gi');
      const matches = line.match(regex);
      if (matches) {
        findings.push({
          type: 'vague_language',
          term,
          line: lineNum,
          severity: 'medium',
          context: line.trim().substring(0, 100)
        });
      }
    }

    // Check missing constraints
    for (const { pattern, suggestion } of MISSING_CONSTRAINT_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({
          type: 'missing_constraint',
          line: lineNum,
          severity: 'high',
          suggestion,
          context: line.trim().substring(0, 100)
        });
        // Reset regex lastIndex
        pattern.lastIndex = 0;
      }
    }
  }

  // Check for undefined terms (capitalized terms that may be domain concepts)
  const definedTerms = new Set();
  const usedTerms = new Set();
  for (const line of lines) {
    const defs = line.match(/^#+\s+(.+)/);
    if (defs) definedTerms.add(defs[1].trim().toLowerCase());

    const caps = line.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g);
    if (caps) caps.forEach(t => usedTerms.add(t.toLowerCase()));
  }

  // Assumption density
  const assumptions = (text.match(/\bassume[ds]?\b|\bassuming\b|\bassumption/gi) || []).length;

  const totalLines = lines.filter(l => l.trim().length > 0).length;

  return {
    success: true,
    total_findings: findings.length,
    findings: findings.slice(0, options.limit || 50),
    metrics: {
      vague_terms: findings.filter(f => f.type === 'vague_language').length,
      missing_constraints: findings.filter(f => f.type === 'missing_constraint').length,
      assumption_count: assumptions,
      ambiguity_density: totalLines > 0 ? Math.round((findings.length / totalLines) * 100) : 0
    }
  };
}

/**
 * Scan a file for ambiguity.
 */
function scanFile(filePath, options = {}) {
  if (!fs.existsSync(filePath)) {
    return { success: false, error: `File not found: ${filePath}` };
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const result = scanAmbiguity(content, options);
  result.file = filePath;
  return result;
}

/**
 * Generate ambiguity heatmap report.
 */
function generateHeatmap(root, options = {}) {
  const specsDir = path.join(root, 'specs');
  const results = [];

  if (fs.existsSync(specsDir)) {
    for (const f of fs.readdirSync(specsDir).filter(f => f.endsWith('.md'))) {
      const fp = path.join(specsDir, f);
      const result = scanFile(fp, options);
      if (result.success) {
        results.push({ file: f, ...result.metrics, total_findings: result.total_findings });
      }
    }
  }

  results.sort((a, b) => b.ambiguity_density - a.ambiguity_density);

  return {
    success: true,
    files_scanned: results.length,
    results,
    overall: {
      total_findings: results.reduce((s, r) => s + r.total_findings, 0),
      highest_density_file: results.length > 0 ? results[0].file : null
    }
  };
}

module.exports = {
  scanAmbiguity, scanFile, generateHeatmap,
  VAGUE_TERMS, MISSING_CONSTRAINT_PATTERNS
};
