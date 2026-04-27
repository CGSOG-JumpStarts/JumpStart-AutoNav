/**
 * test-artifact-comparison.test.ts — T4.1.7 batch (4/4).
 *
 * @see bin/lib-ts/artifact-comparison.ts
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CHANGE_CATEGORIES,
  compareArtifacts,
  compareFiles,
  extractSections,
  getArtifactHistory,
} from '../bin/lib-ts/artifact-comparison.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'artifact-cmp-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('CHANGE_CATEGORIES', () => {
  it('exports the canonical category list', () => {
    expect(CHANGE_CATEGORIES).toEqual(['added', 'removed', 'modified', 'moved']);
  });
});

describe('extractSections', () => {
  it('groups markdown content under the previous header', () => {
    const lines = ['# Title', 'pre', '## Section A', 'a body', '## Section B', 'b body'];
    const result = extractSections(lines);
    expect(result).toHaveProperty('Title');
    expect(result).toHaveProperty('Section A');
    expect(result['Section A']).toContain('a body');
    expect(result['Section B']).toContain('b body');
  });

  it('puts pre-header content under the special _header key', () => {
    const lines = ['preamble', 'still preamble', '## Real section', 'body'];
    const result = extractSections(lines);
    expect(result._header).toContain('preamble');
  });
});

describe('compareArtifacts', () => {
  it('returns success=false when either side is empty', () => {
    expect(compareArtifacts('', 'b').success).toBe(false);
    expect(compareArtifacts('a', '').success).toBe(false);
  });

  it('reports added / removed / modified per section', () => {
    const a = '# A\nbody1\n## kept\nsame\n## gone\nbye';
    const b = '# A\nbody1 changed\n## kept\nsame\n## new\nhi';
    const r = compareArtifacts(a, b);
    if (!r.success) throw new Error('expected success');
    const types = r.changes.map((c) => `${c.type}:${c.section}`).sort();
    // 'A' header changed, 'gone' removed, 'new' added, 'kept' unchanged.
    expect(types).toContain('removed:gone');
    expect(types).toContain('added:new');
    expect(types).toContain('modified:A');
  });

  it('reports line-count diff', () => {
    const a = 'line\n';
    const b = 'line\nline\nline\n';
    const r = compareArtifacts(a, b);
    if (!r.success) throw new Error('expected success');
    expect(r.lines_before).toBe(2); // split-trailing
    expect(r.lines_after).toBe(4);
    expect(r.line_diff).toBe(2);
  });
});

describe('compareFiles', () => {
  it('returns error envelope on missing files', () => {
    const a = path.join(tmpDir, 'a.md');
    const b = path.join(tmpDir, 'b.md');
    writeFileSync(a, '# A', 'utf8');
    expect(compareFiles(a, b).success).toBe(false);
    expect(compareFiles(b, a).success).toBe(false);
  });

  it('attaches file_a + file_b on success', () => {
    const a = path.join(tmpDir, 'a.md');
    const b = path.join(tmpDir, 'b.md');
    writeFileSync(a, '# A\nold', 'utf8');
    writeFileSync(b, '# A\nnew', 'utf8');
    const r = compareFiles(a, b);
    if (!r.success) throw new Error('expected success');
    expect(r.file_a).toBe(a);
    expect(r.file_b).toBe(b);
  });
});

describe('getArtifactHistory', () => {
  it('walks .jumpstart/archive/ for entries containing the artifact name', () => {
    const archive = path.join(tmpDir, '.jumpstart', 'archive');
    mkdirSync(archive, { recursive: true });
    writeFileSync(path.join(archive, 'prd-v1.md'), 'old', 'utf8');
    writeFileSync(path.join(archive, 'prd-v2.md'), 'older', 'utf8');
    writeFileSync(path.join(archive, 'unrelated.md'), 'nope', 'utf8');

    const r = getArtifactHistory(tmpDir, 'prd');
    expect(r.versions).toBe(2);
    expect(r.history.map((h) => h.file)).toEqual(
      expect.arrayContaining(['prd-v1.md', 'prd-v2.md'])
    );
  });

  it('appends the current spec entry with current=true', () => {
    const specs = path.join(tmpDir, 'specs');
    mkdirSync(specs, { recursive: true });
    writeFileSync(path.join(specs, 'prd.md'), 'current', 'utf8');

    const r = getArtifactHistory(tmpDir, 'prd.md');
    expect(r.history.some((h) => h.current === true)).toBe(true);
  });

  it('returns zero versions when neither archive nor current exists', () => {
    const r = getArtifactHistory(tmpDir, 'never-existed.md');
    expect(r.versions).toBe(0);
    expect(r.history).toEqual([]);
  });
});
