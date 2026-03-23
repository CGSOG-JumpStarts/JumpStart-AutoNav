/**
 * runtime-debugger.js — Runtime-Aware Debugging Mode (Item 46)
 *
 * Consume logs, traces, exceptions, and metrics to guide fixes.
 *
 * Usage:
 *   node bin/lib/runtime-debugger.js analyze|correlate|report [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const LOG_PATTERNS = {
  error: /\b(?:ERROR|FATAL|CRITICAL)\b/i,
  warning: /\b(?:WARN(?:ING)?)\b/i,
  exception: /(?:Error|Exception|Traceback|at\s+\S+\s+\()/,
  stack_trace: /^\s+at\s+/m,
  timeout: /\b(?:timeout|timed?\s*out|ETIMEDOUT)\b/i,
  oom: /\b(?:out\s*of\s*memory|heap|OOM|ENOMEM)\b/i,
  connection: /\b(?:ECONNREFUSED|ECONNRESET|connection\s+refused)\b/i
};

/**
 * Analyze log content for patterns.
 *
 * @param {string} logContent - Raw log text.
 * @param {object} [options]
 * @returns {object}
 */
function analyzeLogs(logContent, options = {}) {
  const lines = logContent.split('\n');
  const findings = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const [type, pattern] of Object.entries(LOG_PATTERNS)) {
      if (pattern.test(line)) {
        findings.push({
          type,
          line: i + 1,
          content: line.trim().substring(0, 200),
          severity: type === 'error' || type === 'exception' ? 'high' : 'medium'
        });
        break;
      }
    }
  }

  const summary = {
    total_lines: lines.length,
    errors: findings.filter(f => f.type === 'error').length,
    warnings: findings.filter(f => f.type === 'warning').length,
    exceptions: findings.filter(f => f.type === 'exception').length,
    timeouts: findings.filter(f => f.type === 'timeout').length,
    oom: findings.filter(f => f.type === 'oom').length,
    connection_issues: findings.filter(f => f.type === 'connection').length
  };

  return { success: true, findings, summary, total_findings: findings.length };
}

/**
 * Analyze a log file.
 *
 * @param {string} filePath - Path to log file.
 * @param {object} [options]
 * @returns {object}
 */
function analyzeLogFile(filePath, options = {}) {
  if (!fs.existsSync(filePath)) {
    return { success: false, error: `Log file not found: ${filePath}` };
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const result = analyzeLogs(content, options);
  result.file = filePath;
  return result;
}

/**
 * Correlate errors with source files.
 *
 * @param {object[]} findings - Error findings from log analysis.
 * @param {string} root - Project root.
 * @returns {object}
 */
function correlateWithSource(findings, root) {
  const correlations = [];

  for (const finding of findings) {
    // Extract file references from error messages
    const fileMatch = finding.content.match(/(?:at\s+)?(\S+\.(?:js|ts|py)):(\d+)/);
    if (fileMatch) {
      const [, file, line] = fileMatch;
      const absPath = path.join(root, file);
      const exists = fs.existsSync(absPath);

      correlations.push({
        error: finding.content.substring(0, 100),
        source_file: file,
        source_line: parseInt(line),
        file_exists: exists,
        severity: finding.severity
      });
    }
  }

  return {
    success: true,
    correlations,
    total: correlations.length,
    actionable: correlations.filter(c => c.file_exists).length
  };
}

/**
 * Generate debugging report with hypotheses.
 *
 * @param {object} analysis - Log analysis result.
 * @returns {object}
 */
function generateHypotheses(analysis) {
  const hypotheses = [];

  if (analysis.summary.oom > 0) {
    hypotheses.push({ hypothesis: 'Memory leak or insufficient heap allocation', confidence: 'high', action: 'Check for unbounded data structures or increase memory limits' });
  }
  if (analysis.summary.timeouts > 0) {
    hypotheses.push({ hypothesis: 'Network connectivity or slow dependency', confidence: 'medium', action: 'Check network configuration, increase timeouts, or add retries' });
  }
  if (analysis.summary.connection_issues > 0) {
    hypotheses.push({ hypothesis: 'Service dependency unavailable', confidence: 'high', action: 'Verify dependent services are running and network rules allow connection' });
  }
  if (analysis.summary.exceptions > 0) {
    hypotheses.push({ hypothesis: 'Unhandled exception in application code', confidence: 'high', action: 'Review stack traces and add error handling' });
  }

  return {
    success: true,
    hypotheses,
    total: hypotheses.length,
    summary: analysis.summary
  };
}

module.exports = {
  analyzeLogs,
  analyzeLogFile,
  correlateWithSource,
  generateHypotheses,
  LOG_PATTERNS
};
