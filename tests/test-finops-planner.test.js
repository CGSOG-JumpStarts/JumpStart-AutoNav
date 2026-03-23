/**
 * Tests for bin/lib/finops-planner.js — FinOps-Aware Architecture Planning (Item 35)
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
  createEstimate,
  getOptimizations,
  generateReport,
  COST_CATEGORIES,
  CLOUD_PRICING_ESTIMATES
} = require('../bin/lib/finops-planner.js');

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-test-'));
  fs.mkdirSync(path.join(tmpDir, '.jumpstart', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'specs'), { recursive: true });
  return tmpDir;
}
function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

describe('finops-planner', () => {
  let tmpDir;
  let stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'finops.json');
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  describe('constants', () => {
    it('exports COST_CATEGORIES with expected entries', () => {
      expect(COST_CATEGORIES).toBeInstanceOf(Array);
      expect(COST_CATEGORIES).toContain('compute');
      expect(COST_CATEGORIES).toContain('storage');
      expect(COST_CATEGORIES).toContain('ai-ml');
    });

    it('exports CLOUD_PRICING_ESTIMATES with tiers', () => {
      expect(CLOUD_PRICING_ESTIMATES).toHaveProperty('compute');
      expect(CLOUD_PRICING_ESTIMATES.compute).toHaveProperty('low');
      expect(CLOUD_PRICING_ESTIMATES.compute).toHaveProperty('medium');
      expect(CLOUD_PRICING_ESTIMATES.compute).toHaveProperty('high');
    });
  });

  describe('defaultState', () => {
    it('returns a valid default state object', () => {
      const state = defaultState();
      expect(state.version).toBe('1.0.0');
      expect(state.estimates).toEqual([]);
      expect(state.budgets).toEqual([]);
      expect(state.optimizations).toEqual([]);
      expect(state.created_at).toBeDefined();
      expect(state.last_updated).toBeNull();
    });
  });

  describe('loadState / saveState', () => {
    it('returns default state when file does not exist', () => {
      const state = loadState(stateFile);
      expect(state.version).toBe('1.0.0');
      expect(state.estimates).toEqual([]);
    });

    it('saves and loads state round-trip', () => {
      const state = defaultState();
      state.estimates.push({ id: 'FIN-TEST', name: 'test' });
      saveState(state, stateFile);

      const loaded = loadState(stateFile);
      expect(loaded.estimates).toHaveLength(1);
      expect(loaded.estimates[0].id).toBe('FIN-TEST');
      expect(loaded.last_updated).toBeDefined();
    });

    it('returns default state on corrupted JSON', () => {
      fs.writeFileSync(stateFile, '{bad json', 'utf8');
      const state = loadState(stateFile);
      expect(state.version).toBe('1.0.0');
      expect(state.estimates).toEqual([]);
    });
  });

  describe('createEstimate', () => {
    it('fails without estimate name', () => {
      const result = createEstimate({}, { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('name');
    });

    it('fails with null estimate', () => {
      const result = createEstimate(null, { stateFile });
      expect(result.success).toBe(false);
    });

    it('creates estimate with compute components', () => {
      const result = createEstimate({
        name: 'Web API',
        components: [
          { name: 'App Server', category: 'compute', tier: 'medium', quantity: 2 }
        ]
      }, { stateFile });

      expect(result.success).toBe(true);
      expect(result.estimate.name).toBe('Web API');
      expect(result.estimate.id).toMatch(/^FIN-/);
      expect(result.estimate.breakdown).toHaveLength(1);
      expect(result.estimate.monthly_total).toBeGreaterThan(0);
      expect(result.estimate.annual_total).toBe(result.estimate.monthly_total * 12);
    });

    it('creates estimate with storage component (no hours multiplier)', () => {
      const result = createEstimate({
        name: 'Data Store',
        components: [
          { name: 'S3', category: 'storage', tier: 'low', quantity: 100 }
        ]
      }, { stateFile });

      expect(result.success).toBe(true);
      // Storage: rate * quantity * 1
      const expectedCost = CLOUD_PRICING_ESTIMATES.storage.low * 100;
      expect(result.estimate.breakdown[0].monthly_cost).toBe(Math.round(expectedCost * 100) / 100);
    });

    it('handles unknown category with manual monthly_cost', () => {
      const result = createEstimate({
        name: 'Custom',
        components: [
          { name: 'SaaS Tool', category: 'third-party', monthly_cost: 99.99 }
        ]
      }, { stateFile });

      expect(result.success).toBe(true);
      expect(result.estimate.breakdown[0].monthly_cost).toBe(99.99);
    });

    it('persists estimate to state file', () => {
      createEstimate({ name: 'Svc1', components: [] }, { stateFile });
      const state = loadState(stateFile);
      expect(state.estimates).toHaveLength(1);
      expect(state.estimates[0].name).toBe('Svc1');
    });
  });

  describe('getOptimizations', () => {
    it('returns empty recommendations for no estimates', () => {
      const result = getOptimizations({ stateFile });
      expect(result.success).toBe(true);
      expect(result.recommendations).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('recommends reserved instances for expensive compute', () => {
      const state = defaultState();
      state.estimates.push({
        name: 'Big API',
        breakdown: [{ name: 'Server', category: 'compute', monthly_cost: 600 }],
        monthly_total: 600
      });
      saveState(state, stateFile);

      const result = getOptimizations({ stateFile });
      expect(result.total).toBeGreaterThan(0);
      expect(result.recommendations[0].recommendation).toContain('reserved');
    });

    it('recommends storage tiering for expensive storage', () => {
      const state = defaultState();
      state.estimates.push({
        name: 'Data',
        breakdown: [{ name: 'Blob', category: 'storage', monthly_cost: 150 }],
        monthly_total: 150
      });
      saveState(state, stateFile);

      const result = getOptimizations({ stateFile });
      expect(result.total).toBe(1);
      expect(result.recommendations[0].recommendation).toContain('tiering');
    });

    it('recommends batching for expensive AI/ML', () => {
      const state = defaultState();
      state.estimates.push({
        name: 'ML Pipeline',
        breakdown: [{ name: 'GPT', category: 'ai-ml', monthly_cost: 300 }],
        monthly_total: 300
      });
      saveState(state, stateFile);

      const result = getOptimizations({ stateFile });
      expect(result.total).toBe(1);
      expect(result.recommendations[0].recommendation).toContain('batch');
    });
  });

  describe('generateReport', () => {
    it('returns empty report with no data', () => {
      const result = generateReport({ stateFile });
      expect(result.success).toBe(true);
      expect(result.total_estimates).toBe(0);
      expect(result.total_monthly).toBe(0);
      expect(result.total_annual).toBe(0);
      expect(result.by_category).toEqual({});
    });

    it('aggregates costs across multiple estimates', () => {
      createEstimate({
        name: 'Svc A',
        components: [{ name: 'CPU', category: 'compute', tier: 'low', quantity: 1 }]
      }, { stateFile });
      createEstimate({
        name: 'Svc B',
        components: [{ name: 'Disk', category: 'storage', tier: 'low', quantity: 10 }]
      }, { stateFile });

      const result = generateReport({ stateFile });
      expect(result.total_estimates).toBe(2);
      expect(result.total_monthly).toBeGreaterThan(0);
      expect(result.total_annual).toBe(Math.round(result.total_monthly * 12 * 100) / 100);
      expect(result.by_category).toHaveProperty('compute');
      expect(result.by_category).toHaveProperty('storage');
    });
  });
});
