/**
 * deterministic-artifacts.ts — Deterministic Artifact Generation port (T4.4.3, cluster L).
 *
 * Pure-library port of `bin/lib/deterministic-artifacts.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `normalizeMarkdown(content)` => string
 *   - `hashContent(content)` => string
 *   - `normalizeFile(filePath, options?)` => NormalizeFileResult
 *   - `verifyStability(file1, file2)` => StabilityResult
 *   - `normalizeSpecs(root, options?)` => NormalizeSpecsResult
 *
 * Behavior parity:
 *   - Normalization rules (in order): CRLF→LF, tab→2sp, trim trailing,
 *     collapse 3+ newlines to 2, strip HTML comments, replace ISO-8601
 *     timestamps with `[TIMESTAMP]`, replace UUIDs with `[UUID]`,
 *     trim+single trailing newline.
 *   - SHA-256 hash of normalized content, first 16 hex chars.
 *   - Recursive walk of all markdown files under `<root>/specs/`.
 *   - CLI entry-point intentionally omitted.
 *
 * @see bin/lib/deterministic-artifacts.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.3
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface NormalizeOptions {
  write?: boolean;
  [key: string]: unknown;
}

export interface NormalizeFileResult {
  success: boolean;
  file?: string;
  original_length?: number;
  normalized_length?: number;
  hash?: string;
  modified?: boolean;
  error?: string;
}

export interface StabilityResult {
  success: boolean;
  identical?: boolean;
  similarity?: number;
  hash1?: string;
  hash2?: string;
  diff_lines?: number;
  total_lines?: number;
  error?: string;
}

export interface NormalizeSpecsResult {
  success: boolean;
  files: number;
  modified?: number;
  results?: NormalizeFileResult[];
  message?: string;
}

/**
 * Normalize markdown content for deterministic comparison.
 */
export function normalizeMarkdown(content: string): string {
  return `${content
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/<!--.*?-->/gs, '')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\s]*/g, '[TIMESTAMP]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[UUID]')
    .trim()}\n`;
}

/**
 * Generate a content hash for an artifact.
 */
export function hashContent(content: string): string {
  const normalized = normalizeMarkdown(content);
  return createHash('sha256').update(normalized).digest('hex').substring(0, 16);
}

/**
 * Normalize a file for deterministic comparison.
 */
export function normalizeFile(
  filePath: string,
  options: NormalizeOptions = {}
): NormalizeFileResult {
  if (!existsSync(filePath)) {
    return { success: false, error: `File not found: ${filePath}` };
  }

  const content = readFileSync(filePath, 'utf8');
  const normalized = normalizeMarkdown(content);
  const hash = hashContent(content);

  if (options.write) {
    writeFileSync(filePath, normalized, 'utf8');
  }

  return {
    success: true,
    file: filePath,
    original_length: content.length,
    normalized_length: normalized.length,
    hash,
    modified: content !== normalized,
  };
}

/**
 * Verify artifact stability between versions.
 */
export function verifyStability(file1: string, file2: string): StabilityResult {
  if (!existsSync(file1)) return { success: false, error: `File not found: ${file1}` };
  if (!existsSync(file2)) return { success: false, error: `File not found: ${file2}` };

  const content1 = normalizeMarkdown(readFileSync(file1, 'utf8'));
  const content2 = normalizeMarkdown(readFileSync(file2, 'utf8'));
  const hash1 = hashContent(content1);
  const hash2 = hashContent(content2);

  const lines1 = content1.split('\n');
  const lines2 = content2.split('\n');
  let diffLines = 0;

  const maxLines = Math.max(lines1.length, lines2.length);
  for (let i = 0; i < maxLines; i++) {
    if (lines1[i] !== lines2[i]) diffLines++;
  }

  const similarity = maxLines > 0 ? Math.round(((maxLines - diffLines) / maxLines) * 100) : 100;

  return {
    success: true,
    identical: hash1 === hash2,
    similarity,
    hash1,
    hash2,
    diff_lines: diffLines,
    total_lines: maxLines,
  };
}

/**
 * Batch normalize all spec files.
 */
export function normalizeSpecs(root: string, options: NormalizeOptions = {}): NormalizeSpecsResult {
  const specsDir = join(root, 'specs');
  if (!existsSync(specsDir)) {
    return { success: true, files: 0, message: 'No specs directory found' };
  }

  const results: NormalizeFileResult[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(normalizeFile(join(dir, entry.name), options));
      }
    }
  }
  walk(specsDir);

  return {
    success: true,
    files: results.length,
    modified: results.filter((r) => r.modified).length,
    results,
  };
}
