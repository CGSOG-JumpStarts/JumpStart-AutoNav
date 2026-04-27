/**
 * safe-rename.ts — safe large-scale rename/move engine port (T4.4.1, cluster J).
 *
 * Pure-library port of `bin/lib/safe-rename.js`. Public surface preserved
 * verbatim by name + signature:
 *
 *   - `REFERENCE_PATTERNS` (constant array)
 *   - `planRename(root, oldPath, newPath, options?)` => PlanRenameResult
 *   - `findReferences(root, targetPath, options?)` => Reference[]
 *   - `validateRename(root, oldPath, newPath)` => ValidateRenameResult
 *
 * Behavior parity:
 *   - Default exclude dirs: `node_modules`, `.git`, `dist`, `build`.
 *   - Search extensions: `.js .ts .md .json .yaml .yml`.
 *   - Search terms: raw `targetPath`, forward-slash form, and basename
 *     with extension stripped.
 *   - Reference content trimmed + truncated to 150 chars (legacy parity).
 *   - `>10 references` triggers a "review carefully" warning.
 *
 * Hardening (F2/F4/F9/F13 lessons from M3/M4):
 *   - Static `node:fs` import.
 *   - Patterns are exposed as fresh RegExp constants; downstream consumers
 *     using `String.matchAll` will not see leaked `lastIndex` state.
 *
 * @see bin/lib/safe-rename.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.1
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';

// Public types

export interface ReferencePattern {
  type: 'import' | 'markdown-link' | 'config-path';
  pattern: RegExp;
}

export interface RenameOptions {
  excludeDirs?: string[];
}

export interface Reference {
  file: string;
  line: number;
  content: string;
  match: string;
}

export interface PlanRenameResult {
  success: boolean;
  error?: string;
  old_path?: string;
  new_path?: string;
  references_found?: number;
  affected_files?: string[];
  references?: Reference[];
  safe?: boolean;
  warnings?: string[];
}

export interface ValidateRenameResult {
  success: boolean;
  new_file_exists: boolean;
  old_file_removed: boolean;
  stale_references: number;
  stale_files: string[];
  clean: boolean;
}

// Constants (verbatim from legacy)

export const REFERENCE_PATTERNS: ReferencePattern[] = [
  {
    type: 'import',
    pattern: /(?:import\s+.*from\s+['"]|require\(['"])(\.{0,2}\/[^'"]+)['"]/g,
  },
  { type: 'markdown-link', pattern: /\[([^\]]*)\]\(([^)]+)\)/g },
  { type: 'config-path', pattern: /"(?:path|file|dir|src|entry)":\s*"([^"]+)"/g },
];

const DEFAULT_EXCLUDE_DIRS = ['node_modules', '.git', 'dist', 'build'];
const SEARCHABLE_EXTENSIONS = new Set(['.js', '.ts', '.md', '.json', '.yaml', '.yml']);

/** Find all references to a file path under `root`. */
export function findReferences(
  root: string,
  targetPath: string,
  options: RenameOptions = {}
): Reference[] {
  const excludeDirs = options.excludeDirs || DEFAULT_EXCLUDE_DIRS;
  const references: Reference[] = [];
  const searchTerms = [
    targetPath,
    targetPath.replace(/\\/g, '/'),
    basename(targetPath, extname(targetPath)),
  ];

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
        if (SEARCHABLE_EXTENSIONS.has(ext)) {
          try {
            const fullPath = join(dir, entry.name);
            const content = readFileSync(fullPath, 'utf8');
            const relFile = relative(root, fullPath).replace(/\\/g, '/');

            for (const term of searchTerms) {
              if (content.includes(term)) {
                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                  if (lines[i].includes(term)) {
                    references.push({
                      file: relFile,
                      line: i + 1,
                      content: lines[i].trim().substring(0, 150),
                      match: term,
                    });
                  }
                }
              }
            }
          } catch {
            // skip unreadable file (legacy parity)
          }
        }
      }
    }
  }

  walk(root);
  return references;
}

/** Plan a rename/move and surface references that will need to follow. */
export function planRename(
  root: string,
  oldPath: string,
  newPath: string,
  options: RenameOptions = {}
): PlanRenameResult {
  if (!oldPath || !newPath) {
    return { success: false, error: 'oldPath and newPath are required' };
  }

  const absOld = join(root, oldPath);
  if (!existsSync(absOld)) {
    return { success: false, error: `Source not found: ${oldPath}` };
  }

  const references = findReferences(root, oldPath, options);
  const affected = Array.from(new Set(references.map((r) => r.file)));

  return {
    success: true,
    old_path: oldPath,
    new_path: newPath,
    references_found: references.length,
    affected_files: affected,
    references,
    safe: true,
    warnings: references.length > 10 ? ['Large number of references — review carefully'] : [],
  };
}

/** Validate that a rename was applied cleanly: new exists, old gone, no stale refs. */
export function validateRename(
  root: string,
  oldPath: string,
  newPath: string
): ValidateRenameResult {
  const newExists = existsSync(join(root, newPath));
  const oldExists = existsSync(join(root, oldPath));
  const staleRefs = findReferences(root, oldPath);

  return {
    success: true,
    new_file_exists: newExists,
    old_file_removed: !oldExists,
    stale_references: staleRefs.length,
    stale_files: Array.from(new Set(staleRefs.map((r) => r.file))),
    clean: newExists && !oldExists && staleRefs.length === 0,
  };
}
