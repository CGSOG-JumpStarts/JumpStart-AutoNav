/**
 * test-ci-cd-integration.test.js — Tests for CI/CD Integration
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-cicd-'));
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
  generatePipeline,
  validatePipeline,
  getStatus,
  SUPPORTED_PLATFORMS,
  PIPELINE_STAGES,
  BUILT_IN_CHECKS
} = require('../bin/lib/ci-cd-integration');

describe('ci-cd-integration', () => {
  let tmpDir;
  let stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'ci-cd-integration.json');
  });

  afterEach(() => cleanup(tmpDir));

  describe('constants', () => {
    it('exports supported platforms', () => {
      expect(SUPPORTED_PLATFORMS).toContain('github-actions');
      expect(SUPPORTED_PLATFORMS).toContain('azure-devops');
    });

    it('exports pipeline stages', () => {
      expect(PIPELINE_STAGES).toEqual(['validate', 'drift-check', 'review', 'approve', 'promote']);
    });

    it('exports built-in checks with required fields', () => {
      expect(BUILT_IN_CHECKS.length).toBeGreaterThan(0);
      for (const check of BUILT_IN_CHECKS) {
        expect(check).toHaveProperty('id');
        expect(check).toHaveProperty('name');
        expect(check).toHaveProperty('stage');
        expect(check).toHaveProperty('command');
      }
    });
  });

  describe('defaultState', () => {
    it('returns a fresh state object', () => {
      const state = defaultState();
      expect(state.version).toBe('1.0.0');
      expect(state.platform).toBeNull();
      expect(state.pipelines).toEqual([]);
      expect(state.run_history).toEqual([]);
    });

    it('sets created_at to a valid ISO timestamp', () => {
      const state = defaultState();
      expect(new Date(state.created_at).toISOString()).toBe(state.created_at);
    });
  });

  describe('loadState / saveState', () => {
    it('returns default state when file does not exist', () => {
      const state = loadState(stateFile);
      expect(state.version).toBe('1.0.0');
      expect(state.pipelines).toEqual([]);
    });

    it('round-trips state through save and load', () => {
      const state = defaultState();
      state.platform = 'github-actions';
      state.pipelines.push({ name: 'test-pipeline' });
      saveState(state, stateFile);

      const loaded = loadState(stateFile);
      expect(loaded.platform).toBe('github-actions');
      expect(loaded.pipelines).toHaveLength(1);
      expect(loaded.last_updated).toBeTruthy();
    });

    it('returns default state when file contains invalid JSON', () => {
      fs.writeFileSync(stateFile, 'not-json', 'utf8');
      const state = loadState(stateFile);
      expect(state.version).toBe('1.0.0');
    });
  });

  describe('generatePipeline', () => {
    it('generates a GitHub Actions workflow', () => {
      const result = generatePipeline('github-actions');
      expect(result.success).toBe(true);
      expect(result.platform).toBe('github-actions');
      expect(result.format).toBe('yaml');
      expect(result.content.name).toBe('JumpStart Quality Gate');
      expect(result.path).toBe('.github/workflows/jumpstart-quality.yml');
    });

    it('generates an Azure DevOps pipeline', () => {
      const result = generatePipeline('azure-devops');
      expect(result.success).toBe(true);
      expect(result.platform).toBe('azure-devops');
      expect(result.content.trigger).toBeDefined();
      expect(result.path).toBe('azure-pipelines.yml');
    });

    it('returns error for unsupported platform', () => {
      const result = generatePipeline('jenkins');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported platform');
    });

    it('accepts custom checks and stages', () => {
      const customChecks = [{ id: 'custom', name: 'Custom', stage: 'validate', command: 'echo ok' }];
      const result = generatePipeline('github-actions', { checks: customChecks, stages: ['validate'] });
      expect(result.success).toBe(true);
      expect(result.content.jobs.validate).toBeDefined();
    });
  });

  describe('validatePipeline', () => {
    it('reports missing pipeline files', () => {
      const result = validatePipeline(tmpDir);
      expect(result.success).toBe(true);
      expect(result.all_configured).toBe(false);
      expect(result.recommendations.length).toBeGreaterThan(0);
    });

    it('reports existing pipeline as configured', () => {
      const ghDir = path.join(tmpDir, '.github', 'workflows');
      fs.mkdirSync(ghDir, { recursive: true });
      fs.writeFileSync(path.join(ghDir, 'jumpstart-quality.yml'), 'name: test', 'utf8');

      const result = validatePipeline(tmpDir);
      expect(result.success).toBe(true);
      expect(result.all_configured).toBe(true);
      expect(result.pipelines.some(p => p.exists)).toBe(true);
    });

    it('includes expected_checks count', () => {
      const result = validatePipeline(tmpDir);
      for (const p of result.pipelines) {
        expect(p.expected_checks).toBe(BUILT_IN_CHECKS.length);
      }
    });
  });

  describe('getStatus', () => {
    it('returns status from fresh state', () => {
      const result = getStatus({ stateFile });
      expect(result.success).toBe(true);
      expect(result.pipelines).toBe(0);
      expect(result.total_runs).toBe(0);
      expect(result.last_run).toBeNull();
      expect(result.available_checks).toBe(BUILT_IN_CHECKS.length);
    });

    it('reflects saved state with run history', () => {
      const state = defaultState();
      state.platform = 'github-actions';
      state.pipelines = [{ name: 'p1' }];
      state.run_history = [{ id: 'run-1', status: 'success' }];
      saveState(state, stateFile);

      const result = getStatus({ stateFile });
      expect(result.platform).toBe('github-actions');
      expect(result.pipelines).toBe(1);
      expect(result.total_runs).toBe(1);
      expect(result.last_run.id).toBe('run-1');
    });
  });
});
