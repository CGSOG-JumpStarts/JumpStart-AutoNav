/**
 * test-decision-conflicts.test.js — Tests for Decision Conflict Detection
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-conflicts-'));
  fs.mkdirSync(path.join(tmpDir, 'specs', 'decisions'), { recursive: true });
  return tmpDir;
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

const {
  extractADRDecisions,
  extractArchDecisions,
  extractPRDDecisions,
  extractTechReferences,
  extractPatternReferences,
  findConflicts,
  detectConflicts,
  CONFLICT_TYPES
} = require('../bin/lib/decision-conflicts');

describe('decision-conflicts', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  describe('CONFLICT_TYPES', () => {
    it('includes expected types', () => {
      expect(CONFLICT_TYPES).toContain('technology');
      expect(CONFLICT_TYPES).toContain('pattern');
      expect(CONFLICT_TYPES).toContain('requirement');
    });
  });

  describe('extractTechReferences', () => {
    it('extracts technology names', () => {
      const techs = extractTechReferences('We will use React with PostgreSQL and Docker');
      expect(techs).toContain('react');
      expect(techs).toContain('postgresql');
      expect(techs).toContain('docker');
    });

    it('returns empty for no tech terms', () => {
      expect(extractTechReferences('simple text')).toEqual([]);
    });
  });

  describe('extractPatternReferences', () => {
    it('extracts architectural patterns', () => {
      const patterns = extractPatternReferences('Using microservice architecture with event-driven communication');
      expect(patterns).toContain('microservice');
      expect(patterns).toContain('event-driven');
    });

    it('returns empty for no patterns', () => {
      expect(extractPatternReferences('simple text')).toEqual([]);
    });
  });

  describe('extractADRDecisions', () => {
    it('extracts decisions from ADR files', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'decisions', 'adr-001.md'),
        '# ADR 001: Use React\n\n**Status:** Accepted\n\n## Decision\n\nWe will use React for the frontend.\n', 'utf8');

      const decisions = extractADRDecisions(path.join(tmpDir, 'specs', 'decisions'));
      expect(decisions).toHaveLength(1);
      expect(decisions[0].type).toBe('adr');
      expect(decisions[0].technologies).toContain('react');
    });

    it('returns empty for missing directory', () => {
      expect(extractADRDecisions('/nonexistent')).toEqual([]);
    });
  });

  describe('extractArchDecisions', () => {
    it('extracts from architecture doc', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'architecture.md'),
        '# Architecture\n\n## Tech Stack\n\nUsing Express with PostgreSQL.\n\n## Patterns\n\nMicroservice architecture.\n', 'utf8');

      const decisions = extractArchDecisions(path.join(tmpDir, 'specs', 'architecture.md'));
      expect(decisions.length).toBeGreaterThan(0);
    });

    it('returns empty for missing file', () => {
      expect(extractArchDecisions('/nonexistent.md')).toEqual([]);
    });
  });

  describe('extractPRDDecisions', () => {
    it('extracts from PRD', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'prd.md'),
        '# PRD\n\n## Non-Functional Requirements\n\nLatency < 200ms. Use Redis for caching.\n', 'utf8');

      const decisions = extractPRDDecisions(path.join(tmpDir, 'specs', 'prd.md'));
      expect(decisions.length).toBeGreaterThan(0);
    });

    it('returns empty for missing file', () => {
      expect(extractPRDDecisions('/nonexistent.md')).toEqual([]);
    });
  });

  describe('findConflicts', () => {
    it('detects competing technologies', () => {
      const decisions = [
        { source: 'adr-001.md', type: 'adr', technologies: ['react'], patterns: [] },
        { source: 'adr-002.md', type: 'adr', technologies: ['vue'], patterns: [] }
      ];
      const conflicts = findConflicts(decisions);
      expect(conflicts.some(c => c.type === 'technology')).toBe(true);
    });

    it('detects contradictory patterns', () => {
      const decisions = [
        { source: 'arch.md', type: 'architecture', technologies: [], patterns: ['microservice'] },
        { source: 'prd.md', type: 'prd', technologies: [], patterns: ['monolith'] }
      ];
      const conflicts = findConflicts(decisions);
      expect(conflicts.some(c => c.type === 'pattern')).toBe(true);
    });

    it('returns empty when no conflicts', () => {
      const decisions = [
        { source: 'adr-001.md', type: 'adr', technologies: ['react'], patterns: ['microservice'] }
      ];
      const conflicts = findConflicts(decisions);
      expect(conflicts).toEqual([]);
    });
  });

  describe('detectConflicts', () => {
    it('runs full conflict detection', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'decisions', 'adr-001.md'),
        '# ADR 001: Use React\n\n## Decision\n\nUse React frontend.\n', 'utf8');
      fs.writeFileSync(path.join(tmpDir, 'specs', 'architecture.md'),
        '# Architecture\n\n## Frontend\n\nUsing React.\n', 'utf8');

      const result = detectConflicts(tmpDir);
      expect(result.success).toBe(true);
      expect(result.total_decisions).toBeGreaterThan(0);
    });

    it('handles empty project', () => {
      fs.rmSync(path.join(tmpDir, 'specs', 'decisions'), { recursive: true });
      const result = detectConflicts(tmpDir);
      expect(result.success).toBe(true);
    });
  });
});
