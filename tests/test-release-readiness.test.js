/**
 * test-release-readiness.test.js — Tests for Release Readiness Reviews
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-release-'));
  fs.mkdirSync(path.join(tmpDir, '.jumpstart', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'specs'), { recursive: true });
  return tmpDir;
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

const {
  defaultState,
  loadState,
  saveState,
  assessReadiness,
  generateReport,
  READINESS_CATEGORIES,
  READINESS_LEVELS
} = require('../bin/lib/release-readiness');

describe('release-readiness', () => {
  let tmpDir;
  let stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'release-readiness.json');
  });

  afterEach(() => cleanup(tmpDir));

  describe('constants', () => {
    it('exports readiness categories', () => {
      expect(READINESS_CATEGORIES).toContain('quality');
      expect(READINESS_CATEGORIES).toContain('security');
      expect(READINESS_CATEGORIES).toContain('performance');
      expect(READINESS_CATEGORIES).toContain('rollback');
      expect(READINESS_CATEGORIES.length).toBe(8);
    });

    it('exports readiness levels in descending min order', () => {
      expect(READINESS_LEVELS.length).toBe(4);
      expect(READINESS_LEVELS[0].min).toBeGreaterThan(READINESS_LEVELS[1].min);
      for (const level of READINESS_LEVELS) {
        expect(level).toHaveProperty('label');
        expect(level).toHaveProperty('emoji');
        expect(level).toHaveProperty('recommendation');
      }
    });
  });

  describe('defaultState', () => {
    it('returns a fresh state with no assessments', () => {
      const state = defaultState();
      expect(state.version).toBe('1.0.0');
      expect(state.assessments).toEqual([]);
      expect(state.current_readiness).toBeNull();
    });
  });

  describe('loadState / saveState', () => {
    it('returns default state when file does not exist', () => {
      const state = loadState(stateFile);
      expect(state.assessments).toEqual([]);
    });

    it('round-trips state', () => {
      const state = defaultState();
      state.current_readiness = { total_score: 75 };
      saveState(state, stateFile);

      const loaded = loadState(stateFile);
      expect(loaded.current_readiness.total_score).toBe(75);
      expect(loaded.last_updated).toBeTruthy();
    });

    it('returns default state for corrupt file', () => {
      fs.writeFileSync(stateFile, 'nope', 'utf8');
      const state = loadState(stateFile);
      expect(state.version).toBe('1.0.0');
    });
  });

  describe('assessReadiness', () => {
    it('assesses a minimal project', () => {
      const result = assessReadiness(tmpDir, { stateFile });
      expect(result.success).toBe(true);
      expect(result.total_score).toBeGreaterThanOrEqual(0);
      expect(result.level).toBeTruthy();
      expect(result.recommendation).toBeTruthy();
      expect(result.scores).toBeDefined();
    });

    it('gives higher quality score when tests exist', () => {
      const baseResult = assessReadiness(tmpDir, { stateFile });

      // Create tests directory
      fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });
      const withTestsResult = assessReadiness(tmpDir, { stateFile });

      expect(withTestsResult.scores.quality).toBeGreaterThanOrEqual(baseResult.scores.quality);
    });

    it('detects lock file for dependencies score', () => {
      fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}', 'utf8');
      const result = assessReadiness(tmpDir, { stateFile });
      expect(result.scores.dependencies).toBe(80);
    });

    it('detects README for documentation score', () => {
      fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Project', 'utf8');
      const result = assessReadiness(tmpDir, { stateFile });
      expect(result.scores.documentation).toBeGreaterThanOrEqual(60);
    });

    it('detects NFRs in architecture doc', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'architecture.md'), '## Non-Functional Requirements\nNFR: latency < 200ms', 'utf8');
      const result = assessReadiness(tmpDir, { stateFile });
      expect(result.scores.performance).toBe(75);
    });

    it('identifies blockers (scores < 50)', () => {
      const result = assessReadiness(tmpDir, { stateFile });
      for (const blocker of result.blockers) {
        expect(result.scores[blocker]).toBeLessThan(50);
      }
    });

    it('identifies risks (50 <= score < 70)', () => {
      const result = assessReadiness(tmpDir, { stateFile });
      for (const risk of result.risks) {
        expect(result.scores[risk]).toBeGreaterThanOrEqual(50);
        expect(result.scores[risk]).toBeLessThan(70);
      }
    });

    it('saves assessment to state', () => {
      assessReadiness(tmpDir, { stateFile });
      const loaded = loadState(stateFile);
      expect(loaded.assessments).toHaveLength(1);
      expect(loaded.current_readiness).toBeTruthy();
    });
  });

  describe('generateReport', () => {
    it('returns error when no assessment exists', () => {
      const result = generateReport({ stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('No readiness assessment');
    });

    it('generates report after assessment', () => {
      assessReadiness(tmpDir, { stateFile });
      const result = generateReport({ stateFile });
      expect(result.success).toBe(true);
      expect(result.recommendation).toBeTruthy();
      expect(result.total_score).toBeGreaterThanOrEqual(0);
      expect(result.categories.length).toBe(READINESS_CATEGORIES.length);
    });

    it('categorizes each score as pass, warning, or fail', () => {
      assessReadiness(tmpDir, { stateFile });
      const result = generateReport({ stateFile });
      for (const cat of result.categories) {
        expect(['pass', 'warning', 'fail']).toContain(cat.status);
        if (cat.score >= 70) expect(cat.status).toBe('pass');
        else if (cat.score >= 50) expect(cat.status).toBe('warning');
        else expect(cat.status).toBe('fail');
      }
    });
  });
});
