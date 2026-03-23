/**
 * Tests for bin/lib/ops-ownership.js — Operational Ownership Modeling (Item 39)
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
  defineOwnership,
  checkCompleteness,
  generateReport,
  OWNERSHIP_FIELDS
} = require('../bin/lib/ops-ownership.js');

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-test-'));
  fs.mkdirSync(path.join(tmpDir, '.jumpstart', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'specs'), { recursive: true });
  return tmpDir;
}
function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

describe('ops-ownership', () => {
  let tmpDir;
  let stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'ops-ownership.json');
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  describe('constants', () => {
    it('exports OWNERSHIP_FIELDS array', () => {
      expect(OWNERSHIP_FIELDS).toBeInstanceOf(Array);
      expect(OWNERSHIP_FIELDS).toContain('service_owner');
      expect(OWNERSHIP_FIELDS).toContain('escalation_path');
      expect(OWNERSHIP_FIELDS).toContain('oncall_model');
    });
  });

  describe('defaultState', () => {
    it('returns valid default state', () => {
      const state = defaultState();
      expect(state.version).toBe('1.0.0');
      expect(state.services).toEqual([]);
      expect(state.last_updated).toBeNull();
    });
  });

  describe('loadState / saveState', () => {
    it('returns default when file missing', () => {
      const state = loadState(stateFile);
      expect(state.services).toEqual([]);
    });

    it('round-trips correctly', () => {
      const state = defaultState();
      state.services.push({ id: 'OPS-001', name: 'api' });
      saveState(state, stateFile);

      const loaded = loadState(stateFile);
      expect(loaded.services).toHaveLength(1);
      expect(loaded.last_updated).not.toBeNull();
    });

    it('handles corrupted file', () => {
      fs.writeFileSync(stateFile, '!invalid!', 'utf8');
      const state = loadState(stateFile);
      expect(state.version).toBe('1.0.0');
    });
  });

  describe('defineOwnership', () => {
    it('fails without name', () => {
      const result = defineOwnership({ service_owner: 'alice' }, { stateFile });
      expect(result.success).toBe(false);
    });

    it('fails without service_owner', () => {
      const result = defineOwnership({ name: 'api' }, { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('service_owner');
    });

    it('fails with null input', () => {
      const result = defineOwnership(null, { stateFile });
      expect(result.success).toBe(false);
    });

    it('creates ownership with defaults', () => {
      const result = defineOwnership({
        name: 'Web API',
        service_owner: 'alice@example.com'
      }, { stateFile });

      expect(result.success).toBe(true);
      expect(result.service.name).toBe('Web API');
      expect(result.service.service_owner).toBe('alice@example.com');
      expect(result.service.oncall_model).toBe('business-hours');
      expect(result.service.support_hours).toBe('9x5');
      expect(result.service.sla_tier).toBe('silver');
      expect(result.service.id).toMatch(/^OPS-/);
    });

    it('creates ownership with full fields', () => {
      const result = defineOwnership({
        name: 'Payment API',
        service_owner: 'bob@example.com',
        team: 'Platform',
        escalation_path: ['bob', 'alice', 'cto'],
        oncall_model: '24x7',
        support_hours: '24x7',
        runbook_url: 'https://wiki.example.com/payment-runbook',
        sla_tier: 'gold'
      }, { stateFile });

      expect(result.success).toBe(true);
      expect(result.service.team).toBe('Platform');
      expect(result.service.escalation_path).toEqual(['bob', 'alice', 'cto']);
      expect(result.service.runbook_url).toBe('https://wiki.example.com/payment-runbook');
      expect(result.service.sla_tier).toBe('gold');
    });

    it('replaces existing service with same name', () => {
      defineOwnership({ name: 'api', service_owner: 'alice' }, { stateFile });
      defineOwnership({ name: 'api', service_owner: 'bob' }, { stateFile });

      const state = loadState(stateFile);
      expect(state.services).toHaveLength(1);
      expect(state.services[0].service_owner).toBe('bob');
    });

    it('adds new service without replacing others', () => {
      defineOwnership({ name: 'api', service_owner: 'alice' }, { stateFile });
      defineOwnership({ name: 'db', service_owner: 'bob' }, { stateFile });

      const state = loadState(stateFile);
      expect(state.services).toHaveLength(2);
    });
  });

  describe('checkCompleteness', () => {
    it('returns all_complete true with no services', () => {
      const result = checkCompleteness({ stateFile });
      expect(result.success).toBe(true);
      expect(result.total_services).toBe(0);
      expect(result.all_complete).toBe(true);
    });

    it('detects incomplete service (missing team, escalation, runbook)', () => {
      defineOwnership({ name: 'api', service_owner: 'alice' }, { stateFile });

      const result = checkCompleteness({ stateFile });
      expect(result.incomplete).toBe(1);
      expect(result.all_complete).toBe(false);
      expect(result.findings[0].missing).toContain('team');
      expect(result.findings[0].missing).toContain('escalation_path');
      expect(result.findings[0].missing).toContain('runbook_url');
    });

    it('reports complete when all fields filled', () => {
      defineOwnership({
        name: 'api',
        service_owner: 'alice',
        team: 'Platform',
        escalation_path: ['alice', 'cto'],
        runbook_url: 'https://wiki/runbook'
      }, { stateFile });

      const result = checkCompleteness({ stateFile });
      expect(result.complete).toBe(1);
      expect(result.incomplete).toBe(0);
      expect(result.all_complete).toBe(true);
    });
  });

  describe('generateReport', () => {
    it('returns empty report with no services', () => {
      const result = generateReport({ stateFile });
      expect(result.success).toBe(true);
      expect(result.total_services).toBe(0);
      expect(result.by_team).toEqual({});
      expect(result.by_tier).toEqual({});
    });

    it('aggregates by team and tier', () => {
      defineOwnership({ name: 'api', service_owner: 'alice', team: 'Platform', sla_tier: 'gold' }, { stateFile });
      defineOwnership({ name: 'db', service_owner: 'bob', team: 'Platform', sla_tier: 'platinum' }, { stateFile });
      defineOwnership({ name: 'cache', service_owner: 'charlie', team: 'Infra' }, { stateFile });

      const result = generateReport({ stateFile });
      expect(result.total_services).toBe(3);
      expect(result.by_team['Platform']).toBe(2);
      expect(result.by_team['Infra']).toBe(1);
      expect(result.by_tier['gold']).toBe(1);
    });

    it('counts unassigned team as "unassigned"', () => {
      defineOwnership({ name: 'orphan', service_owner: 'nobody' }, { stateFile });

      const result = generateReport({ stateFile });
      expect(result.by_team['unassigned']).toBe(1);
    });
  });
});
