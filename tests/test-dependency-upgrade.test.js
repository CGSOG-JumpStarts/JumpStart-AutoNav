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
  scanUpgrades,
  createUpgradePlan,
  generateReport,
  UPGRADE_TYPES,
  RISK_BY_TYPE
} = require('../bin/lib/dependency-upgrade.js');

describe('dependency-upgrade', () => {
  let tmpDir;
  let stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'dependency-upgrades.json');
  });
  afterEach(() => cleanup(tmpDir));

  describe('constants', () => {
    it('has upgrade types', () => {
      expect(UPGRADE_TYPES).toContain('patch');
      expect(UPGRADE_TYPES).toContain('major');
    });
    it('maps risk by type', () => {
      expect(RISK_BY_TYPE.patch).toBe('low');
      expect(RISK_BY_TYPE.major).toBe('high');
    });
  });

  describe('defaultState', () => {
    it('returns fresh state', () => {
      const s = defaultState();
      expect(s.scans).toEqual([]);
      expect(s.upgrade_plans).toEqual([]);
    });
  });

  describe('loadState / saveState', () => {
    it('returns default when missing', () => {
      expect(loadState(path.join(tmpDir, 'x.json')).version).toBe('1.0.0');
    });
    it('round-trips', () => {
      const s = defaultState();
      s.scans.push({ ts: 1 });
      saveState(s, stateFile);
      expect(loadState(stateFile).scans).toHaveLength(1);
    });
  });

  describe('scanUpgrades', () => {
    it('fails without package.json', () => {
      const r = scanUpgrades(tmpDir);
      expect(r.success).toBe(false);
    });
    it('scans dependencies', () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
        dependencies: { express: '^4.18.0' },
        devDependencies: { vitest: '~1.0.0' }
      }));
      const r = scanUpgrades(tmpDir, { stateFile });
      expect(r.success).toBe(true);
      expect(r.total).toBe(2);
      expect(r.dependencies[0].type).toBe('minor-range');
      expect(r.dependencies[1].type).toBe('patch-range');
    });
    it('handles invalid package.json', () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), 'bad{');
      const r = scanUpgrades(tmpDir);
      expect(r.success).toBe(false);
    });
  });

  describe('createUpgradePlan', () => {
    it('fails without plan name', () => {
      expect(createUpgradePlan(null, { stateFile }).success).toBe(false);
    });
    it('creates an upgrade plan', () => {
      const r = createUpgradePlan({
        name: 'Q4 upgrades',
        upgrades: [{ package: 'express', from: '4.18', to: '4.19', type: 'patch' }]
      }, { stateFile });
      expect(r.success).toBe(true);
      expect(r.plan.id).toBe('UPG-001');
      expect(r.plan.upgrades[0].risk).toBe('low');
    });
  });

  describe('generateReport', () => {
    it('empty report', () => {
      const r = generateReport({ stateFile });
      expect(r.success).toBe(true);
      expect(r.total_plans).toBe(0);
    });
    it('reports after plan creation', () => {
      createUpgradePlan({ name: 'p1' }, { stateFile });
      const r = generateReport({ stateFile });
      expect(r.total_plans).toBe(1);
    });
  });
});
