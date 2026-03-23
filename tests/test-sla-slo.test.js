/**
 * test-sla-slo.test.js — Tests for SLA & SLO Specification Support
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-sla-slo-'));
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
  defineSLO,
  applyTemplate,
  checkSLOCoverage,
  generateReport,
  SLO_TYPES,
  DEFAULT_SLO_TEMPLATES
} = require('../bin/lib/sla-slo.js');

describe('sla-slo', () => {
  let tmpDir;
  let stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'sla-slo.json');
  });

  afterEach(() => cleanup(tmpDir));

  describe('constants', () => {
    it('SLO_TYPES contains expected types', () => {
      expect(SLO_TYPES).toContain('availability');
      expect(SLO_TYPES).toContain('latency');
      expect(SLO_TYPES).toContain('throughput');
      expect(SLO_TYPES.length).toBe(6);
    });

    it('DEFAULT_SLO_TEMPLATES has expected templates', () => {
      expect(DEFAULT_SLO_TEMPLATES).toHaveProperty('web-api');
      expect(DEFAULT_SLO_TEMPLATES).toHaveProperty('batch-processing');
      expect(DEFAULT_SLO_TEMPLATES).toHaveProperty('data-pipeline');
    });
  });

  describe('defaultState', () => {
    it('returns a valid default state', () => {
      const state = defaultState();
      expect(state.version).toBe('1.0.0');
      expect(state.slos).toEqual([]);
      expect(state.slas).toEqual([]);
      expect(state.error_budgets).toEqual([]);
      expect(state.last_updated).toBeNull();
    });
  });

  describe('loadState / saveState', () => {
    it('returns default state when file does not exist', () => {
      const state = loadState(stateFile);
      expect(state.version).toBe('1.0.0');
      expect(state.slos).toEqual([]);
    });

    it('saves and loads state correctly', () => {
      const state = defaultState();
      state.slos.push({ id: 'SLO-TEST', name: 'test' });
      saveState(state, stateFile);
      const loaded = loadState(stateFile);
      expect(loaded.slos).toHaveLength(1);
      expect(loaded.slos[0].id).toBe('SLO-TEST');
      expect(loaded.last_updated).toBeTruthy();
    });

    it('returns default state on corrupt JSON', () => {
      fs.writeFileSync(stateFile, '{bad json', 'utf8');
      const state = loadState(stateFile);
      expect(state.version).toBe('1.0.0');
      expect(state.slos).toEqual([]);
    });
  });

  describe('defineSLO', () => {
    it('defines a valid SLO', () => {
      const result = defineSLO(
        { name: 'API Availability', service: 'api', target: 99.9, type: 'availability' },
        { stateFile }
      );
      expect(result.success).toBe(true);
      expect(result.slo.name).toBe('API Availability');
      expect(result.slo.service).toBe('api');
      expect(result.slo.target).toBe(99.9);
      expect(result.slo.id).toMatch(/^SLO-/);
    });

    it('fails when required fields are missing', () => {
      const result = defineSLO({}, { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });

    it('fails with null input', () => {
      const result = defineSLO(null, { stateFile });
      expect(result.success).toBe(false);
    });

    it('rejects invalid SLO type', () => {
      const result = defineSLO(
        { name: 'Test', service: 'svc', target: 99, type: 'invalid-type' },
        { stateFile }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid type');
    });

    it('uses default values for optional fields', () => {
      const result = defineSLO(
        { name: 'Test', service: 'svc', target: 99 },
        { stateFile }
      );
      expect(result.success).toBe(true);
      expect(result.slo.type).toBe('availability');
      expect(result.slo.unit).toBe('percent');
      expect(result.slo.window).toBe('30d');
    });
  });

  describe('applyTemplate', () => {
    it('applies web-api template', () => {
      const result = applyTemplate('my-api', 'web-api', { stateFile });
      expect(result.success).toBe(true);
      expect(result.service).toBe('my-api');
      expect(result.template).toBe('web-api');
      expect(result.slos_created).toBe(3);
    });

    it('applies batch-processing template', () => {
      const result = applyTemplate('batch-svc', 'batch-processing', { stateFile });
      expect(result.success).toBe(true);
      expect(result.slos_created).toBe(3);
    });

    it('fails with unknown template', () => {
      const result = applyTemplate('svc', 'nonexistent', { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown template');
    });
  });

  describe('checkSLOCoverage', () => {
    it('reports missing coverage when no SLOs defined', () => {
      const result = checkSLOCoverage(tmpDir, { stateFile });
      expect(result.success).toBe(true);
      expect(result.defined_slos).toBe(0);
      expect(result.coverage).toBe('missing');
      expect(result.recommendations.length).toBeGreaterThan(0);
    });

    it('detects SLO mentions in architecture.md', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'architecture.md'), '## SLO Targets\nAvailability target: 99.9%', 'utf8');
      const result = checkSLOCoverage(tmpDir, { stateFile });
      expect(result.architecture_mentions_slo).toBe(true);
    });

    it('detects SLO mentions in prd.md', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'prd.md'), '## Requirements\nUptime SLA of 99.9%', 'utf8');
      const result = checkSLOCoverage(tmpDir, { stateFile });
      expect(result.prd_mentions_slo).toBe(true);
    });

    it('reports defined coverage when SLOs exist', () => {
      defineSLO({ name: 'Test', service: 'svc', target: 99 }, { stateFile });
      const result = checkSLOCoverage(tmpDir, { stateFile });
      expect(result.defined_slos).toBe(1);
      expect(result.coverage).toBe('defined');
      expect(result.recommendations).toEqual([]);
    });
  });

  describe('generateReport', () => {
    it('returns empty report when no SLOs defined', () => {
      const result = generateReport({ stateFile });
      expect(result.success).toBe(true);
      expect(result.total_slos).toBe(0);
      expect(result.total_slas).toBe(0);
    });

    it('groups SLOs by service and type', () => {
      defineSLO({ name: 'A1', service: 'api', target: 99, type: 'availability' }, { stateFile });
      defineSLO({ name: 'A2', service: 'api', target: 200, type: 'latency' }, { stateFile });
      defineSLO({ name: 'B1', service: 'batch', target: 99, type: 'availability' }, { stateFile });
      const result = generateReport({ stateFile });
      expect(result.total_slos).toBe(3);
      expect(result.by_service['api']).toHaveLength(2);
      expect(result.by_service['batch']).toHaveLength(1);
      expect(result.by_type['availability']).toBe(2);
      expect(result.by_type['latency']).toBe(1);
    });
  });
});
