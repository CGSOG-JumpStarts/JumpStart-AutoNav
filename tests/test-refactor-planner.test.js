/**
 * test-refactor-planner.test.js — Tests for Refactor Planner with Dependency Safety
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-refactor-'));
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
  createPlan,
  validatePlan,
  generateReport,
  REFACTOR_TYPES,
  RISK_LEVELS
} = require('../bin/lib/refactor-planner.js');

describe('refactor-planner', () => {
  let tmpDir;
  let stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'refactor-plan.json');
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  describe('REFACTOR_TYPES', () => {
    it('should contain all expected refactor types', () => {
      expect(REFACTOR_TYPES).toEqual(['rename', 'move', 'extract', 'inline', 'restructure', 'migrate', 'upgrade']);
    });
  });

  describe('RISK_LEVELS', () => {
    it('should contain all expected risk levels', () => {
      expect(RISK_LEVELS).toEqual(['low', 'medium', 'high', 'critical']);
    });
  });

  describe('defaultState', () => {
    it('should return a valid default state', () => {
      const state = defaultState();
      expect(state.version).toBe('1.0.0');
      expect(state.plans).toEqual([]);
      expect(state.completed).toEqual([]);
      expect(state.created_at).toBeDefined();
      expect(state.last_updated).toBeNull();
    });
  });

  describe('loadState', () => {
    it('should return default state when file does not exist', () => {
      const state = loadState(path.join(tmpDir, 'nonexistent.json'));
      expect(state.version).toBe('1.0.0');
      expect(state.plans).toEqual([]);
    });

    it('should load state from existing file', () => {
      const data = { version: '1.0.0', plans: [{ id: 'REF-001' }], completed: [], created_at: 'now', last_updated: null };
      fs.writeFileSync(stateFile, JSON.stringify(data));
      const state = loadState(stateFile);
      expect(state.plans.length).toBe(1);
      expect(state.plans[0].id).toBe('REF-001');
    });

    it('should return default state for invalid JSON', () => {
      fs.writeFileSync(stateFile, 'not-json');
      const state = loadState(stateFile);
      expect(state.version).toBe('1.0.0');
      expect(state.plans).toEqual([]);
    });
  });

  describe('saveState', () => {
    it('should persist state to disk', () => {
      const state = defaultState();
      state.plans.push({ id: 'REF-001', name: 'test' });
      saveState(state, stateFile);
      const loaded = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      expect(loaded.plans.length).toBe(1);
      expect(loaded.last_updated).toBeDefined();
    });

    it('should create directories if they do not exist', () => {
      const deepPath = path.join(tmpDir, 'deep', 'nested', 'state.json');
      saveState(defaultState(), deepPath);
      expect(fs.existsSync(deepPath)).toBe(true);
    });
  });

  describe('createPlan', () => {
    it('should return error when name is missing', () => {
      const result = createPlan({ type: 'rename' }, { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('name and type are required');
    });

    it('should return error when type is missing', () => {
      const result = createPlan({ name: 'test' }, { stateFile });
      expect(result.success).toBe(false);
    });

    it('should return error for invalid type', () => {
      const result = createPlan({ name: 'test', type: 'invalid' }, { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid type');
    });

    it('should create a plan successfully', () => {
      const result = createPlan({
        name: 'Rename utils',
        type: 'rename',
        description: 'Rename utility module',
        steps: [{ description: 'Update imports', risk: 'low' }],
        affected_files: ['src/utils.js']
      }, { stateFile });
      expect(result.success).toBe(true);
      expect(result.plan.id).toBe('REF-001');
      expect(result.plan.name).toBe('Rename utils');
      expect(result.plan.status).toBe('draft');
      expect(result.plan.steps.length).toBe(1);
    });

    it('should assign sequential IDs', () => {
      createPlan({ name: 'First', type: 'rename' }, { stateFile });
      const result = createPlan({ name: 'Second', type: 'move' }, { stateFile });
      expect(result.success).toBe(true);
      expect(result.plan.id).toBe('REF-002');
    });

    it('should set risk level to critical if any step is critical', () => {
      const result = createPlan({
        name: 'Critical refactor',
        type: 'restructure',
        steps: [{ description: 'Step 1', risk: 'critical' }]
      }, { stateFile });
      expect(result.plan.risk_level).toBe('critical');
    });

    it('should accept string steps', () => {
      const result = createPlan({
        name: 'Simple',
        type: 'rename',
        steps: ['Step one', 'Step two']
      }, { stateFile });
      expect(result.success).toBe(true);
      expect(result.plan.steps[0].description).toBe('Step one');
      expect(result.plan.steps[1].order).toBe(2);
    });
  });

  describe('validatePlan', () => {
    it('should return error for non-existent plan', () => {
      const result = validatePlan('REF-999', { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Plan not found');
    });

    it('should validate a plan with no issues', () => {
      createPlan({
        name: 'Valid',
        type: 'rename',
        steps: [
          { description: 'Step 1', dependencies: [] },
          { description: 'Step 2', dependencies: [1] }
        ]
      }, { stateFile });
      const result = validatePlan('REF-001', { stateFile });
      expect(result.success).toBe(true);
      expect(result.valid).toBe(true);
      expect(result.issues.length).toBe(0);
    });

    it('should detect invalid dependency ordering', () => {
      createPlan({
        name: 'Bad order',
        type: 'rename',
        steps: [
          { description: 'Step 1', dependencies: [2] },
          { description: 'Step 2', dependencies: [] }
        ]
      }, { stateFile });
      const result = validatePlan('REF-001', { stateFile });
      expect(result.success).toBe(true);
      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.type === 'invalid-order')).toBe(true);
    });
  });

  describe('generateReport', () => {
    it('should return empty report when no plans exist', () => {
      const result = generateReport({ stateFile });
      expect(result.success).toBe(true);
      expect(result.total_plans).toBe(0);
      expect(result.completed).toBe(0);
      expect(result.active).toBe(0);
    });

    it('should report plan counts by type', () => {
      createPlan({ name: 'A', type: 'rename' }, { stateFile });
      createPlan({ name: 'B', type: 'rename' }, { stateFile });
      createPlan({ name: 'C', type: 'move' }, { stateFile });
      const result = generateReport({ stateFile });
      expect(result.success).toBe(true);
      expect(result.total_plans).toBe(3);
      expect(result.by_type.rename).toBe(2);
      expect(result.by_type.move).toBe(1);
    });
  });
});
