/**
 * Tests for bin/lib/vendor-risk.js — Vendor & Dependency Risk Scoring (Item 36)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  defaultState,
  loadState,
  saveState,
  scanDependencies,
  assessDependency,
  generateReport,
  RISK_FACTORS,
  LICENSE_RISK
} = require('../bin/lib/vendor-risk.js');

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-test-'));
  fs.mkdirSync(path.join(tmpDir, '.jumpstart', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'specs'), { recursive: true });
  return tmpDir;
}
function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

describe('vendor-risk', () => {
  let tmpDir;
  let stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'vendor-risk.json');
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  describe('constants', () => {
    it('exports RISK_FACTORS array', () => {
      expect(RISK_FACTORS).toBeInstanceOf(Array);
      expect(RISK_FACTORS).toContain('maintenance');
      expect(RISK_FACTORS).toContain('license');
      expect(RISK_FACTORS).toContain('security');
    });

    it('exports LICENSE_RISK with known licenses', () => {
      expect(LICENSE_RISK['MIT']).toBe('low');
      expect(LICENSE_RISK['GPL-3.0']).toBe('high');
      expect(LICENSE_RISK['UNLICENSED']).toBe('critical');
    });
  });

  describe('defaultState', () => {
    it('returns valid default state', () => {
      const state = defaultState();
      expect(state.version).toBe('1.0.0');
      expect(state.assessments).toEqual([]);
      expect(state.vendor_catalog).toEqual([]);
    });
  });

  describe('loadState / saveState', () => {
    it('returns default state when file missing', () => {
      const state = loadState(stateFile);
      expect(state.assessments).toEqual([]);
    });

    it('round-trips state correctly', () => {
      const state = defaultState();
      state.assessments.push({ name: 'test-pkg' });
      saveState(state, stateFile);

      const loaded = loadState(stateFile);
      expect(loaded.assessments).toHaveLength(1);
      expect(loaded.last_updated).toBeDefined();
    });

    it('handles corrupted JSON gracefully', () => {
      fs.writeFileSync(stateFile, 'not json!', 'utf8');
      const state = loadState(stateFile);
      expect(state.version).toBe('1.0.0');
    });
  });

  describe('scanDependencies', () => {
    it('returns empty list when no package.json', () => {
      const result = scanDependencies(tmpDir);
      expect(result.success).toBe(true);
      expect(result.dependencies).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('scans production dependencies from package.json', () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
        dependencies: { 'express': '^4.18.0', 'lodash': '^4.17.21' },
        devDependencies: { 'vitest': '^1.0.0' }
      }), 'utf8');

      const result = scanDependencies(tmpDir);
      expect(result.success).toBe(true);
      expect(result.total).toBe(2);
      expect(result.dependencies[0].type).toBe('production');
      expect(result.dependencies[0].ecosystem).toBe('npm');
    });

    it('includes devDependencies when option is set', () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
        dependencies: { 'express': '^4.18.0' },
        devDependencies: { 'vitest': '^1.0.0' }
      }), 'utf8');

      const result = scanDependencies(tmpDir, { includeDevDeps: true });
      expect(result.total).toBe(2);
      const dev = result.dependencies.find(d => d.name === 'vitest');
      expect(dev.type).toBe('development');
    });

    it('handles malformed package.json', () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), '{bad', 'utf8');
      const result = scanDependencies(tmpDir);
      expect(result.success).toBe(true);
      expect(result.total).toBe(0);
    });
  });

  describe('assessDependency', () => {
    it('fails without dep name', () => {
      const result = assessDependency({}, { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('name');
    });

    it('fails with null dep', () => {
      const result = assessDependency(null, { stateFile });
      expect(result.success).toBe(false);
    });

    it('assesses low-risk dependency correctly', () => {
      const result = assessDependency({
        name: 'express',
        version: '4.18.0',
        license: 'MIT',
        last_publish: new Date().toISOString(),
        weekly_downloads: 5000000,
        has_lockfile: true
      }, { stateFile });

      expect(result.success).toBe(true);
      expect(result.assessment.risk_level).toBe('low');
      expect(result.assessment.scores.license).toBe(90);
      expect(result.assessment.scores.maintenance).toBe(90);
      expect(result.assessment.scores.popularity).toBe(90);
    });

    it('assesses high-risk dependency correctly', () => {
      const twoYearsAgo = new Date(Date.now() - 800 * 24 * 60 * 60 * 1000).toISOString();
      const result = assessDependency({
        name: 'abandoned-lib',
        version: '0.1.0',
        license: 'GPL-3.0',
        last_publish: twoYearsAgo,
        weekly_downloads: 50,
        known_vulnerabilities: true
      }, { stateFile });

      expect(result.success).toBe(true);
      expect(result.assessment.scores.license).toBe(30);
      expect(result.assessment.scores.security).toBe(20);
      expect(result.assessment.overall).toBeLessThan(50);
    });

    it('defaults unknown license to high risk', () => {
      const result = assessDependency({
        name: 'mystery-pkg',
        version: '1.0.0'
      }, { stateFile });

      expect(result.success).toBe(true);
      expect(result.assessment.license).toBe('unknown');
      expect(result.assessment.scores.license).toBe(30);
    });

    it('persists assessment to state', () => {
      assessDependency({ name: 'pkg-a', version: '1.0.0', license: 'MIT' }, { stateFile });
      const state = loadState(stateFile);
      expect(state.assessments).toHaveLength(1);
    });
  });

  describe('generateReport', () => {
    it('returns empty report when no assessments', () => {
      const result = generateReport({ stateFile });
      expect(result.success).toBe(true);
      expect(result.total_assessed).toBe(0);
      expect(result.average_score).toBe(0);
      expect(result.high_risk).toEqual([]);
    });

    it('aggregates assessments by risk level', () => {
      assessDependency({ name: 'safe', version: '1.0.0', license: 'MIT', weekly_downloads: 2000000, has_lockfile: true }, { stateFile });
      assessDependency({ name: 'risky', version: '0.1.0', license: 'UNLICENSED', known_vulnerabilities: true }, { stateFile });

      const result = generateReport({ stateFile });
      expect(result.total_assessed).toBe(2);
      expect(result.average_score).toBeGreaterThan(0);
      expect(result.by_risk).toBeDefined();
    });
  });
});
