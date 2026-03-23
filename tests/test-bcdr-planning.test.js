/**
 * Tests for bin/lib/bcdr-planning.js — Business Continuity & DR Planning (Item 38)
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
  defineService,
  checkCoverage,
  generateReport,
  SERVICE_TIERS,
  BCDR_COMPONENTS
} = require('../bin/lib/bcdr-planning.js');

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-test-'));
  fs.mkdirSync(path.join(tmpDir, '.jumpstart', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'specs'), { recursive: true });
  return tmpDir;
}
function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

describe('bcdr-planning', () => {
  let tmpDir;
  let stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'bcdr.json');
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  describe('constants', () => {
    it('exports SERVICE_TIERS with expected tiers', () => {
      expect(SERVICE_TIERS).toHaveProperty('platinum');
      expect(SERVICE_TIERS).toHaveProperty('gold');
      expect(SERVICE_TIERS).toHaveProperty('silver');
      expect(SERVICE_TIERS).toHaveProperty('bronze');
      expect(SERVICE_TIERS.platinum.rto_hours).toBe(0.25);
    });

    it('exports BCDR_COMPONENTS array', () => {
      expect(BCDR_COMPONENTS).toBeInstanceOf(Array);
      expect(BCDR_COMPONENTS).toContain('rto-rpo');
      expect(BCDR_COMPONENTS).toContain('failover-design');
      expect(BCDR_COMPONENTS).toContain('backup-validation');
    });
  });

  describe('defaultState', () => {
    it('returns valid default state', () => {
      const state = defaultState();
      expect(state.version).toBe('1.0.0');
      expect(state.services).toEqual([]);
      expect(state.dr_tests).toEqual([]);
    });
  });

  describe('loadState / saveState', () => {
    it('returns default when file missing', () => {
      const state = loadState(stateFile);
      expect(state.services).toEqual([]);
    });

    it('round-trips correctly', () => {
      const state = defaultState();
      state.services.push({ id: 'SVC-001', name: 'api' });
      saveState(state, stateFile);

      const loaded = loadState(stateFile);
      expect(loaded.services).toHaveLength(1);
      expect(loaded.last_updated).not.toBeNull();
    });

    it('handles corrupted file', () => {
      fs.writeFileSync(stateFile, 'broken', 'utf8');
      const state = loadState(stateFile);
      expect(state.version).toBe('1.0.0');
    });
  });

  describe('defineService', () => {
    it('fails without service name', () => {
      const result = defineService({}, { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('name');
    });

    it('fails with null service', () => {
      const result = defineService(null, { stateFile });
      expect(result.success).toBe(false);
    });

    it('fails with invalid tier', () => {
      const result = defineService({ name: 'api', tier: 'diamond' }, { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid tier');
    });

    it('creates service with silver tier defaults', () => {
      const result = defineService({ name: 'Web API' }, { stateFile });
      expect(result.success).toBe(true);
      expect(result.service.name).toBe('Web API');
      expect(result.service.tier).toBe('silver');
      expect(result.service.rto_hours).toBe(SERVICE_TIERS.silver.rto_hours);
      expect(result.service.rpo_hours).toBe(SERVICE_TIERS.silver.rpo_hours);
      expect(result.service.id).toMatch(/^SVC-/);
    });

    it('creates service with platinum tier', () => {
      const result = defineService({
        name: 'Payment Gateway',
        tier: 'platinum',
        dependencies: ['database', 'cache']
      }, { stateFile });

      expect(result.success).toBe(true);
      expect(result.service.tier).toBe('platinum');
      expect(result.service.rto_hours).toBe(0.25);
      expect(result.service.failover).toBe('automatic');
      expect(result.service.dependencies).toEqual(['database', 'cache']);
    });

    it('allows custom rto/rpo overrides', () => {
      const result = defineService({
        name: 'Custom',
        tier: 'gold',
        rto_hours: 0.5,
        rpo_hours: 0.5
      }, { stateFile });

      expect(result.service.rto_hours).toBe(0.5);
      expect(result.service.rpo_hours).toBe(0.5);
    });

    it('persists services to state', () => {
      defineService({ name: 'svc1' }, { stateFile });
      defineService({ name: 'svc2' }, { stateFile });
      const state = loadState(stateFile);
      expect(state.services).toHaveLength(2);
    });
  });

  describe('checkCoverage', () => {
    it('returns zero coverage with no architecture.md', () => {
      const result = checkCoverage(tmpDir);
      expect(result.success).toBe(true);
      expect(result.coverage).toBe(0);
      expect(result.gaps.length).toBe(BCDR_COMPONENTS.length);
    });

    it('detects RTO/RPO mentions in architecture spec', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'architecture.md'),
        '# Arch\n\n## Recovery\nRTO: 4 hours, RPO: 1 hour\n\nFailover is automatic.\nBackup snapshots daily.\nDisaster recovery plan.\n',
        'utf8');

      const result = checkCoverage(tmpDir);
      expect(result.components['rto-rpo']).toBe(true);
      expect(result.components['failover-design']).toBe(true);
      expect(result.components['backup-validation']).toBe(true);
      expect(result.components['recovery-procedures']).toBe(true);
      expect(result.coverage).toBeGreaterThan(0);
    });

    it('always marks communication-plan and testing-schedule as gaps', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'architecture.md'),
        '# Arch\nRTO RPO failover backup disaster\n', 'utf8');

      const result = checkCoverage(tmpDir);
      expect(result.gaps).toContain('communication-plan');
      expect(result.gaps).toContain('testing-schedule');
    });

    it('generates recommendations for gaps', () => {
      const result = checkCoverage(tmpDir);
      expect(result.recommendations.length).toBe(BCDR_COMPONENTS.length);
      expect(result.recommendations[0]).toContain('Add');
    });
  });

  describe('generateReport', () => {
    it('returns empty report with no services', () => {
      const result = generateReport({ stateFile });
      expect(result.success).toBe(true);
      expect(result.total_services).toBe(0);
      expect(result.lowest_rto).toBeNull();
      expect(result.lowest_rpo).toBeNull();
    });

    it('aggregates services by tier', () => {
      defineService({ name: 'api', tier: 'gold' }, { stateFile });
      defineService({ name: 'db', tier: 'platinum' }, { stateFile });
      defineService({ name: 'cache', tier: 'gold' }, { stateFile });

      const result = generateReport({ stateFile });
      expect(result.total_services).toBe(3);
      expect(result.by_tier.gold).toBe(2);
      expect(result.by_tier.platinum).toBe(1);
      expect(result.lowest_rto).toBe(0.25);
    });
  });
});
