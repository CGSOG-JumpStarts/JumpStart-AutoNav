/**
 * credential-boundary.ts — secrets & credential boundary checks port (T4.4.2, cluster I).
 *
 * Pure-library port of `bin/lib/credential-boundary.js`. Public surface
 * preserved verbatim:
 *
 *   - `scanBoundaries(files, root, options?)` => ScanResult
 *   - `scanProject(root, options?)` => ScanResult
 *   - `generateReport(scanResult)` => Report
 *   - `BOUNDARY_PATTERNS`, `SAFE_PATTERNS`
 *
 * Behavior parity:
 *   - 7 boundary patterns (hardcoded secret, vault missing, connection
 *     string, private key, AWS creds, bearer token, env var) preserved.
 *   - 6 safe-pattern allow-list preserved verbatim.
 *   - Walker uses `String.matchAll` (M3 hardening — no stateful regex.exec).
 *   - ADR-012: matched preview text passed through `redactSecrets` so
 *     the per-finding `matched` field never echoes a real secret out
 *     to a downstream report.
 *
 * @see bin/lib/credential-boundary.js (legacy reference)
 * @see bin/lib-ts/secret-scanner.ts (redaction)
 * @see specs/implementation-plan.md T4.4.2
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, isAbsolute, join, relative } from 'node:path';
import { redactSecrets } from './secret-scanner.js';

export interface BoundaryPattern {
  name: string;
  pattern: RegExp;
  severity: string;
}

export const BOUNDARY_PATTERNS: BoundaryPattern[] = [
  {
    name: 'Hardcoded secret in spec',
    pattern: /(?:password|secret|token|api.?key)\s*[:=]\s*["'][^"']{8,}/gi,
    severity: 'critical',
  },
  {
    name: 'Vault reference missing',
    pattern: /(?:password|secret|token)\s*[:=]\s*(?!.*vault|.*\$\{)/gi,
    severity: 'warning',
  },
  {
    name: 'Inline connection string',
    pattern: /(?:mongodb|postgres|mysql|redis):\/\/[^\s"']+:[^\s"']+@/gi,
    severity: 'critical',
  },
  {
    name: 'Private key material',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    severity: 'critical',
  },
  {
    name: 'AWS credential pattern',
    pattern: /(?:AKIA[0-9A-Z]{16}|aws_secret_access_key)/gi,
    severity: 'critical',
  },
  {
    name: 'Bearer token in spec',
    pattern: /[Bb]earer\s+[A-Za-z0-9._~+/=-]{20,}/g,
    severity: 'high',
  },
  {
    name: 'Secret in environment variable',
    pattern:
      /(?:export\s+)?[A-Z_]*(?:SECRET|TOKEN|PASSWORD|KEY)[A-Z_]*\s*=\s*["']?[A-Za-z0-9+/=]{16,}/g,
    severity: 'high',
  },
];

export const SAFE_PATTERNS: RegExp[] = [
  /\.env\.example/i,
  /placeholder|changeme|your[_-]?key|replace[_-]?me|TODO/i,
  /\$\{[^}]+\}/,
  /vault:\/\//i,
  /secretsmanager/i,
  /keyvault/i,
];

export interface CredentialFinding {
  file: string;
  line: number;
  pattern: string;
  severity: string;
  matched: string;
}

export interface ScanResult {
  success: true;
  files_scanned: number;
  findings: CredentialFinding[];
  total_findings: number;
  critical: number;
  high: number;
  pass: boolean;
}

export interface ScanOptions {
  extensions?: string[];
  excludeDirs?: string[];
}

export interface CredentialReport {
  success: true;
  summary: {
    files_scanned: number;
    total_findings: number;
    pass: boolean;
  };
  by_severity: Record<string, number>;
  by_pattern: Record<string, number>;
  critical_findings: CredentialFinding[];
  recommendations: string[];
}

export function scanBoundaries(
  files: string[],
  root: string,
  _options: ScanOptions = {}
): ScanResult {
  const findings: CredentialFinding[] = [];
  let filesScanned = 0;

  for (const file of files) {
    const absPath = isAbsolute(file) ? file : join(root, file);
    if (!existsSync(absPath)) continue;

    let content: string;
    try {
      content = readFileSync(absPath, 'utf8');
      filesScanned++;
    } catch {
      continue;
    }

    for (const bp of BOUNDARY_PATTERNS) {
      // Reuse the BOUNDARY_PATTERNS regex via matchAll — guarantee a
      // global flag (M3 hardening).
      const flags = bp.pattern.flags.includes('g') ? bp.pattern.flags : `${bp.pattern.flags}g`;
      const regex = new RegExp(bp.pattern.source, flags);
      for (const match of content.matchAll(regex)) {
        const matchedText = match[0];

        const isSafe = SAFE_PATTERNS.some((sp) => sp.test(matchedText));
        if (isSafe) continue;

        const idx = match.index ?? 0;
        const lineNum = content.substring(0, idx).split('\n').length;

        // ADR-012: redact the matched preview text before storing in
        // the finding record. Worst-case it's already truncated, but
        // for high-entropy formats (AWS keys, bearer tokens) the
        // truncation alone leaves identifying prefix material.
        const previewRaw = matchedText.substring(0, 50) + (matchedText.length > 50 ? '...' : '');
        const preview = redactSecrets(previewRaw);

        findings.push({
          file: relative(root, absPath).replace(/\\/g, '/'),
          line: lineNum,
          pattern: bp.name,
          severity: bp.severity,
          matched: preview,
        });
      }
    }
  }

  return {
    success: true,
    files_scanned: filesScanned,
    findings,
    total_findings: findings.length,
    critical: findings.filter((f) => f.severity === 'critical').length,
    high: findings.filter((f) => f.severity === 'high').length,
    pass: findings.filter((f) => f.severity === 'critical').length === 0,
  };
}

export function scanProject(root: string, options: ScanOptions = {}): ScanResult {
  const extensions = options.extensions || [
    '.md',
    '.yaml',
    '.yml',
    '.json',
    '.js',
    '.ts',
    '.env',
    '.cfg',
    '.conf',
  ];
  const excludeDirs = options.excludeDirs || ['node_modules', '.git', 'dist', 'build', 'vendor'];
  const files: string[] = [];

  function walk(dir: string): void {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!excludeDirs.includes(entry.name)) walk(join(dir, entry.name));
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) files.push(join(dir, entry.name));
      }
    }
  }

  walk(root);
  return scanBoundaries(files, root, options);
}

export function generateReport(scanResult: ScanResult): CredentialReport {
  const bySeverity: Record<string, number> = {};
  const byPattern: Record<string, number> = {};

  for (const f of scanResult.findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
    byPattern[f.pattern] = (byPattern[f.pattern] || 0) + 1;
  }

  return {
    success: true,
    summary: {
      files_scanned: scanResult.files_scanned,
      total_findings: scanResult.total_findings,
      pass: scanResult.pass,
    },
    by_severity: bySeverity,
    by_pattern: byPattern,
    critical_findings: scanResult.findings.filter((f) => f.severity === 'critical'),
    recommendations:
      scanResult.total_findings > 0
        ? [
            'Use vault references instead of hardcoded secrets',
            'Move sensitive values to environment variables',
            'Add .env to .gitignore',
          ]
        : ['No credential boundary issues detected'],
  };
}
