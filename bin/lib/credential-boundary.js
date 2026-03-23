/**
 * credential-boundary.js — Secrets & Credential Boundary Checks (Item 31)
 *
 * Detect unsafe plans or code paths involving tokens, keys,
 * vault usage, and secrets sprawl.
 *
 * Usage:
 *   node bin/lib/credential-boundary.js scan|report [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const BOUNDARY_PATTERNS = [
  { name: 'Hardcoded secret in spec', pattern: /(?:password|secret|token|api.?key)\s*[:=]\s*["'][^"']{8,}/gi, severity: 'critical' },
  { name: 'Vault reference missing', pattern: /(?:password|secret|token)\s*[:=]\s*(?!.*vault|.*\$\{)/gi, severity: 'warning' },
  { name: 'Inline connection string', pattern: /(?:mongodb|postgres|mysql|redis):\/\/[^\s"']+:[^\s"']+@/gi, severity: 'critical' },
  { name: 'Private key material', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, severity: 'critical' },
  { name: 'AWS credential pattern', pattern: /(?:AKIA[0-9A-Z]{16}|aws_secret_access_key)/gi, severity: 'critical' },
  { name: 'Bearer token in spec', pattern: /[Bb]earer\s+[A-Za-z0-9._~+/=-]{20,}/g, severity: 'high' },
  { name: 'Secret in environment variable', pattern: /(?:export\s+)?[A-Z_]*(?:SECRET|TOKEN|PASSWORD|KEY)[A-Z_]*\s*=\s*["']?[A-Za-z0-9+/=]{16,}/g, severity: 'high' }
];

const SAFE_PATTERNS = [
  /\.env\.example/i,
  /placeholder|changeme|your[_-]?key|replace[_-]?me|TODO/i,
  /\$\{[^}]+\}/,
  /vault:\/\//i,
  /secretsmanager/i,
  /keyvault/i
];

/**
 * Scan files for credential boundary violations.
 *
 * @param {string[]} files - File paths to scan.
 * @param {string} root - Project root.
 * @param {object} [options]
 * @returns {object}
 */
function scanBoundaries(files, root, options = {}) {
  const findings = [];
  let filesScanned = 0;

  for (const file of files) {
    const absPath = path.isAbsolute(file) ? file : path.join(root, file);
    if (!fs.existsSync(absPath)) continue;

    try {
      const content = fs.readFileSync(absPath, 'utf8');
      filesScanned++;

      for (const bp of BOUNDARY_PATTERNS) {
        const regex = new RegExp(bp.pattern.source, bp.pattern.flags);
        let match;
        while ((match = regex.exec(content)) !== null) {
          const matchedText = match[0];

          // Check if it matches safe patterns
          const isSafe = SAFE_PATTERNS.some(sp => sp.test(matchedText));
          if (isSafe) continue;

          const lineNum = content.substring(0, match.index).split('\n').length;

          findings.push({
            file: path.relative(root, absPath).replace(/\\/g, '/'),
            line: lineNum,
            pattern: bp.name,
            severity: bp.severity,
            matched: matchedText.substring(0, 50) + (matchedText.length > 50 ? '...' : '')
          });
        }
      }
    } catch { /* skip unreadable */ }
  }

  return {
    success: true,
    files_scanned: filesScanned,
    findings,
    total_findings: findings.length,
    critical: findings.filter(f => f.severity === 'critical').length,
    high: findings.filter(f => f.severity === 'high').length,
    pass: findings.filter(f => f.severity === 'critical').length === 0
  };
}

/**
 * Scan a project root for credential boundary issues.
 *
 * @param {string} root - Project root.
 * @param {object} [options]
 * @returns {object}
 */
function scanProject(root, options = {}) {
  const extensions = options.extensions || ['.md', '.yaml', '.yml', '.json', '.js', '.ts', '.env', '.cfg', '.conf'];
  const excludeDirs = options.excludeDirs || ['node_modules', '.git', 'dist', 'build', 'vendor'];
  const files = [];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!excludeDirs.includes(entry.name)) walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) files.push(path.join(dir, entry.name));
      }
    }
  }

  walk(root);
  return scanBoundaries(files, root, options);
}

/**
 * Generate a credential boundary report.
 *
 * @param {object} scanResult
 * @returns {object}
 */
function generateReport(scanResult) {
  const bySeverity = {};
  const byPattern = {};

  for (const f of scanResult.findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
    byPattern[f.pattern] = (byPattern[f.pattern] || 0) + 1;
  }

  return {
    success: true,
    summary: {
      files_scanned: scanResult.files_scanned,
      total_findings: scanResult.total_findings,
      pass: scanResult.pass
    },
    by_severity: bySeverity,
    by_pattern: byPattern,
    critical_findings: scanResult.findings.filter(f => f.severity === 'critical'),
    recommendations: scanResult.total_findings > 0
      ? ['Use vault references instead of hardcoded secrets', 'Move sensitive values to environment variables', 'Add .env to .gitignore']
      : ['No credential boundary issues detected']
  };
}

module.exports = {
  scanBoundaries,
  scanProject,
  generateReport,
  BOUNDARY_PATTERNS,
  SAFE_PATTERNS
};
