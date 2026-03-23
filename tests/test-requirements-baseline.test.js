/**
 * test-requirements-baseline.test.js — Tests for Requirements Baseline & Change Control
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-baseline-'));
  fs.mkdirSync(path.join(tmpDir, '.jumpstart', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'specs'), { recursive: true });
  return tmpDir;
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function writeArtifact(tmpDir, relPath, content) {
  const fullPath = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
}

const {
  defaultBaseline,
  loadBaseline,
  saveBaseline,
  hashContent,
  extractRequirementIds,
  freezeBaseline,
  checkBaseline,
  assessImpact,
  getBaselineStatus,
  ARTIFACT_TYPES
} = require('../bin/lib/requirements-baseline');

describe('requirements-baseline', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  describe('defaultBaseline', () => {
    it('returns valid default structure', () => {
      const b = defaultBaseline();
      expect(b.version).toBe('1.0.0');
      expect(b.frozen).toBe(false);
      expect(b.baselines).toEqual([]);
      expect(b.change_requests).toEqual([]);
    });
  });

  describe('hashContent', () => {
    it('returns consistent SHA-256 hash', () => {
      const hash1 = hashContent('hello world');
      const hash2 = hashContent('hello world');
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it('returns different hash for different content', () => {
      expect(hashContent('a')).not.toBe(hashContent('b'));
    });
  });

  describe('extractRequirementIds', () => {
    it('extracts REQ-001 style IDs', () => {
      const ids = extractRequirementIds('See REQ-001 and REQ-002 for details');
      expect(ids).toContain('REQ-001');
      expect(ids).toContain('REQ-002');
    });

    it('extracts E01-S01 style IDs', () => {
      const ids = extractRequirementIds('Story E01-S01 and E02-S03');
      expect(ids).toContain('E01-S01');
      expect(ids).toContain('E02-S03');
    });

    it('extracts NFR-001 style IDs', () => {
      const ids = extractRequirementIds('NFR-001: Performance, NFR-002: Security');
      expect(ids).toContain('NFR-001');
      expect(ids).toContain('NFR-002');
    });

    it('deduplicates IDs', () => {
      const ids = extractRequirementIds('REQ-001 then REQ-001 again');
      expect(ids.filter(id => id === 'REQ-001')).toHaveLength(1);
    });

    it('returns empty array for no matches', () => {
      expect(extractRequirementIds('no requirements here')).toEqual([]);
    });
  });

  describe('loadBaseline / saveBaseline', () => {
    it('loads default when file missing', () => {
      const b = loadBaseline(path.join(tmpDir, 'nonexistent.json'));
      expect(b.frozen).toBe(false);
    });

    it('saves and loads baseline', () => {
      const filePath = path.join(tmpDir, '.jumpstart', 'state', 'test-baseline.json');
      const b = defaultBaseline();
      b.frozen = true;
      saveBaseline(b, filePath);

      const loaded = loadBaseline(filePath);
      expect(loaded.frozen).toBe(true);
      expect(loaded.last_updated).toBeTruthy();
    });
  });

  describe('freezeBaseline', () => {
    it('freezes existing artifacts', () => {
      writeArtifact(tmpDir, 'specs/prd.md', '# PRD\n\nREQ-001: Feature A\nE01-S01: Story 1');
      writeArtifact(tmpDir, 'specs/architecture.md', '# Architecture\n\nNFR-001: Performance');

      const result = freezeBaseline(tmpDir, {
        baselineFile: path.join(tmpDir, '.jumpstart', 'state', 'requirements-baseline.json')
      });

      expect(result.success).toBe(true);
      expect(result.artifacts_frozen).toBeGreaterThanOrEqual(2);
      expect(result.total_requirements).toBeGreaterThan(0);
      expect(result.baseline_id).toMatch(/^baseline-/);
    });

    it('fails when no specs directory', () => {
      fs.rmSync(path.join(tmpDir, 'specs'), { recursive: true });
      const result = freezeBaseline(tmpDir);
      expect(result.success).toBe(false);
    });

    it('fails when no artifacts exist', () => {
      const result = freezeBaseline(tmpDir, {
        baselineFile: path.join(tmpDir, '.jumpstart', 'state', 'requirements-baseline.json')
      });
      expect(result.success).toBe(false);
    });
  });

  describe('checkBaseline', () => {
    it('reports no frozen baseline', () => {
      const result = checkBaseline(tmpDir, {
        baselineFile: path.join(tmpDir, '.jumpstart', 'state', 'requirements-baseline.json')
      });
      expect(result.frozen).toBe(false);
    });

    it('detects changes after freeze', () => {
      const baselineFile = path.join(tmpDir, '.jumpstart', 'state', 'requirements-baseline.json');
      writeArtifact(tmpDir, 'specs/prd.md', '# PRD\n\nREQ-001: Feature A');

      freezeBaseline(tmpDir, { baselineFile });

      // Modify the artifact
      writeArtifact(tmpDir, 'specs/prd.md', '# PRD\n\nREQ-001: Feature A\nREQ-002: Feature B');

      const result = checkBaseline(tmpDir, { baselineFile });
      expect(result.frozen).toBe(true);
      expect(result.drifted).toBe(true);
      expect(result.changes.length).toBeGreaterThan(0);
    });

    it('reports unchanged when content same', () => {
      const baselineFile = path.join(tmpDir, '.jumpstart', 'state', 'requirements-baseline.json');
      writeArtifact(tmpDir, 'specs/prd.md', '# PRD\n\nREQ-001: Feature A');
      freezeBaseline(tmpDir, { baselineFile });

      const result = checkBaseline(tmpDir, { baselineFile });
      expect(result.drifted).toBe(false);
    });
  });

  describe('assessImpact', () => {
    it('returns none when no baseline', () => {
      const result = assessImpact('specs/prd.md', tmpDir, {
        baselineFile: path.join(tmpDir, '.jumpstart', 'state', 'requirements-baseline.json')
      });
      expect(result.impact).toBe('none');
    });

    it('returns none when artifact not in baseline', () => {
      const baselineFile = path.join(tmpDir, '.jumpstart', 'state', 'requirements-baseline.json');
      writeArtifact(tmpDir, 'specs/prd.md', '# PRD\n\nREQ-001: Feature A');
      freezeBaseline(tmpDir, { baselineFile });

      const result = assessImpact('specs/other.md', tmpDir, { baselineFile });
      expect(result.impact).toBe('none');
    });

    it('detects breaking changes when requirements removed', () => {
      const baselineFile = path.join(tmpDir, '.jumpstart', 'state', 'requirements-baseline.json');
      writeArtifact(tmpDir, 'specs/prd.md', '# PRD\n\nREQ-001: Feature A\nREQ-002: Feature B');
      freezeBaseline(tmpDir, { baselineFile });

      // Remove a requirement
      writeArtifact(tmpDir, 'specs/prd.md', '# PRD\n\nREQ-001: Feature A');

      const result = assessImpact('specs/prd.md', tmpDir, { baselineFile });
      expect(result.impact).toBe('critical');
      expect(result.assessment.change_type).toBe('breaking');
    });
  });

  describe('getBaselineStatus', () => {
    it('returns status with no baseline', () => {
      const result = getBaselineStatus({
        baselineFile: path.join(tmpDir, '.jumpstart', 'state', 'requirements-baseline.json')
      });
      expect(result.success).toBe(true);
      expect(result.frozen).toBe(false);
    });
  });

  describe('ARTIFACT_TYPES', () => {
    it('contains expected types', () => {
      expect(ARTIFACT_TYPES).toContain('prd');
      expect(ARTIFACT_TYPES).toContain('architecture');
      expect(ARTIFACT_TYPES).toContain('implementation-plan');
    });
  });
});
