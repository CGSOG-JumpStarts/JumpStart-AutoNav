import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-test-'));
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
  assessSystem,
  createPlan,
  generateReport,
  LEGACY_PLATFORMS,
  MODERNIZATION_PATTERNS
} = require('../bin/lib/legacy-modernizer.js');

describe('legacy-modernizer', () => {
  let tmpDir;
  let stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'legacy-modernization.json');
  });
  afterEach(() => cleanup(tmpDir));

  describe('LEGACY_PLATFORMS', () => {
    it('contains expected platforms', () => {
      expect(LEGACY_PLATFORMS).toHaveProperty('cobol');
      expect(LEGACY_PLATFORMS).toHaveProperty('jquery');
      expect(LEGACY_PLATFORMS.cobol.risk).toBe('high');
    });
  });

  describe('MODERNIZATION_PATTERNS', () => {
    it('lists known patterns', () => {
      expect(MODERNIZATION_PATTERNS).toContain('strangler-fig');
      expect(MODERNIZATION_PATTERNS).toContain('rewrite');
    });
  });

  describe('defaultState', () => {
    it('returns a fresh state object', () => {
      const s = defaultState();
      expect(s.version).toBe('1.0.0');
      expect(s.assessments).toEqual([]);
      expect(s.modernization_plans).toEqual([]);
    });
  });

  describe('loadState / saveState', () => {
    it('returns default when file missing', () => {
      const s = loadState(path.join(tmpDir, 'nope.json'));
      expect(s.version).toBe('1.0.0');
    });
    it('round-trips state', () => {
      const s = defaultState();
      s.assessments.push({ id: 'LEG-001' });
      saveState(s, stateFile);
      const loaded = loadState(stateFile);
      expect(loaded.assessments).toHaveLength(1);
      expect(loaded.last_updated).toBeTruthy();
    });
    it('returns default for corrupt file', () => {
      fs.writeFileSync(stateFile, '{bad json', 'utf8');
      const s = loadState(stateFile);
      expect(s.version).toBe('1.0.0');
    });
  });

  describe('assessSystem', () => {
    it('fails without name/platform', () => {
      expect(assessSystem(null)).toEqual({ success: false, error: 'name and platform are required' });
      expect(assessSystem({ name: 'x' })).toEqual({ success: false, error: 'name and platform are required' });
    });
    it('assesses a known platform', () => {
      const r = assessSystem({ name: 'OldApp', platform: 'cobol' }, { stateFile });
      expect(r.success).toBe(true);
      expect(r.assessment.risk_level).toBe('high');
      expect(r.assessment.id).toBe('LEG-001');
    });
    it('handles unknown platform with defaults', () => {
      const r = assessSystem({ name: 'X', platform: 'unknown-thing' }, { stateFile });
      expect(r.success).toBe(true);
      expect(r.assessment.risk_level).toBe('medium');
    });
  });

  describe('createPlan', () => {
    it('fails for missing assessment', () => {
      const r = createPlan('LEG-999', { target_platform: 'node' }, { stateFile });
      expect(r.success).toBe(false);
    });
    it('creates a plan for existing assessment', () => {
      assessSystem({ name: 'A', platform: 'jquery' }, { stateFile });
      const r = createPlan('LEG-001', { target_platform: 'react' }, { stateFile });
      expect(r.success).toBe(true);
      expect(r.plan.id).toBe('MOD-001');
      expect(r.plan.phases.length).toBeGreaterThan(0);
    });
  });

  describe('generateReport', () => {
    it('returns empty report on fresh state', () => {
      const r = generateReport({ stateFile });
      expect(r.success).toBe(true);
      expect(r.total_assessments).toBe(0);
    });
    it('reports after assessments', () => {
      assessSystem({ name: 'A', platform: 'cobol' }, { stateFile });
      assessSystem({ name: 'B', platform: 'cobol' }, { stateFile });
      const r = generateReport({ stateFile });
      expect(r.total_assessments).toBe(2);
      expect(r.by_platform.cobol).toBe(2);
    });
  });
});
