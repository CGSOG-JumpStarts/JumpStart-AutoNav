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
  saveCheckpoint,
  restoreCheckpoint,
  listCheckpoints,
  cleanCheckpoints,
  CHECKPOINT_TYPES
} = require('../bin/lib/agent-checkpoint.js');

describe('agent-checkpoint', () => {
  let tmpDir;
  let stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'agent-checkpoints.json');
  });
  afterEach(() => { cleanup(tmpDir); });

  describe('CHECKPOINT_TYPES', () => {
    it('should be an array of known types', () => {
      expect(Array.isArray(CHECKPOINT_TYPES)).toBe(true);
      expect(CHECKPOINT_TYPES).toContain('manual');
      expect(CHECKPOINT_TYPES).toContain('phase-start');
    });
  });

  describe('defaultState', () => {
    it('should return a valid state object', () => {
      const state = defaultState();
      expect(state.version).toBe('1.0.0');
      expect(state.checkpoints).toEqual([]);
      expect(state.recovery_log).toEqual([]);
    });
  });

  describe('loadState / saveState', () => {
    it('should return default state when file missing', () => {
      const state = loadState(stateFile);
      expect(state.version).toBe('1.0.0');
    });
    it('should save and load state roundtrip', () => {
      const state = defaultState();
      state.checkpoints.push({ id: 'CP-TEST', agent: 'dev' });
      saveState(state, stateFile);
      const loaded = loadState(stateFile);
      expect(loaded.checkpoints).toHaveLength(1);
      expect(loaded.last_updated).toBeTruthy();
    });
  });

  describe('saveCheckpoint', () => {
    it('should fail without agent', () => {
      const result = saveCheckpoint({}, { stateFile });
      expect(result.success).toBe(false);
    });
    it('should save a checkpoint', () => {
      const result = saveCheckpoint({ agent: 'developer', phase: 4, context: { step: 1 } }, { stateFile });
      expect(result.success).toBe(true);
      expect(result.checkpoint.agent).toBe('developer');
      expect(result.checkpoint.id).toMatch(/^CP-/);
    });
    it('should limit to 50 checkpoints', () => {
      for (let i = 0; i < 55; i++) {
        saveCheckpoint({ agent: 'dev', context: { i } }, { stateFile });
      }
      const state = loadState(stateFile);
      expect(state.checkpoints.length).toBeLessThanOrEqual(50);
    });
  });

  describe('restoreCheckpoint', () => {
    it('should restore latest checkpoint when no ID given', () => {
      saveCheckpoint({ agent: 'dev', context: { step: 1 } }, { stateFile });
      saveCheckpoint({ agent: 'dev', context: { step: 2 } }, { stateFile });
      const result = restoreCheckpoint(undefined, { stateFile });
      expect(result.success).toBe(true);
      expect(result.context.step).toBe(2);
    });
    it('should return error when no checkpoints exist', () => {
      const result = restoreCheckpoint(undefined, { stateFile });
      expect(result.success).toBe(false);
    });
    it('should restore by specific ID', () => {
      const { checkpoint } = saveCheckpoint({ agent: 'dev', context: { x: 1 } }, { stateFile });
      saveCheckpoint({ agent: 'dev', context: { x: 2 } }, { stateFile });
      const result = restoreCheckpoint(checkpoint.id, { stateFile });
      expect(result.success).toBe(true);
      expect(result.context.x).toBe(1);
    });
  });

  describe('listCheckpoints', () => {
    it('should list all checkpoints', () => {
      saveCheckpoint({ agent: 'dev' }, { stateFile });
      saveCheckpoint({ agent: 'arch' }, { stateFile });
      const result = listCheckpoints({}, { stateFile });
      expect(result.total).toBe(2);
    });
    it('should filter by agent', () => {
      saveCheckpoint({ agent: 'dev' }, { stateFile });
      saveCheckpoint({ agent: 'arch' }, { stateFile });
      const result = listCheckpoints({ agent: 'dev' }, { stateFile });
      expect(result.total).toBe(1);
    });
  });

  describe('cleanCheckpoints', () => {
    it('should keep only specified number', () => {
      for (let i = 0; i < 15; i++) {
        saveCheckpoint({ agent: 'dev' }, { stateFile });
      }
      const result = cleanCheckpoints({ stateFile, keep: 5 });
      expect(result.success).toBe(true);
      expect(result.remaining).toBe(5);
      expect(result.removed).toBe(10);
    });
    it('should default to keeping 10', () => {
      for (let i = 0; i < 15; i++) {
        saveCheckpoint({ agent: 'dev' }, { stateFile });
      }
      const result = cleanCheckpoints({ stateFile });
      expect(result.remaining).toBe(10);
    });
  });
});
