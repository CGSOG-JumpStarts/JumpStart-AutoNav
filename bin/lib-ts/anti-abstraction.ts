/**
 * anti-abstraction.ts — Anti-Abstraction Gate port (T4.4.3, cluster L).
 *
 * Pure-library port of `bin/lib/anti-abstraction.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `WRAPPER_PATTERNS` (constant array)
 *   - `scanFile(filePath)` => ScanFileResult
 *   - `scanDirectory(dirPath, options?)` => ScanDirectoryResult
 *   - `hasJustification(abstractionName, decisionsDir)` => boolean
 *
 * Behavior parity:
 *   - Pattern catalog (4 entries) verbatim from legacy.
 *   - Default extensions: .js, .ts, .jsx, .tsx, .py, .rb.
 *   - Default exclude dirs: node_modules, .git, dist, build, coverage, .next.
 *
 * @see bin/lib/anti-abstraction.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.3
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

export interface WrapperPattern {
  name: string;
  pattern: RegExp;
  description: string;
  severity: string;
}

export interface AbstractionFinding {
  pattern: string;
  description: string;
  severity: string;
  line: number;
  match: string;
}

export interface ScanFileResult {
  file: string;
  findings: AbstractionFinding[];
}

export interface ScanDirectoryOptions {
  extensions?: string[];
  excludeDirs?: string[];
}

export interface ScanDirectoryResult {
  files: ScanFileResult[];
  totalFindings: number;
  summary: string;
}

export const WRAPPER_PATTERNS: WrapperPattern[] = [
  {
    name: 'thin_wrapper_class',
    pattern: /class\s+\w*(?:Wrapper|Adapter|Proxy|Helper|Manager|Handler|Facade)\b/g,
    description: 'Class name suggests a thin wrapper pattern',
    severity: 'warning',
  },
  {
    name: 're_export',
    pattern: /module\.exports\s*=\s*require\(['"][^'"]+['"]\)/g,
    description: 'Re-exports another module without transformation',
    severity: 'info',
  },
  {
    name: 'passthrough_function',
    pattern: /(?:async\s+)?function\s+\w+\([^)]*\)\s*\{\s*return\s+\w+\.\w+\([^)]*\)\s*;?\s*\}/g,
    description: 'Function appears to be a passthrough to another function',
    severity: 'warning',
  },
  {
    name: 'util_barrel',
    pattern: /\/\*\*[\s\S]*?utility[\s\S]*?\*\/[\s\S]*?module\.exports/gi,
    description: 'Generic utility module (may need decomposition)',
    severity: 'info',
  },
];

/**
 * Scan a source file for anti-abstraction patterns.
 */
export function scanFile(filePath: string): ScanFileResult {
  if (!existsSync(filePath)) {
    return { file: filePath, findings: [] };
  }

  const content = readFileSync(filePath, 'utf8');
  const findings: AbstractionFinding[] = [];

  for (const pattern of WRAPPER_PATTERNS) {
    const matches = content.match(pattern.pattern);
    if (matches) {
      for (const match of matches) {
        const index = content.indexOf(match);
        const lineNumber = content.substring(0, index).split('\n').length;

        findings.push({
          pattern: pattern.name,
          description: pattern.description,
          severity: pattern.severity,
          line: lineNumber,
          match: match.substring(0, 100),
        });
      }
    }
  }

  return { file: filePath, findings };
}

/**
 * Recursively scan a directory for anti-abstraction patterns.
 */
export function scanDirectory(
  dirPath: string,
  options: ScanDirectoryOptions = {}
): ScanDirectoryResult {
  const extensions = options.extensions || ['.js', '.ts', '.jsx', '.tsx', '.py', '.rb'];
  const excludeDirs = options.excludeDirs || [
    'node_modules',
    '.git',
    'dist',
    'build',
    'coverage',
    '.next',
  ];

  const results: ScanFileResult[] = [];
  let totalFindings = 0;

  function walk(dir: string): void {
    if (!existsSync(dir)) return;

    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!excludeDirs.includes(entry.name)) {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = extname(entry.name);
        if (extensions.includes(ext)) {
          const result = scanFile(fullPath);
          if (result.findings.length > 0) {
            results.push(result);
            totalFindings += result.findings.length;
          }
        }
      }
    }
  }

  walk(dirPath);

  const summary =
    totalFindings === 0
      ? 'No anti-abstraction patterns detected.'
      : `Found ${totalFindings} potential abstraction issue(s) across ${results.length} file(s).`;

  return { files: results, totalFindings, summary };
}

/**
 * Check if an ADR exists justifying a specific abstraction.
 */
export function hasJustification(abstractionName: string, decisionsDir: string): boolean {
  if (!existsSync(decisionsDir)) return false;

  const files = readdirSync(decisionsDir);
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const content = readFileSync(join(decisionsDir, file), 'utf8');
    if (content.toLowerCase().includes(abstractionName.toLowerCase())) {
      return true;
    }
  }

  return false;
}
