/**
 * artifact-comparison.ts — artifact diff across versions (T4.1.7 batch).
 *
 * Pure-library port of `bin/lib/artifact-comparison.js`. Five exports
 * preserved verbatim: `compareArtifacts`, `compareFiles`,
 * `getArtifactHistory`, `extractSections`, `CHANGE_CATEGORIES`.
 *
 * Section extraction key is the markdown header line stripped of
 * leading `#`s — same key used by both sides of the comparison so
 * sections must match by HEADER TEXT, not nesting depth.
 *
 * @see bin/lib/artifact-comparison.js (legacy reference)
 * @see specs/implementation-plan.md T4.1.7
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

export const CHANGE_CATEGORIES: readonly string[] = ['added', 'removed', 'modified', 'moved'];

export type ChangeType = 'added' | 'removed' | 'modified' | 'moved';

export interface ArtifactChange {
  section: string;
  type: ChangeType;
  summary: string;
}

export type CompareResult =
  | { success: false; error: string }
  | {
      success: true;
      total_changes: number;
      changes: ArtifactChange[];
      lines_before: number;
      lines_after: number;
      line_diff: number;
      file_a?: string;
      file_b?: string;
    };

export interface HistoryEntry {
  file: string;
  path: string;
  current?: boolean;
}

export interface HistoryResult {
  success: true;
  artifact: string;
  versions: number;
  history: HistoryEntry[];
}

/**
 * Split markdown content into a `{ sectionKey: bodyText }` map. The
 * pre-first-header content goes under the special key `_header`. Body
 * text is joined with `\n` (no trailing separator). Multiple sections
 * with the same header text collapse into the last value (legacy
 * behavior — a known limitation, not a port-time regression).
 */
export function extractSections(lines: string[]): Record<string, string> {
  const sections: Record<string, string> = {};
  let current = '_header';
  let content: string[] = [];

  for (const line of lines) {
    if (line.match(/^#+\s/)) {
      if (content.length > 0) sections[current] = content.join('\n');
      current = line.replace(/^#+\s+/, '').trim();
      content = [];
    } else {
      content.push(line);
    }
  }
  if (content.length > 0) sections[current] = content.join('\n');

  return sections;
}

/**
 * Compare two artifact contents at the section level. Returns the
 * union of section keys with each marked added / removed / modified.
 * Empty input on either side returns success=false.
 */
export function compareArtifacts(
  contentA: string,
  contentB: string,
  _options: Record<string, unknown> = {}
): CompareResult {
  if (!contentA || !contentB) return { success: false, error: 'Both contents are required' };

  const linesA = contentA.split('\n');
  const linesB = contentB.split('\n');

  const sectionsA = extractSections(linesA);
  const sectionsB = extractSections(linesB);

  const changes: ArtifactChange[] = [];
  const allKeys = new Set([...Object.keys(sectionsA), ...Object.keys(sectionsB)]);

  for (const key of allKeys) {
    if (!sectionsA[key]) {
      changes.push({ section: key, type: 'added', summary: `New section: ${key}` });
    } else if (!sectionsB[key]) {
      changes.push({ section: key, type: 'removed', summary: `Removed section: ${key}` });
    } else if (sectionsA[key] !== sectionsB[key]) {
      changes.push({ section: key, type: 'modified', summary: `Modified section: ${key}` });
    }
  }

  return {
    success: true,
    total_changes: changes.length,
    changes,
    lines_before: linesA.length,
    lines_after: linesB.length,
    line_diff: linesB.length - linesA.length,
  };
}

/** File-based wrapper around `compareArtifacts`. */
export function compareFiles(
  fileA: string,
  fileB: string,
  options: Record<string, unknown> = {}
): CompareResult {
  if (!existsSync(fileA)) return { success: false, error: `File not found: ${fileA}` };
  if (!existsSync(fileB)) return { success: false, error: `File not found: ${fileB}` };

  const contentA = readFileSync(fileA, 'utf8');
  const contentB = readFileSync(fileB, 'utf8');
  const result = compareArtifacts(contentA, contentB, options);
  if (result.success) {
    result.file_a = fileA;
    result.file_b = fileB;
  }
  return result;
}

/**
 * Walk `<root>/.jumpstart/archive/` for any file matching
 * `<artifactName>` (substring match — legacy behavior) and append the
 * current `<root>/specs/<artifactName>` if it exists.
 */
export function getArtifactHistory(
  root: string,
  artifactName: string,
  _options: Record<string, unknown> = {}
): HistoryResult {
  const archiveDir = path.join(root, '.jumpstart', 'archive');
  const versions: HistoryEntry[] = [];

  if (existsSync(archiveDir)) {
    for (const f of readdirSync(archiveDir)) {
      if (f.includes(artifactName)) {
        versions.push({ file: f, path: path.join(archiveDir, f) });
      }
    }
  }

  const currentPath = path.join(root, 'specs', artifactName);
  if (existsSync(currentPath)) {
    versions.push({ file: artifactName, path: currentPath, current: true });
  }

  return { success: true, artifact: artifactName, versions: versions.length, history: versions };
}
