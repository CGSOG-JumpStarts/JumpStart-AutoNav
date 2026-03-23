/**
 * test-semantic-diff.test.js — Tests for Cross-artifact Semantic Diffing
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-semdiff-'));
  fs.mkdirSync(path.join(tmpDir, 'specs'), { recursive: true });
  return tmpDir;
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

const {
  extractSections,
  extractRequirements,
  extractApiEndpoints,
  extractTableData,
  normalizeText,
  textSimilarity,
  compareArtifacts,
  compareFiles,
  crossArtifactDiff
} = require('../bin/lib/semantic-diff');

describe('semantic-diff', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  describe('extractSections', () => {
    it('extracts sections from markdown', () => {
      const content = '# Title\n\nIntro text.\n\n## Section A\n\nContent A.\n\n## Section B\n\nContent B.';
      const sections = extractSections(content);
      expect(sections.length).toBeGreaterThanOrEqual(3);
      expect(sections.some(s => s.heading === 'Section A')).toBe(true);
      expect(sections.some(s => s.heading === 'Section B')).toBe(true);
    });

    it('handles empty content', () => {
      const sections = extractSections('');
      expect(sections.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('extractRequirements', () => {
    it('extracts REQ and E-S IDs', () => {
      const reqs = extractRequirements('REQ-001, E01-S01, NFR-002, M01-T01');
      expect(reqs).toContain('REQ-001');
      expect(reqs).toContain('E01-S01');
      expect(reqs).toContain('NFR-002');
      expect(reqs).toContain('M01-T01');
    });

    it('returns empty for no matches', () => {
      expect(extractRequirements('plain text')).toEqual([]);
    });
  });

  describe('extractApiEndpoints', () => {
    it('extracts HTTP methods and paths', () => {
      const apis = extractApiEndpoints('GET /api/users\nPOST /api/users\nDELETE /api/users/:id');
      expect(apis).toHaveLength(3);
      expect(apis[0].method).toBe('GET');
      expect(apis[0].path).toBe('/api/users');
    });

    it('returns empty for no endpoints', () => {
      expect(extractApiEndpoints('no apis here')).toEqual([]);
    });
  });

  describe('extractTableData', () => {
    it('extracts table rows', () => {
      const content = '| Name | Age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |';
      const rows = extractTableData(content);
      expect(rows.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('normalizeText', () => {
    it('lowercases and collapses whitespace', () => {
      expect(normalizeText('Hello  World!')).toBe('hello world');
    });

    it('strips punctuation', () => {
      expect(normalizeText('a.b,c;d')).toBe('a b c d');
    });
  });

  describe('textSimilarity', () => {
    it('returns 1 for identical text', () => {
      expect(textSimilarity('hello world foo', 'hello world foo')).toBe(1);
    });

    it('returns 0 for completely different text', () => {
      const sim = textSimilarity('alpha beta gamma', 'delta epsilon zeta');
      expect(sim).toBe(0);
    });

    it('returns partial similarity for overlapping text', () => {
      const sim = textSimilarity('the quick brown fox jumps', 'the slow brown cat jumps');
      expect(sim).toBeGreaterThan(0);
      expect(sim).toBeLessThan(1);
    });

    it('handles empty strings', () => {
      expect(textSimilarity('', '')).toBe(1);
    });
  });

  describe('compareArtifacts', () => {
    it('detects identical content', () => {
      const content = '# Title\n\n## Section A\n\nContent here.\n';
      const result = compareArtifacts(content, content);
      expect(result.success).toBe(true);
      expect(result.overall_similarity).toBe(100);
      expect(result.has_breaking_changes).toBe(false);
    });

    it('detects added sections', () => {
      const a = '# Title\n\n## Section A\n\nContent.';
      const b = '# Title\n\n## Section A\n\nContent.\n\n## Section B\n\nNew content.';
      const result = compareArtifacts(a, b);
      expect(result.section_changes.some(c => c.type === 'section_added')).toBe(true);
    });

    it('detects removed sections', () => {
      const a = '# Title\n\n## Section A\n\nContent.\n\n## Section B\n\nContent B.';
      const b = '# Title\n\n## Section A\n\nContent.';
      const result = compareArtifacts(a, b);
      expect(result.section_changes.some(c => c.type === 'section_removed')).toBe(true);
    });

    it('detects requirement changes', () => {
      const a = '# PRD\n\nREQ-001: Feature A\nREQ-002: Feature B';
      const b = '# PRD\n\nREQ-001: Feature A\nREQ-003: Feature C';
      const result = compareArtifacts(a, b);
      expect(result.requirement_changes.added).toContain('REQ-003');
      expect(result.requirement_changes.removed).toContain('REQ-002');
    });

    it('detects API changes', () => {
      const a = 'GET /api/users\nPOST /api/users';
      const b = 'GET /api/users\nPUT /api/users/:id';
      const result = compareArtifacts(a, b);
      expect(result.api_changes.added.length).toBeGreaterThan(0);
      expect(result.api_changes.removed.length).toBeGreaterThan(0);
    });
  });

  describe('compareFiles', () => {
    it('compares two files on disk', () => {
      const fileA = path.join(tmpDir, 'a.md');
      const fileB = path.join(tmpDir, 'b.md');
      fs.writeFileSync(fileA, '# Title\n\nREQ-001: Feature\n', 'utf8');
      fs.writeFileSync(fileB, '# Title\n\nREQ-001: Feature\nREQ-002: New\n', 'utf8');

      const result = compareFiles(fileA, fileB);
      expect(result.success).toBe(true);
      expect(result.requirement_changes.added).toContain('REQ-002');
    });

    it('errors for missing file', () => {
      const result = compareFiles('/nonexistent/a.md', '/nonexistent/b.md');
      expect(result.success).toBe(false);
    });
  });

  describe('crossArtifactDiff', () => {
    it('analyzes cross-artifact consistency', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'prd.md'), '# PRD\n\nE01-S01: Story\n', 'utf8');
      fs.writeFileSync(path.join(tmpDir, 'specs', 'architecture.md'), '# Arch\n\nE01-S01: Referenced\n', 'utf8');

      const result = crossArtifactDiff(tmpDir);
      expect(result.success).toBe(true);
      expect(result.artifacts_analyzed).toBeGreaterThanOrEqual(2);
    });

    it('errors when no specs dir', () => {
      fs.rmSync(path.join(tmpDir, 'specs'), { recursive: true });
      const result = crossArtifactDiff(tmpDir);
      expect(result.success).toBe(false);
    });
  });
});
