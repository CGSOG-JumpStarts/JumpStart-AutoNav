/**
 * test-ambiguity-heatmap.test.ts — T4.1.7 batch (1/4).
 *
 * @see bin/lib-ts/ambiguity-heatmap.ts
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  generateHeatmap,
  MISSING_CONSTRAINT_PATTERNS,
  scanAmbiguity,
  scanFile,
  VAGUE_TERMS,
} from '../bin/lib-ts/ambiguity-heatmap.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'ambiguity-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('vocabulary constants', () => {
  it('exports the canonical VAGUE_TERMS list', () => {
    expect(VAGUE_TERMS).toContain('should');
    expect(VAGUE_TERMS).toContain('seamless');
    expect(VAGUE_TERMS).toContain('user-friendly');
  });

  it('exports MISSING_CONSTRAINT_PATTERNS as { pattern, suggestion } pairs', () => {
    expect(MISSING_CONSTRAINT_PATTERNS.length).toBeGreaterThan(0);
    expect(MISSING_CONSTRAINT_PATTERNS[0]).toHaveProperty('pattern');
    expect(MISSING_CONSTRAINT_PATTERNS[0]).toHaveProperty('suggestion');
  });
});

describe('scanAmbiguity', () => {
  it('returns success=false on empty text', () => {
    const r = scanAmbiguity('');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/required/);
  });

  it('flags vague-language terms with severity=medium', () => {
    const r = scanAmbiguity('The system should be intuitive and seamless.');
    expect(r.success).toBe(true);
    const types = r.findings?.map((f) => f.type) ?? [];
    expect(types).toContain('vague_language');
    expect(r.findings?.find((f) => f.term === 'should')?.severity).toBe('medium');
  });

  it('flags missing-constraint patterns with severity=high + suggestion', () => {
    const r = scanAmbiguity('The system must be fast and secure.');
    const hits = r.findings?.filter((f) => f.type === 'missing_constraint') ?? [];
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].severity).toBe('high');
    expect(typeof hits[0].suggestion).toBe('string');
  });

  it('counts assumption density', () => {
    const r = scanAmbiguity('We assume X. Assuming Y, the assumption is Z.');
    expect(r.metrics?.assumption_count).toBe(3);
  });

  it('honors the limit option to cap returned findings', () => {
    const text = `${Array(10).fill('should should should easy').join('\n')}\n`;
    const r = scanAmbiguity(text, { limit: 5 });
    expect(r.findings?.length).toBe(5);
  });

  it('computes ambiguity_density as a percentage of non-empty lines', () => {
    const r = scanAmbiguity('should\nshould\n\n');
    expect(r.metrics?.ambiguity_density).toBeGreaterThan(0);
  });
});

describe('scanFile + generateHeatmap', () => {
  it('scanFile returns error envelope on missing file', () => {
    const r = scanFile(path.join(tmpDir, 'missing.md'));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not found/);
  });

  it('scanFile populates `file` field on success', () => {
    const file = path.join(tmpDir, 'doc.md');
    writeFileSync(file, 'fast and seamless', 'utf8');
    const r = scanFile(file);
    expect(r.success).toBe(true);
    expect(r.file).toBe(file);
  });

  it('generateHeatmap walks specs/ and sorts by ambiguity_density desc', () => {
    mkdirSync(path.join(tmpDir, 'specs'));
    writeFileSync(path.join(tmpDir, 'specs', 'low.md'), 'concrete spec', 'utf8');
    writeFileSync(
      path.join(tmpDir, 'specs', 'high.md'),
      'should easy seamless intuitive fast secure',
      'utf8'
    );
    const r = generateHeatmap(tmpDir);
    expect(r.success).toBe(true);
    expect(r.files_scanned).toBe(2);
    expect(r.results[0].file).toBe('high.md');
    expect(r.overall.highest_density_file).toBe('high.md');
  });

  it('generateHeatmap returns zero results when specs/ is missing', () => {
    const r = generateHeatmap(tmpDir);
    expect(r.success).toBe(true);
    expect(r.files_scanned).toBe(0);
    expect(r.overall.highest_density_file).toBeNull();
  });
});
