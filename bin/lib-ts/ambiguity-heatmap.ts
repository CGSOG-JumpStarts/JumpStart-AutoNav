/**
 * ambiguity-heatmap.ts — requirement-ambiguity heatmap (T4.1.7 batch).
 *
 * Pure-library port of `bin/lib/ambiguity-heatmap.js`. Five exports:
 * `scanAmbiguity`, `scanFile`, `generateHeatmap`, `VAGUE_TERMS`,
 * `MISSING_CONSTRAINT_PATTERNS` — all preserved verbatim by name +
 * shape.
 *
 * Vocabulary lists (`VAGUE_TERMS`, `MISSING_CONSTRAINT_PATTERNS`) are
 * preserved word-for-word; downstream tooling that imports the
 * constants gets the same lookup behavior.
 *
 * @see bin/lib/ambiguity-heatmap.js (legacy reference)
 * @see specs/implementation-plan.md T4.1.7
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

/** Vague-language vocabulary; flag any line containing one of these. */
export const VAGUE_TERMS: readonly string[] = [
  'should',
  'could',
  'might',
  'possibly',
  'maybe',
  'approximately',
  'reasonable',
  'appropriate',
  'adequate',
  'sufficient',
  'as needed',
  'etc',
  'and so on',
  'as appropriate',
  'in a timely manner',
  'user-friendly',
  'intuitive',
  'seamless',
  'robust',
  'scalable',
  'performant',
  'efficient',
  'flexible',
  'simple',
  'easy',
];

/** Pattern + suggestion pairs for "constraint without quantification". */
export const MISSING_CONSTRAINT_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  suggestion: string;
}> = [
  { pattern: /\bfast\b/gi, suggestion: 'Define specific latency target (e.g., <200ms p95)' },
  { pattern: /\bsecure\b/gi, suggestion: 'Specify security controls (encryption, auth, audit)' },
  { pattern: /\bhigh availability\b/gi, suggestion: 'Define uptime SLA (e.g., 99.9%)' },
  { pattern: /\blarge scale\b/gi, suggestion: 'Quantify expected load (users, requests/sec)' },
  { pattern: /\breal[- ]?time\b/gi, suggestion: 'Define latency requirement (e.g., <1s, <100ms)' },
];

export interface AmbiguityFinding {
  type: 'vague_language' | 'missing_constraint';
  line: number;
  severity: 'medium' | 'high';
  context: string;
  term?: string;
  suggestion?: string;
}

export interface AmbiguityMetrics {
  vague_terms: number;
  missing_constraints: number;
  assumption_count: number;
  ambiguity_density: number;
}

export interface ScanResult {
  success: boolean;
  error?: string;
  total_findings?: number;
  findings?: AmbiguityFinding[];
  metrics?: AmbiguityMetrics;
  file?: string;
}

export interface HeatmapEntry extends AmbiguityMetrics {
  file: string;
  total_findings: number;
}

export interface HeatmapResult {
  success: true;
  files_scanned: number;
  results: HeatmapEntry[];
  overall: {
    total_findings: number;
    highest_density_file: string | null;
  };
}

export interface ScanOptions {
  limit?: number;
}

/**
 * Scan free-text for ambiguity indicators. Returns success=false +
 * error when text is empty (matches legacy guard verbatim).
 */
export function scanAmbiguity(text: string, options: ScanOptions = {}): ScanResult {
  if (!text) return { success: false, error: 'Text content is required' };

  const lines = text.split('\n');
  const findings: AmbiguityFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    for (const term of VAGUE_TERMS) {
      const regex = new RegExp(`\\b${term}\\b`, 'gi');
      const matches = line.match(regex);
      if (matches) {
        findings.push({
          type: 'vague_language',
          term,
          line: lineNum,
          severity: 'medium',
          context: line.trim().substring(0, 100),
        });
      }
    }

    for (const { pattern, suggestion } of MISSING_CONSTRAINT_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        findings.push({
          type: 'missing_constraint',
          line: lineNum,
          severity: 'high',
          suggestion,
          context: line.trim().substring(0, 100),
        });
        pattern.lastIndex = 0;
      }
    }
  }

  const assumptions = (text.match(/\bassume[ds]?\b|\bassuming\b|\bassumption/gi) || []).length;
  const totalLines = lines.filter((l) => l.trim().length > 0).length;

  return {
    success: true,
    total_findings: findings.length,
    findings: findings.slice(0, options.limit || 50),
    metrics: {
      vague_terms: findings.filter((f) => f.type === 'vague_language').length,
      missing_constraints: findings.filter((f) => f.type === 'missing_constraint').length,
      assumption_count: assumptions,
      ambiguity_density: totalLines > 0 ? Math.round((findings.length / totalLines) * 100) : 0,
    },
  };
}

/** Scan an on-disk file. Adds `file` to the result. */
export function scanFile(filePath: string, options: ScanOptions = {}): ScanResult {
  if (!existsSync(filePath)) {
    return { success: false, error: `File not found: ${filePath}` };
  }
  const content = readFileSync(filePath, 'utf8');
  const result = scanAmbiguity(content, options);
  result.file = filePath;
  return result;
}

/**
 * Build a heatmap of every `.md` file under `<root>/specs/`. Sorted
 * descending by `ambiguity_density`. Empty input — missing specs dir
 * returns the same `success: true` envelope with zero results.
 */
export function generateHeatmap(root: string, options: ScanOptions = {}): HeatmapResult {
  const specsDir = path.join(root, 'specs');
  const results: HeatmapEntry[] = [];

  if (existsSync(specsDir)) {
    for (const f of readdirSync(specsDir).filter((n) => n.endsWith('.md'))) {
      const fp = path.join(specsDir, f);
      const result = scanFile(fp, options);
      if (result.success && result.metrics) {
        results.push({
          file: f,
          ...result.metrics,
          total_findings: result.total_findings ?? 0,
        });
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
      highest_density_file: results.length > 0 ? results[0].file : null,
    },
  };
}
