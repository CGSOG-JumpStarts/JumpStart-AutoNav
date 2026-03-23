/**
 * tool-guardrails.js — Tool Execution Guardrails (Item 58)
 *
 * Validate risky file operations, deletions, schema changes,
 * and wide-scope edits before execution.
 *
 * Usage:
 *   node bin/lib/tool-guardrails.js check|policy|report [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const RISK_RULES = [
  { id: 'delete-protection', pattern: /^(?:rm|del|remove)\s+/i, risk: 'high', description: 'File deletion operation' },
  { id: 'recursive-delete', pattern: /rm\s+-rf?\s/i, risk: 'critical', description: 'Recursive deletion' },
  { id: 'schema-change', pattern: /(?:ALTER|DROP|TRUNCATE)\s+(?:TABLE|DATABASE|SCHEMA)/i, risk: 'high', description: 'Database schema modification' },
  { id: 'config-write', pattern: /(?:\.env|config|secrets?)\s*$/i, risk: 'high', description: 'Configuration file modification' },
  { id: 'wide-glob', pattern: /\*\*\/\*|\*\.\*/i, risk: 'medium', description: 'Wide glob pattern' },
  { id: 'sudo-usage', pattern: /\bsudo\b/i, risk: 'critical', description: 'Elevated privilege usage' },
  { id: 'network-call', pattern: /\b(?:curl|wget|fetch)\s+http/i, risk: 'medium', description: 'External network call' },
  { id: 'git-force', pattern: /git\s+(?:push\s+--force|reset\s+--hard)/i, risk: 'high', description: 'Force git operation' }
];

const PROTECTED_PATHS = [
  '.env', '.env.local', '.env.production',
  '.git/', 'node_modules/',
  'package-lock.json', 'yarn.lock',
  '.jumpstart/state/'
];

/**
 * Check a command or operation for guardrail violations.
 *
 * @param {string} operation - Command or file path.
 * @param {object} [options]
 * @returns {object}
 */
function checkOperation(operation, options = {}) {
  if (!operation) return { success: false, error: 'operation is required' };

  const violations = [];

  // Check against risk rules
  for (const rule of RISK_RULES) {
    if (rule.pattern.test(operation)) {
      violations.push({
        rule_id: rule.id,
        risk: rule.risk,
        description: rule.description,
        matched: operation.substring(0, 100)
      });
    }
  }

  // Check against protected paths
  for (const pp of PROTECTED_PATHS) {
    if (operation.includes(pp)) {
      violations.push({
        rule_id: 'protected-path',
        risk: 'high',
        description: `Operation targets protected path: ${pp}`,
        matched: pp
      });
    }
  }

  const maxRisk = violations.reduce((max, v) => {
    const riskOrder = { critical: 4, high: 3, medium: 2, low: 1 };
    return riskOrder[v.risk] > riskOrder[max] ? v.risk : max;
  }, 'low');

  return {
    success: true,
    operation: operation.substring(0, 200),
    allowed: violations.filter(v => v.risk === 'critical').length === 0,
    requires_approval: violations.some(v => v.risk === 'high' || v.risk === 'critical'),
    risk_level: violations.length > 0 ? maxRisk : 'none',
    violations,
    total_violations: violations.length
  };
}

/**
 * Validate a file operation (create/edit/delete).
 *
 * @param {string} action - 'create' | 'edit' | 'delete'
 * @param {string} filePath
 * @param {object} [options]
 * @returns {object}
 */
function validateFileOperation(action, filePath, options = {}) {
  const warnings = [];

  if (action === 'delete') {
    warnings.push({ level: 'high', message: `Deleting file: ${filePath}` });

    for (const pp of PROTECTED_PATHS) {
      if (filePath.includes(pp)) {
        return {
          success: true,
          allowed: false,
          reason: `Cannot delete protected path: ${pp}`,
          warnings
        };
      }
    }
  }

  if (action === 'edit') {
    const ext = path.extname(filePath).toLowerCase();
    if (['.env', '.pem', '.key'].includes(ext)) {
      warnings.push({ level: 'high', message: 'Editing sensitive file type' });
    }
  }

  const linesChanged = options.lines_changed || 0;
  if (linesChanged > 100) {
    warnings.push({ level: 'medium', message: `Large edit: ${linesChanged} lines changed` });
  }

  return {
    success: true,
    allowed: true,
    action,
    file: filePath,
    warnings,
    requires_review: warnings.some(w => w.level === 'high')
  };
}

module.exports = {
  checkOperation,
  validateFileOperation,
  RISK_RULES,
  PROTECTED_PATHS
};
