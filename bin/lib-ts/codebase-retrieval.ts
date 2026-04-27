/**
 * codebase-retrieval.ts — codebase-native retrieval port (T4.4.1, cluster J).
 *
 * Pure-library port of `bin/lib/codebase-retrieval.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `RETRIEVABLE_TYPES` (constant array)
 *   - `FILE_PATTERNS` (constant map)
 *   - `indexProject(root, options?)` => IndexProjectResult
 *   - `queryFiles(root, query, options?)` => QueryFilesResult
 *
 * Behavior parity:
 *   - Default exclude dirs: `node_modules`, `.git`, `dist`, `build`.
 *   - Categorization regex preserves legacy heuristics (ADRs by path,
 *     tests by `.test.|.spec.|__tests__`, specs under `specs/`).
 *   - File walk emits forward-slash relative paths regardless of OS.
 *   - Query results sorted by match count desc, sliced to `limit || 20`.
 *   - Each file's preview is the first 5 lines containing the term.
 *
 * Hardening (F2/F4/F9/F13 lessons from M3/M4):
 *   - Static `node:fs` import (never inline `require`).
 *   - Categorization uses `String.matchAll`-friendly literal RegExp tests
 *     (no per-call `regex.exec` state).
 *   - Index map uses `Object.create(null)`-style population; lookups
 *     reject prototype-pollution-shaped keys before recursion.
 *
 * @see bin/lib/codebase-retrieval.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.1
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Public types

export interface IndexOptions {
  excludeDirs?: string[];
}

export interface QueryOptions extends IndexOptions {
  limit?: number;
}

export interface IndexCategoryEntry {
  type: string;
  count: number;
}

export interface IndexProjectResult {
  success: boolean;
  total_files: number;
  indexed: number;
  categories: IndexCategoryEntry[];
  index: Record<string, string[]>;
}

export interface QueryPreviewLine {
  line: number;
  content: string;
}

export interface QueryFileResult {
  file: string;
  type: string;
  matches: number;
  preview: QueryPreviewLine[];
}

export interface QueryFilesResult {
  success: boolean;
  error?: string;
  query?: string;
  total_results?: number;
  results?: QueryFileResult[];
}

// Constants (verbatim from legacy)

export const RETRIEVABLE_TYPES: string[] = [
  'adrs',
  'test-patterns',
  'implementations',
  'specs',
  'configs',
];

export const FILE_PATTERNS: Record<string, string[]> = {
  adrs: ['specs/decisions/*.md', 'docs/decisions/*.md', 'adr/*.md'],
  'test-patterns': ['tests/**/*.test.*', 'test/**/*.test.*', '__tests__/**/*'],
  specs: ['specs/*.md', 'docs/*.md'],
  configs: ['.jumpstart/*.yaml', '.jumpstart/*.json', 'package.json', 'tsconfig.json'],
};

const DEFAULT_EXCLUDE_DIRS = ['node_modules', '.git', 'dist', 'build'];

/** Walk a directory recursively; returns forward-slash relative paths. */
function walkFiles(rootDir: string, excludeDirs: string[]): string[] {
  function inner(dir: string, relDir: string): string[] {
    if (!existsSync(dir)) return [];
    const results: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      // Reject prototype-pollution-shaped names defensively (F13).
      if (
        entry.name === '__proto__' ||
        entry.name === 'constructor' ||
        entry.name === 'prototype'
      ) {
        continue;
      }
      const rel = join(relDir, entry.name);
      if (entry.isDirectory()) {
        if (!excludeDirs.includes(entry.name)) {
          results.push(...inner(join(dir, entry.name), rel));
        }
      } else if (entry.isFile()) {
        results.push(rel.replace(/\\/g, '/'));
      }
    }
    return results;
  }
  return inner(rootDir, '');
}

/** Index project files by retrievable type. */
export function indexProject(root: string, options: IndexOptions = {}): IndexProjectResult {
  const excludeDirs = options.excludeDirs || DEFAULT_EXCLUDE_DIRS;
  const allFiles = walkFiles(root, excludeDirs);

  const index: Record<string, string[]> = {
    adrs: allFiles.filter(
      (f) => /specs\/decisions\/|docs\/decisions\/|^adr\//i.test(f) && f.endsWith('.md')
    ),
    'test-patterns': allFiles.filter((f) => /\.test\.|\.spec\.|__tests__/i.test(f)),
    specs: allFiles.filter((f) => /^specs\/.*\.md$/i.test(f)),
    configs: allFiles.filter((f) => /package\.json$|tsconfig|\.jumpstart\//i.test(f)),
    implementations: allFiles.filter((f) => /^src\//i.test(f)),
  };

  const indexedTotal = Object.entries(index).reduce((sum, [, files]) => sum + files.length, 0);

  return {
    success: true,
    total_files: allFiles.length,
    indexed: indexedTotal,
    categories: Object.entries(index).map(([type, files]) => ({ type, count: files.length })),
    index,
  };
}

/** Query indexed files for a content/path keyword. Returns up to `limit` matches. */
export function queryFiles(
  root: string,
  query: string,
  options: QueryOptions = {}
): QueryFilesResult {
  if (!query) return { success: false, error: 'query is required' };

  const idx = indexProject(root, options);
  const queryLower = query.toLowerCase();
  const results: QueryFileResult[] = [];

  for (const [type, files] of Object.entries(idx.index)) {
    if (type === '__proto__' || type === 'constructor' || type === 'prototype') continue;
    for (const file of files) {
      const absPath = join(root, file);
      try {
        const content = readFileSync(absPath, 'utf8');
        if (content.toLowerCase().includes(queryLower) || file.toLowerCase().includes(queryLower)) {
          const lines = content.split('\n');
          const matchingLines: QueryPreviewLine[] = lines
            .map((line, i) => ({ line: i + 1, content: line }))
            .filter((l) => l.content.toLowerCase().includes(queryLower))
            .slice(0, 5);

          results.push({
            file,
            type,
            matches: matchingLines.length,
            preview: matchingLines,
          });
        }
      } catch {
        // skip unreadable files (legacy parity)
      }
    }
  }

  results.sort((a, b) => b.matches - a.matches);

  return {
    success: true,
    query,
    total_results: results.length,
    results: results.slice(0, options.limit || 20),
  };
}
