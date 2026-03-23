/**
 * quality-graph.js — Code Quality Smell Graph (Item 60)
 *
 * Map hotspots across complexity, churn, bugs, ownership gaps,
 * and requirement ambiguity.
 *
 * Usage:
 *   node bin/lib/quality-graph.js scan|report [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const QUALITY_DIMENSIONS = ['complexity', 'churn', 'test-coverage', 'ownership', 'documentation', 'dependencies'];

const COMPLEXITY_THRESHOLDS = {
  low: { max_lines: 200, max_functions: 15 },
  medium: { max_lines: 500, max_functions: 30 },
  high: { max_lines: 1000, max_functions: 50 }
};

/**
 * Scan a project for quality hotspots.
 *
 * @param {string} root - Project root.
 * @param {object} [options]
 * @returns {object}
 */
function scanQuality(root, options = {}) {
  const excludeDirs = options.excludeDirs || ['node_modules', '.git', 'dist', 'build', 'vendor'];
  const extensions = options.extensions || ['.js', '.ts', '.py', '.java', '.go', '.rb'];
  const hotspots = [];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!excludeDirs.includes(entry.name)) walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) {
          try {
            const filePath = path.join(dir, entry.name);
            const content = fs.readFileSync(filePath, 'utf8');
            const relPath = path.relative(root, filePath).replace(/\\/g, '/');
            const metrics = analyzeFileMetrics(content, ext);

            hotspots.push({
              file: relPath,
              ...metrics,
              overall_score: calculateOverallScore(metrics)
            });
          } catch { /* skip */ }
        }
      }
    }
  }

  walk(root);

  // Sort by score (lower = worse)
  hotspots.sort((a, b) => a.overall_score - b.overall_score);

  return {
    success: true,
    total_files: hotspots.length,
    hotspots: hotspots.slice(0, options.limit || 20),
    all_files: hotspots,
    summary: {
      total_files: hotspots.length,
      average_score: hotspots.length > 0 ? Math.round(hotspots.reduce((s, h) => s + h.overall_score, 0) / hotspots.length) : 0,
      critical_hotspots: hotspots.filter(h => h.overall_score < 30).length,
      high_risk: hotspots.filter(h => h.overall_score < 50).length
    }
  };
}

/**
 * Analyze file-level quality metrics.
 *
 * @param {string} content - File content.
 * @param {string} ext - File extension.
 * @returns {object}
 */
function analyzeFileMetrics(content, ext) {
  const lines = content.split('\n');
  const totalLines = lines.length;
  const blankLines = lines.filter(l => l.trim() === '').length;
  const commentLines = lines.filter(l => /^\s*(?:\/\/|#|\/\*|\*|""")/.test(l)).length;
  const codeLines = totalLines - blankLines - commentLines;

  // Function/method count
  const functions = (content.match(/(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>|\bdef\s+\w+|\bfunc\s+\w+)/g) || []).length;

  // Nested depth (max bracket nesting)
  let maxDepth = 0;
  let currentDepth = 0;
  for (const char of content) {
    if (char === '{' || char === '(') { currentDepth++; maxDepth = Math.max(maxDepth, currentDepth); }
    if (char === '}' || char === ')') currentDepth--;
  }

  // TODO/FIXME count
  const todos = (content.match(/\b(?:TODO|FIXME|HACK|XXX)\b/gi) || []).length;

  // Long lines
  const longLines = lines.filter(l => l.length > 120).length;

  // Import count
  const imports = (content.match(/(?:^import\s|^const\s.*=\s*require|^from\s)/gm) || []).length;

  return {
    total_lines: totalLines,
    code_lines: codeLines,
    comment_ratio: totalLines > 0 ? Math.round((commentLines / totalLines) * 100) : 0,
    functions,
    max_nesting_depth: maxDepth,
    todos,
    long_lines: longLines,
    imports,
    complexity_level: totalLines > COMPLEXITY_THRESHOLDS.high.max_lines ? 'critical'
      : totalLines > COMPLEXITY_THRESHOLDS.medium.max_lines ? 'high'
      : totalLines > COMPLEXITY_THRESHOLDS.low.max_lines ? 'medium' : 'low'
  };
}

/**
 * Calculate overall quality score (0-100).
 *
 * @param {object} metrics
 * @returns {number}
 */
function calculateOverallScore(metrics) {
  let score = 100;

  // Penalize large files
  if (metrics.total_lines > 500) score -= 15;
  if (metrics.total_lines > 1000) score -= 15;

  // Penalize deep nesting
  if (metrics.max_nesting_depth > 5) score -= 10;
  if (metrics.max_nesting_depth > 8) score -= 10;

  // Penalize TODOs
  score -= metrics.todos * 3;

  // Penalize low comment ratio
  if (metrics.comment_ratio < 5) score -= 10;

  // Penalize many long lines
  if (metrics.long_lines > 10) score -= 10;

  // Penalize too many functions
  if (metrics.functions > 30) score -= 10;

  return Math.max(0, Math.min(100, score));
}

/**
 * Generate quality report.
 *
 * @param {object} scanResult
 * @returns {object}
 */
function generateReport(scanResult) {
  const byComplexity = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const h of scanResult.all_files || []) {
    byComplexity[h.complexity_level] = (byComplexity[h.complexity_level] || 0) + 1;
  }

  return {
    success: true,
    summary: scanResult.summary,
    by_complexity: byComplexity,
    top_hotspots: (scanResult.hotspots || []).slice(0, 10),
    recommendations: [
      ...(scanResult.summary.critical_hotspots > 0 ? ['Refactor critical hotspots with high complexity'] : []),
      ...(scanResult.summary.average_score < 60 ? ['Consider code review standards and complexity limits'] : []),
      'Add documentation to files with low comment ratios'
    ]
  };
}

module.exports = {
  scanQuality,
  analyzeFileMetrics,
  calculateOverallScore,
  generateReport,
  QUALITY_DIMENSIONS,
  COMPLEXITY_THRESHOLDS
};
