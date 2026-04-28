/**
 * regression.ts — Layer 5 Golden Master Regression Testing port (T4.6.x, M7).
 *
 * Pure-library port of `bin/lib/regression.js`. Public surface preserved
 * verbatim by name + signature shape:
 *
 *   - `loadGoldenMaster(name, mastersDir)` => GoldenMasterPair
 *   - `extractStructure(content)` => MarkdownStructure
 *   - `structuralDiff(actual, expected)` => StructuralDiff
 *   - `computeSimilarityScore(actual, expected)` => number
 *   - `runRegressionSuite(mastersDir, options?)` => RegressionSuiteResult
 *   - `DEFAULT_THRESHOLD` constant
 *
 * Behavior parity:
 *   - 85% similarity threshold default.
 *   - Section/story/component/table/codeBlock counts preserved.
 *   - ±20% variance tolerance on structural metrics.
 *
 * **No persistence path.** Read-only over a fixtures tree. ADR-012
 * redaction does not apply.
 *
 * **Path-safety hardening (NEW in this port).**
 *   `loadGoldenMaster(name, mastersDir)` accepts a `name` from the
 *   caller. We reject names containing path-separator or traversal
 *   sequences before doing the directory listing — the legacy was
 *   permissive (`fs.readdirSync(inputDir).filter(f => f.includes(name))`
 *   would happily include a name like `../../etc`). The new version
 *   rejects path-traversal-shaped names with `ValidationError`.
 *
 * @see bin/lib/regression.js (legacy reference, 224L)
 * @see specs/decisions/adr-009-ipc-stdin-path-traversal.md
 * @see specs/implementation-plan.md T4.6.x
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { ValidationError } from './errors.js';
import { extractFrontmatter } from './validator.js';

// ─────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────

export const DEFAULT_THRESHOLD = 85;

export interface GoldenMasterPair {
  input: string;
  expected: string;
  inputPath: string;
  expectedPath: string;
}

export interface MarkdownStructure {
  frontmatter: Record<string, unknown> | null;
  sections: string[];
  storyCount: number;
  componentCount: number;
  tables: number;
  codeBlocks: number;
}

export interface StructuralDiff {
  similarity: number;
  matches: string[];
  differences: string[];
}

export interface RegressionResult {
  name: string;
  input_file: string;
  expected_file: string;
  similarity: number;
  pass: boolean;
  differences: string[];
}

export interface RegressionSuiteResult {
  results: RegressionResult[];
  pass: boolean;
}

export interface RegressionOptions {
  threshold?: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Path-safety
// ─────────────────────────────────────────────────────────────────────────

function rejectTraversalName(name: string, schemaId: string): void {
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    name.includes('..') ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0') ||
    path.isAbsolute(name)
  ) {
    throw new ValidationError(`Invalid golden master name: ${name}`, schemaId, []);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Loading
// ─────────────────────────────────────────────────────────────────────────

/**
 * Load a golden master pair (input + expected output).
 */
export function loadGoldenMaster(name: string, mastersDir: string): GoldenMasterPair {
  rejectTraversalName(name, 'regression-loadGoldenMaster');

  const inputDir = path.join(mastersDir, 'input');
  const expectedDir = path.join(mastersDir, 'expected');

  // Find files matching the name
  const inputFiles = existsSync(inputDir)
    ? readdirSync(inputDir).filter((f) => f.includes(name))
    : [];
  const expectedFiles = existsSync(expectedDir)
    ? readdirSync(expectedDir).filter((f) => f.includes(name))
    : [];

  if (inputFiles.length === 0) {
    throw new Error(`No golden master input found for '${name}' in ${inputDir}`);
  }
  if (expectedFiles.length === 0) {
    throw new Error(`No golden master expected output found for '${name}' in ${expectedDir}`);
  }

  const inputPath = path.join(inputDir, inputFiles[0]);
  const expectedPath = path.join(expectedDir, expectedFiles[0]);

  return {
    input: readFileSync(inputPath, 'utf8'),
    expected: readFileSync(expectedPath, 'utf8'),
    inputPath,
    expectedPath,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Structure Extraction
// ─────────────────────────────────────────────────────────────────────────

/**
 * Extract structural elements from a markdown document for comparison.
 */
export function extractStructure(content: string): MarkdownStructure {
  const frontmatter = extractFrontmatter(content);

  // Extract H2 and H3 sections
  const sections = (content.match(/^#{2,3}\s+.+$/gm) ?? []).map((h) =>
    h.replace(/^#{2,3}\s+/, '').trim()
  );

  // Count stories
  const storyCount = (content.match(/\bE\d+-S\d+\b/g) ?? []).length;

  // Count components
  const componentCount = (content.match(/###\s+Component:/g) ?? []).length;

  // Count tables
  const tables = (content.match(/^\|.+\|$/gm) ?? []).length;

  // Count code blocks
  const codeBlocks = (content.match(/^```/gm) ?? []).length / 2;

  return {
    frontmatter,
    sections,
    storyCount,
    componentCount,
    tables: Math.max(0, tables),
    codeBlocks: Math.max(0, codeBlocks),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Structural Diff
// ─────────────────────────────────────────────────────────────────────────

/**
 * Perform a structural diff between actual and expected content.
 */
export function structuralDiff(actual: string, expected: string): StructuralDiff {
  const actualStruct = extractStructure(actual);
  const expectedStruct = extractStructure(expected);

  const matches: string[] = [];
  const differences: string[] = [];
  let totalChecks = 0;
  let matchCount = 0;

  // Compare frontmatter fields
  if (expectedStruct.frontmatter) {
    const expectedKeys = Object.keys(expectedStruct.frontmatter);
    totalChecks += expectedKeys.length;
    for (const key of expectedKeys) {
      if (actualStruct.frontmatter && actualStruct.frontmatter[key] !== undefined) {
        matchCount++;
        matches.push(`frontmatter.${key}`);
      } else {
        differences.push(`Missing frontmatter field: ${key}`);
      }
    }
  }

  // Compare sections
  totalChecks += expectedStruct.sections.length;
  for (const section of expectedStruct.sections) {
    if (actualStruct.sections.some((s) => s.toLowerCase() === section.toLowerCase())) {
      matchCount++;
      matches.push(`section: ${section}`);
    } else {
      differences.push(`Missing section: ${section}`);
    }
  }

  // Compare structural metrics (allow ±20% variance)
  const metrics: Array<{ name: string; expected: number; actual: number }> = [
    { name: 'storyCount', expected: expectedStruct.storyCount, actual: actualStruct.storyCount },
    {
      name: 'componentCount',
      expected: expectedStruct.componentCount,
      actual: actualStruct.componentCount,
    },
    { name: 'tables', expected: expectedStruct.tables, actual: actualStruct.tables },
    { name: 'codeBlocks', expected: expectedStruct.codeBlocks, actual: actualStruct.codeBlocks },
  ];

  for (const metric of metrics) {
    if (metric.expected > 0) {
      totalChecks++;
      const variance = Math.abs(metric.actual - metric.expected) / metric.expected;
      if (variance <= 0.2) {
        matchCount++;
        matches.push(`${metric.name}: ${metric.actual} (expected ${metric.expected})`);
      } else {
        differences.push(`${metric.name}: ${metric.actual} (expected ~${metric.expected})`);
      }
    }
  }

  const similarity = totalChecks > 0 ? Math.round((matchCount / totalChecks) * 100) : 100;

  return { similarity, matches, differences };
}

// ─────────────────────────────────────────────────────────────────────────
// Similarity Score
// ─────────────────────────────────────────────────────────────────────────

/**
 * Compute overall similarity score between actual and expected.
 */
export function computeSimilarityScore(actual: string, expected: string): number {
  return structuralDiff(actual, expected).similarity;
}

// ─────────────────────────────────────────────────────────────────────────
// Suite Runner
// ─────────────────────────────────────────────────────────────────────────

/**
 * Run the full regression suite against all golden masters.
 *
 * Pit Crew M7 HIGH (Reviewer): the pre-fix implementation called
 * `structuralDiff(expected, expected)` — comparing the expected file
 * against itself, ALWAYS reporting 100% similarity. A regression that
 * broke the actual artifact generation would have shipped green.
 *
 * Post-fix: `runRegressionSuite` requires an `actualGenerator` callback
 * that produces the artifact to compare against the golden master. If
 * no generator is supplied, the function is documented as a no-op
 * (returns `pass: true, results: []`) rather than producing a false
 * "100% similarity" signal that misleads CI gates.
 */
export interface RegressionRunOptions extends RegressionOptions {
  /** Generator that returns the actual artifact bytes for a given input
   *  filename. Caller-supplied; receives the input file's path inside
   *  `mastersDir/input/`. If omitted, the suite runs in no-op mode. */
  actualGenerator?: (inputFilePath: string) => string | Promise<string>;
}

export async function runRegressionSuite(
  mastersDir: string,
  options: RegressionRunOptions = {}
): Promise<RegressionSuiteResult> {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;

  if (!existsSync(mastersDir)) {
    return { results: [], pass: true };
  }

  const inputDir = path.join(mastersDir, 'input');
  const expectedDir = path.join(mastersDir, 'expected');

  if (!existsSync(inputDir) || !existsSync(expectedDir)) {
    return { results: [], pass: true };
  }

  // No-op mode (no generator supplied): return empty results rather
  // than a false-positive 100% match signal.
  if (!options.actualGenerator) {
    return { results: [], pass: true };
  }

  // Find golden master pairs (match by name pattern)
  const expectedFiles = readdirSync(expectedDir).filter((f) => f.endsWith('.md'));
  const results: RegressionResult[] = [];

  for (const expectedFile of expectedFiles) {
    // Extract name from expected file (e.g., 'todo-app-prd.md' → 'todo-app')
    const nameParts = expectedFile.replace('.md', '').split('-');
    const baseName = nameParts.slice(0, -1).join('-') || nameParts[0];

    const inputFiles = readdirSync(inputDir).filter((f) => f.includes(baseName));
    if (inputFiles.length === 0) continue;

    const inputFilePath = path.join(inputDir, inputFiles[0]);
    const expected = readFileSync(path.join(expectedDir, expectedFile), 'utf8');

    let actual: string;
    try {
      actual = await options.actualGenerator(inputFilePath);
    } catch (err) {
      results.push({
        name: baseName,
        input_file: inputFiles[0],
        expected_file: expectedFile,
        similarity: 0,
        pass: false,
        differences: [`actualGenerator threw: ${(err as Error).message}`],
      });
      continue;
    }

    const diff = structuralDiff(actual, expected);
    results.push({
      name: baseName,
      input_file: inputFiles[0],
      expected_file: expectedFile,
      similarity: diff.similarity,
      pass: diff.similarity >= threshold,
      differences: diff.differences,
    });
  }

  const allPass = results.every((r) => r.pass);

  return { results, pass: allPass };
}
