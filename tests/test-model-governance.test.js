/**
 * test-model-governance.test.js — Tests for Model Governance Workflows
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-modelgov-'));
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
  registerModel,
  recordEvaluation,
  updateStatus,
  generateReport,
  MODEL_RISK_LEVELS,
  MODEL_STATUSES
} = require('../bin/lib/model-governance.js');

describe('model-governance', () => {
  let tmpDir;
  let stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'model-governance.json');
  });

  afterEach(() => cleanup(tmpDir));

  describe('constants', () => {
    it('MODEL_RISK_LEVELS contains expected levels', () => {
      expect(MODEL_RISK_LEVELS).toEqual(['low', 'medium', 'high', 'critical']);
    });

    it('MODEL_STATUSES contains expected statuses', () => {
      expect(MODEL_STATUSES).toContain('proposed');
      expect(MODEL_STATUSES).toContain('approved');
      expect(MODEL_STATUSES).toContain('deployed');
      expect(MODEL_STATUSES).toContain('deprecated');
      expect(MODEL_STATUSES).toContain('retired');
    });
  });

  describe('defaultState', () => {
    it('returns a valid default state', () => {
      const state = defaultState();
      expect(state.version).toBe('1.0.0');
      expect(state.models).toEqual([]);
      expect(state.evaluations).toEqual([]);
      expect(state.safety_controls).toEqual([]);
    });
  });

  describe('loadState / saveState', () => {
    it('returns default state when file does not exist', () => {
      const state = loadState(stateFile);
      expect(state.models).toEqual([]);
    });

    it('round-trips state correctly', () => {
      const state = defaultState();
      state.models.push({ id: 'MDL-001', name: 'gpt-4' });
      saveState(state, stateFile);
      const loaded = loadState(stateFile);
      expect(loaded.models).toHaveLength(1);
      expect(loaded.last_updated).toBeTruthy();
    });

    it('returns default state on corrupt JSON', () => {
      fs.writeFileSync(stateFile, 'bad', 'utf8');
      const state = loadState(stateFile);
      expect(state.models).toEqual([]);
    });
  });

  describe('registerModel', () => {
    it('registers a valid model', () => {
      const result = registerModel(
        { name: 'GPT-4', provider: 'OpenAI', use_case: 'Code generation' },
        { stateFile }
      );
      expect(result.success).toBe(true);
      expect(result.model.id).toBe('MDL-001');
      expect(result.model.name).toBe('GPT-4');
      expect(result.model.provider).toBe('OpenAI');
      expect(result.model.status).toBe('proposed');
      expect(result.model.risk_level).toBe('medium');
    });

    it('fails when required fields are missing', () => {
      const result = registerModel({}, { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });

    it('fails with null input', () => {
      const result = registerModel(null, { stateFile });
      expect(result.success).toBe(false);
    });

    it('rejects invalid risk level', () => {
      const result = registerModel(
        { name: 'Test', provider: 'P', risk_level: 'extreme' },
        { stateFile }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid risk level');
    });

    it('uses default values for optional fields', () => {
      const result = registerModel(
        { name: 'Model', provider: 'Provider' },
        { stateFile }
      );
      expect(result.success).toBe(true);
      expect(result.model.version).toBe('latest');
      expect(result.model.fallback).toBeNull();
      expect(result.model.safety_controls).toEqual([]);
    });
  });

  describe('recordEvaluation', () => {
    it('records an evaluation for an existing model', () => {
      registerModel({ name: 'GPT-4', provider: 'OpenAI' }, { stateFile });
      const result = recordEvaluation(
        'MDL-001',
        { metrics: { accuracy: 0.95 }, notes: 'Good performance', evaluator: 'team-a' },
        { stateFile }
      );
      expect(result.success).toBe(true);
      expect(result.evaluation.model_id).toBe('MDL-001');
      expect(result.evaluation.metrics.accuracy).toBe(0.95);
      expect(result.evaluation.id).toMatch(/^EVAL-/);
    });

    it('fails when model not found', () => {
      const result = recordEvaluation('MDL-999', { metrics: {} }, { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('handles evaluation with minimal data', () => {
      registerModel({ name: 'M', provider: 'P' }, { stateFile });
      const result = recordEvaluation('MDL-001', {}, { stateFile });
      expect(result.success).toBe(true);
      expect(result.evaluation.metrics).toEqual({});
      expect(result.evaluation.notes).toBe('');
    });
  });

  describe('updateStatus', () => {
    it('updates model status', () => {
      registerModel({ name: 'GPT-4', provider: 'OpenAI' }, { stateFile });
      const result = updateStatus('MDL-001', 'approved', { stateFile });
      expect(result.success).toBe(true);
      expect(result.model.status).toBe('approved');
    });

    it('rejects invalid status', () => {
      const result = updateStatus('MDL-001', 'invalid-status', { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid status');
    });

    it('fails when model not found', () => {
      const result = updateStatus('MDL-999', 'approved', { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('generateReport', () => {
    it('returns empty report when no models', () => {
      const result = generateReport({ stateFile });
      expect(result.success).toBe(true);
      expect(result.total_models).toBe(0);
      expect(result.total_evaluations).toBe(0);
    });

    it('groups models by status and risk', () => {
      registerModel({ name: 'A', provider: 'P1', risk_level: 'high' }, { stateFile });
      registerModel({ name: 'B', provider: 'P2', risk_level: 'low' }, { stateFile });
      updateStatus('MDL-001', 'approved', { stateFile });
      const result = generateReport({ stateFile });
      expect(result.total_models).toBe(2);
      expect(result.by_risk['high']).toBe(1);
      expect(result.by_risk['low']).toBe(1);
      expect(result.by_status['approved']).toBe(1);
      expect(result.by_status['proposed']).toBe(1);
      expect(result.high_risk_models).toHaveLength(1);
    });

    it('identifies models without fallback', () => {
      registerModel({ name: 'A', provider: 'P' }, { stateFile });
      registerModel({ name: 'B', provider: 'P', fallback: 'A' }, { stateFile });
      const result = generateReport({ stateFile });
      expect(result.models_without_fallback).toHaveLength(1);
    });
  });
});
