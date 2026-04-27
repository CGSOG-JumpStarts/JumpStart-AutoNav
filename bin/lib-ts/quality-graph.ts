/**
 * quality-graph.ts — code-quality smell graph port (T4.4.1, cluster J).
 *
 * Pure-library port of `bin/lib/quality-graph.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `QUALITY_DIMENSIONS` (constant array)
 *   - `COMPLEXITY_THRESHOLDS` (constant map)
 *   - `scanQuality(root, options?)` => ScanQualityResult
 *   - `analyzeFileMetrics(content, ext)` => FileMetrics
 *   - `calculateOverallScore(metrics)` => number
 *   - `generateReport(scanResult)` => QualityReport
 *
 * Behavior parity:
 *   - Default exclude dirs: `node_modules`, `.git`, `dist`, `build`, `vendor`.
 *   - Default extensions: `.js .ts .py .java .go .rb`.
 *   - Hotspots sorted ascending by `overall_score` (lower = worse).
 *   - Score penalties: large files, deep nesting, TODOs, low comments,
 *     long lines, too many functions (verbatim coefficients).
 *
 * Hardening (F2/F4/F9/F13 lessons from M3/M4):
 *   - Static `node:fs` import.
 *   - Pattern matches use `String.match(globalRegex)` (no `regex.exec` loop)
 *     to avoid lastIndex leakage.
 *   - Complexity-level lookup uses literal switch-equivalent ternary so no
 *     attacker-controlled key ever indexes into `COMPLEXITY_THRESHOLDS`.
 *
 * @see bin/lib/quality-graph.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.1
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

// Public types

export type ComplexityLevel = 'low' | 'medium' | 'high' | 'critical';

export interface ComplexityThreshold {
  max_lines: number;
  max_functions: number;
}

export interface ScanOptions {
  excludeDirs?: string[];
  extensions?: string[];
  limit?: number;
}

export interface FileMetrics {
  total_lines: number;
  code_lines: number;
  comment_ratio: number;
  functions: number;
  max_nesting_depth: number;
  todos: number;
  long_lines: number;
  imports: number;
  complexity_level: ComplexityLevel;
}

export interface QualityHotspot extends FileMetrics {
  file: string;
  overall_score: number;
}

export interface QualitySummary {
  total_files: number;
  average_score: number;
  critical_hotspots: number;
  high_risk: number;
}

export interface ScanQualityResult {
  success: boolean;
  total_files: number;
  hotspots: QualityHotspot[];
  all_files: QualityHotspot[];
  summary: QualitySummary;
}

export interface QualityReport {
  success: boolean;
  summary: QualitySummary;
  by_complexity: Record<ComplexityLevel, number>;
  top_hotspots: QualityHotspot[];
  recommendations: string[];
}

// Constants (verbatim from legacy)

export const QUALITY_DIMENSIONS: string[] = [
  'complexity',
  'churn',
  'test-coverage',
  'ownership',
  'documentation',
  'dependencies',
];

export const COMPLEXITY_THRESHOLDS: Record<'low' | 'medium' | 'high', ComplexityThreshold> = {
  low: { max_lines: 200, max_functions: 15 },
  medium: { max_lines: 500, max_functions: 30 },
  high: { max_lines: 1000, max_functions: 50 },
};

const DEFAULT_EXCLUDE_DIRS = ['node_modules', '.git', 'dist', 'build', 'vendor'];
const DEFAULT_EXTENSIONS = ['.js', '.ts', '.py', '.java', '.go', '.rb'];

/** Compute complexity bucket via direct comparison (no attacker-controlled keys). */
function complexityLevel(totalLines: number): ComplexityLevel {
  if (totalLines > COMPLEXITY_THRESHOLDS.high.max_lines) return 'critical';
  if (totalLines > COMPLEXITY_THRESHOLDS.medium.max_lines) return 'high';
  if (totalLines > COMPLEXITY_THRESHOLDS.low.max_lines) return 'medium';
  return 'low';
}

/** Analyze a file's text for quality metrics. */
export function analyzeFileMetrics(content: string, _ext: string): FileMetrics {
  const lines = content.split('\n');
  const totalLines = lines.length;
  const blankLines = lines.filter((l) => l.trim() === '').length;
  const commentLines = lines.filter((l) => /^\s*(?:\/\/|#|\/\*|\*|""")/.test(l)).length;
  const codeLines = totalLines - blankLines - commentLines;

  const functions = (
    content.match(
      /(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>|\bdef\s+\w+|\bfunc\s+\w+)/g
    ) || []
  ).length;

  let maxDepth = 0;
  let currentDepth = 0;
  for (const char of content) {
    if (char === '{' || char === '(') {
      currentDepth++;
      maxDepth = Math.max(maxDepth, currentDepth);
    }
    if (char === '}' || char === ')') currentDepth--;
  }

  const todos = (content.match(/\b(?:TODO|FIXME|HACK|XXX)\b/gi) || []).length;
  const longLines = lines.filter((l) => l.length > 120).length;
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
    complexity_level: complexityLevel(totalLines),
  };
}

/** Compute overall 0–100 quality score from file metrics. */
export function calculateOverallScore(metrics: FileMetrics): number {
  let score = 100;

  if (metrics.total_lines > 500) score -= 15;
  if (metrics.total_lines > 1000) score -= 15;

  if (metrics.max_nesting_depth > 5) score -= 10;
  if (metrics.max_nesting_depth > 8) score -= 10;

  score -= metrics.todos * 3;

  if (metrics.comment_ratio < 5) score -= 10;
  if (metrics.long_lines > 10) score -= 10;
  if (metrics.functions > 30) score -= 10;

  return Math.max(0, Math.min(100, score));
}

/** Walk and analyze a project tree for quality hotspots. */
export function scanQuality(root: string, options: ScanOptions = {}): ScanQualityResult {
  const excludeDirs = options.excludeDirs || DEFAULT_EXCLUDE_DIRS;
  const extensions = options.extensions || DEFAULT_EXTENSIONS;
  const hotspots: QualityHotspot[] = [];

  function walk(dir: string): void {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (
        entry.name === '__proto__' ||
        entry.name === 'constructor' ||
        entry.name === 'prototype'
      ) {
        continue;
      }
      if (entry.isDirectory()) {
        if (!excludeDirs.includes(entry.name)) walk(join(dir, entry.name));
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) {
          try {
            const filePath = join(dir, entry.name);
            const content = readFileSync(filePath, 'utf8');
            const relPath = relative(root, filePath).replace(/\\/g, '/');
            const metrics = analyzeFileMetrics(content, ext);
            hotspots.push({
              file: relPath,
              ...metrics,
              overall_score: calculateOverallScore(metrics),
            });
          } catch {
            // skip unreadable files (legacy parity)
          }
        }
      }
    }
  }

  walk(root);

  hotspots.sort((a, b) => a.overall_score - b.overall_score);

  const avgScore =
    hotspots.length > 0
      ? Math.round(hotspots.reduce((s, h) => s + h.overall_score, 0) / hotspots.length)
      : 0;

  return {
    success: true,
    total_files: hotspots.length,
    hotspots: hotspots.slice(0, options.limit || 20),
    all_files: hotspots,
    summary: {
      total_files: hotspots.length,
      average_score: avgScore,
      critical_hotspots: hotspots.filter((h) => h.overall_score < 30).length,
      high_risk: hotspots.filter((h) => h.overall_score < 50).length,
    },
  };
}

/** Aggregate scan result into a report shape (counts by complexity + recs). */
export function generateReport(scanResult: ScanQualityResult): QualityReport {
  const byComplexity: Record<ComplexityLevel, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  for (const h of scanResult.all_files || []) {
    if (
      h.complexity_level === 'low' ||
      h.complexity_level === 'medium' ||
      h.complexity_level === 'high' ||
      h.complexity_level === 'critical'
    ) {
      byComplexity[h.complexity_level] = (byComplexity[h.complexity_level] || 0) + 1;
    }
  }

  const recommendations: string[] = [];
  if (scanResult.summary.critical_hotspots > 0) {
    recommendations.push('Refactor critical hotspots with high complexity');
  }
  if (scanResult.summary.average_score < 60) {
    recommendations.push('Consider code review standards and complexity limits');
  }
  recommendations.push('Add documentation to files with low comment ratios');

  return {
    success: true,
    summary: scanResult.summary,
    by_complexity: byComplexity,
    top_hotspots: (scanResult.hotspots || []).slice(0, 10),
    recommendations,
  };
}
