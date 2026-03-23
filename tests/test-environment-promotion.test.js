/**
 * test-environment-promotion.test.js — Tests for Environment Promotion Governance
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-envpromo-'));
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
  checkGates,
  recordGateResult,
  promote,
  getStatus,
  ENVIRONMENTS,
  DEFAULT_GATES
} = require('../bin/lib/environment-promotion');

describe('environment-promotion', () => {
  let tmpDir;
  let stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'environment-promotion.json');
  });

  afterEach(() => cleanup(tmpDir));

  describe('constants', () => {
    it('exports environment list', () => {
      expect(ENVIRONMENTS).toEqual(['dev', 'test', 'staging', 'prod']);
    });

    it('exports default gates for each environment', () => {
      for (const env of ENVIRONMENTS) {
        expect(DEFAULT_GATES[env]).toBeDefined();
        expect(Array.isArray(DEFAULT_GATES[env])).toBe(true);
      }
    });
  });

  describe('defaultState', () => {
    it('returns a fresh state with dev as active', () => {
      const state = defaultState();
      expect(state.version).toBe('1.0.0');
      expect(state.current_environment).toBe('dev');
      expect(state.environments).toHaveLength(4);
      expect(state.environments[0].status).toBe('active');
      expect(state.environments[1].status).toBe('pending');
    });

    it('includes gates for each environment', () => {
      const state = defaultState();
      for (const env of state.environments) {
        expect(env.gates.length).toBe(DEFAULT_GATES[env.name].length);
        for (const gate of env.gates) {
          expect(gate.passed).toBe(false);
          expect(gate.checked_at).toBeNull();
        }
      }
    });
  });

  describe('loadState / saveState', () => {
    it('returns default state when file does not exist', () => {
      const state = loadState(stateFile);
      expect(state.current_environment).toBe('dev');
    });

    it('round-trips state through save and load', () => {
      const state = defaultState();
      state.current_environment = 'test';
      saveState(state, stateFile);

      const loaded = loadState(stateFile);
      expect(loaded.current_environment).toBe('test');
      expect(loaded.last_updated).toBeTruthy();
    });

    it('returns default state for corrupt JSON', () => {
      fs.writeFileSync(stateFile, '{bad', 'utf8');
      const state = loadState(stateFile);
      expect(state.version).toBe('1.0.0');
    });
  });

  describe('checkGates', () => {
    it('returns all gates as pending for fresh state', () => {
      saveState(defaultState(), stateFile);
      const result = checkGates('dev', { stateFile });
      expect(result.success).toBe(true);
      expect(result.all_passed).toBe(false);
      expect(result.pending.length).toBeGreaterThan(0);
      expect(result.ready_to_promote).toBe(false);
    });

    it('returns error for invalid environment', () => {
      const result = checkGates('invalid-env', { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid environment');
    });

    it('reflects passed gates', () => {
      const state = defaultState();
      for (const gate of state.environments[0].gates) {
        gate.passed = true;
      }
      saveState(state, stateFile);

      const result = checkGates('dev', { stateFile });
      expect(result.all_passed).toBe(true);
      expect(result.ready_to_promote).toBe(true);
      expect(result.pending).toHaveLength(0);
    });
  });

  describe('recordGateResult', () => {
    it('records a passing gate result', () => {
      saveState(defaultState(), stateFile);
      const result = recordGateResult('dev', 'unit-tests', true, { stateFile });
      expect(result.success).toBe(true);
      expect(result.gate).toBe('unit-tests');
      expect(result.passed).toBe(true);
    });

    it('returns error for invalid environment', () => {
      const result = recordGateResult('bogus', 'unit-tests', true, { stateFile });
      expect(result.success).toBe(false);
    });

    it('returns error for unknown gate name', () => {
      saveState(defaultState(), stateFile);
      const result = recordGateResult('dev', 'nonexistent-gate', true, { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Gate not found');
    });

    it('persists gate result to disk', () => {
      saveState(defaultState(), stateFile);
      recordGateResult('dev', 'lint', true, { stateFile });
      const loaded = loadState(stateFile);
      const devEnv = loaded.environments.find(e => e.name === 'dev');
      const lintGate = devEnv.gates.find(g => g.name === 'lint');
      expect(lintGate.passed).toBe(true);
      expect(lintGate.checked_at).toBeTruthy();
    });
  });

  describe('promote', () => {
    it('promotes from dev to test when all dev gates pass', () => {
      const state = defaultState();
      for (const gate of state.environments[0].gates) gate.passed = true;
      saveState(state, stateFile);

      const result = promote('test', { stateFile });
      expect(result.success).toBe(true);
      expect(result.from).toBe('dev');
      expect(result.to).toBe('test');
    });

    it('fails when dev gates are not passed', () => {
      saveState(defaultState(), stateFile);
      const result = promote('test', { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Gates not passed');
    });

    it('fails for backward promotion', () => {
      const state = defaultState();
      state.current_environment = 'staging';
      saveState(state, stateFile);

      const result = promote('dev', { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot promote backward');
    });

    it('returns error for invalid target environment', () => {
      const result = promote('nonexistent', { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid environment');
    });

    it('records promotion history', () => {
      const state = defaultState();
      for (const gate of state.environments[0].gates) gate.passed = true;
      saveState(state, stateFile);

      promote('test', { stateFile, promotedBy: 'user@example.com' });
      const loaded = loadState(stateFile);
      expect(loaded.promotion_history).toHaveLength(1);
      expect(loaded.promotion_history[0].from).toBe('dev');
      expect(loaded.promotion_history[0].to).toBe('test');
      expect(loaded.promotion_history[0].promoted_by).toBe('user@example.com');
    });
  });

  describe('getStatus', () => {
    it('returns status from fresh state', () => {
      const result = getStatus({ stateFile });
      expect(result.success).toBe(true);
      expect(result.current_environment).toBe('dev');
      expect(result.environments).toHaveLength(4);
      expect(result.promotion_history).toEqual([]);
    });

    it('reports gate pass counts per environment', () => {
      const state = defaultState();
      state.environments[0].gates[0].passed = true;
      saveState(state, stateFile);

      const result = getStatus({ stateFile });
      const dev = result.environments.find(e => e.name === 'dev');
      expect(dev.gates_passed).toBe(1);
      expect(dev.gates_total).toBe(DEFAULT_GATES.dev.length);
    });
  });
});
