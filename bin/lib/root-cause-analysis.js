/**
 * root-cause-analysis.js — Root Cause Analysis Assistant (Item 59)
 *
 * Given failing tests or broken builds, generate ranked hypotheses
 * and next actions.
 *
 * Usage:
 *   node bin/lib/root-cause-analysis.js analyze|report [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const FAILURE_PATTERNS = [
  { pattern: /Cannot find module ['"]([^'"]+)['"]/g, category: 'missing-dependency', fix: 'Install or fix import path' },
  { pattern: /SyntaxError:\s*(.+)/g, category: 'syntax-error', fix: 'Fix syntax at indicated location' },
  { pattern: /TypeError:\s*(.+)\s+is not a function/g, category: 'type-error', fix: 'Check API usage and version compatibility' },
  { pattern: /ENOENT.*['"]([^'"]+)['"]/g, category: 'missing-file', fix: 'Create missing file or fix path reference' },
  { pattern: /AssertionError|AssertionError:\s*(.+)/g, category: 'test-assertion', fix: 'Update test or fix implementation' },
  { pattern: /ReferenceError:\s*(\w+)\s+is not defined/g, category: 'reference-error', fix: 'Import or declare the missing variable' },
  { pattern: /ECONNREFUSED/g, category: 'connection-error', fix: 'Ensure required services are running' },
  { pattern: /out of memory|heap|OOM/gi, category: 'memory-error', fix: 'Optimize memory usage or increase limits' },
  { pattern: /timeout|ETIMEDOUT/gi, category: 'timeout', fix: 'Increase timeout or optimize slow operations' },
  { pattern: /permission denied|EACCES/gi, category: 'permission-error', fix: 'Check file permissions or user privileges' }
];

/**
 * Analyze failure output.
 *
 * @param {string} output - Build/test failure output.
 * @param {object} [options]
 * @returns {object}
 */
function analyzeFailure(output, options = {}) {
  if (!output) return { success: false, error: 'output is required' };

  const hypotheses = [];
  const seen = new Set();

  for (const fp of FAILURE_PATTERNS) {
    const regex = new RegExp(fp.pattern.source, fp.pattern.flags);
    let match;
    while ((match = regex.exec(output)) !== null) {
      const key = `${fp.category}:${(match[1] || '').substring(0, 50)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const lineNum = output.substring(0, match.index).split('\n').length;
      hypotheses.push({
        category: fp.category,
        detail: match[1] || match[0].trim(),
        line: lineNum,
        suggested_fix: fp.fix,
        confidence: 'high',
        context: output.split('\n').slice(Math.max(0, lineNum - 3), lineNum + 2).join('\n')
      });
    }
  }

  // Sort by confidence and category severity
  const severity = { 'syntax-error': 1, 'missing-dependency': 2, 'reference-error': 3, 'type-error': 4, 'missing-file': 5, 'test-assertion': 6 };
  hypotheses.sort((a, b) => (severity[a.category] || 99) - (severity[b.category] || 99));

  return {
    success: true,
    total_hypotheses: hypotheses.length,
    hypotheses,
    primary_cause: hypotheses[0] || null,
    categories: [...new Set(hypotheses.map(h => h.category))],
    recommended_actions: hypotheses.slice(0, 3).map(h => ({
      action: h.suggested_fix,
      detail: h.detail,
      category: h.category
    }))
  };
}

/**
 * Analyze a test result file.
 *
 * @param {string} filePath - Path to test output file.
 * @param {object} [options]
 * @returns {object}
 */
function analyzeTestFile(filePath, options = {}) {
  if (!fs.existsSync(filePath)) {
    return { success: false, error: `File not found: ${filePath}` };
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const result = analyzeFailure(content, options);
  result.file = filePath;
  return result;
}

/**
 * Generate root cause report.
 *
 * @param {object} analysis
 * @returns {object}
 */
function generateReport(analysis) {
  if (!analysis || !analysis.hypotheses) {
    return { success: false, error: 'Invalid analysis result' };
  }

  const byCategory = analysis.hypotheses.reduce((acc, h) => {
    acc[h.category] = (acc[h.category] || 0) + 1;
    return acc;
  }, {});

  return {
    success: true,
    summary: {
      total_issues: analysis.total_hypotheses,
      primary_cause: analysis.primary_cause ? analysis.primary_cause.category : 'unknown',
      categories: Object.keys(byCategory).length
    },
    by_category: byCategory,
    action_plan: analysis.recommended_actions,
    hypotheses: analysis.hypotheses
  };
}

module.exports = {
  analyzeFailure,
  analyzeTestFile,
  generateReport,
  FAILURE_PATTERNS
};
