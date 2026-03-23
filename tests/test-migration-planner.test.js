/**
 * test-migration-planner.test.js — Tests for Brownfield Migration Planner
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-migration-'));
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
  createMigration,
  advancePhase,
  generateReport,
  MIGRATION_STRATEGIES,
  MIGRATION_PHASES
} = require('../bin/lib/migration-planner.js');

describe('migration-planner', () => {
  let tmpDir;
  let stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'migration-plan.json');
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  describe('MIGRATION_STRATEGIES', () => {
    it('should contain all expected strategies', () => {
      expect(MIGRATION_STRATEGIES).toEqual([
        'strangler-fig', 'big-bang', 'phased-cutover', 'parallel-run', 'feature-flag'
      ]);
    });
  });

  describe('MIGRATION_PHASES', () => {
    it('should contain all expected phases in order', () => {
      expect(MIGRATION_PHASES).toEqual([
        'discovery', 'planning', 'compatibility-layer', 'migration', 'validation', 'cutover', 'cleanup'
      ]);
    });
  });

  describe('defaultState', () => {
    it('should return a valid default state', () => {
      const state = defaultState();
      expect(state.version).toBe('1.0.0');
      expect(state.migrations).toEqual([]);
      expect(state.created_at).toBeDefined();
      expect(state.last_updated).toBeNull();
    });
  });

  describe('loadState', () => {
    it('should return default state when file does not exist', () => {
      const state = loadState(path.join(tmpDir, 'nonexistent.json'));
      expect(state.version).toBe('1.0.0');
      expect(state.migrations).toEqual([]);
    });

    it('should load existing state from disk', () => {
      const data = { version: '1.0.0', migrations: [{ id: 'MIG-001' }], created_at: 'now', last_updated: null };
      fs.writeFileSync(stateFile, JSON.stringify(data));
      const state = loadState(stateFile);
      expect(state.migrations.length).toBe(1);
      expect(state.migrations[0].id).toBe('MIG-001');
    });

    it('should return default state for corrupted JSON', () => {
      fs.writeFileSync(stateFile, '{{invalid');
      const state = loadState(stateFile);
      expect(state.version).toBe('1.0.0');
      expect(state.migrations).toEqual([]);
    });
  });

  describe('saveState', () => {
    it('should persist state to disk', () => {
      const state = defaultState();
      state.migrations.push({ id: 'MIG-001' });
      saveState(state, stateFile);
      const loaded = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      expect(loaded.migrations.length).toBe(1);
      expect(loaded.last_updated).toBeDefined();
    });

    it('should create nested directories if needed', () => {
      const deepPath = path.join(tmpDir, 'a', 'b', 'c', 'state.json');
      saveState(defaultState(), deepPath);
      expect(fs.existsSync(deepPath)).toBe(true);
    });
  });

  describe('createMigration', () => {
    it('should return error when name is missing', () => {
      const result = createMigration({ strategy: 'big-bang' }, { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('name and strategy are required');
    });

    it('should return error when strategy is missing', () => {
      const result = createMigration({ name: 'test' }, { stateFile });
      expect(result.success).toBe(false);
    });

    it('should return error for null input', () => {
      const result = createMigration(null, { stateFile });
      expect(result.success).toBe(false);
    });

    it('should return error for invalid strategy', () => {
      const result = createMigration({ name: 'test', strategy: 'invalid' }, { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid strategy');
    });

    it('should create a migration successfully', () => {
      const result = createMigration({
        name: 'DB Migration',
        strategy: 'strangler-fig',
        source_system: 'MySQL',
        target_system: 'PostgreSQL',
        components: [{ name: 'users-table' }, { name: 'orders-table' }]
      }, { stateFile });
      expect(result.success).toBe(true);
      expect(result.migration.id).toBe('MIG-001');
      expect(result.migration.name).toBe('DB Migration');
      expect(result.migration.strategy).toBe('strangler-fig');
      expect(result.migration.current_phase).toBe('discovery');
      expect(result.migration.components.length).toBe(2);
      expect(result.migration.components[0].status).toBe('pending');
    });

    it('should assign sequential IDs', () => {
      createMigration({ name: 'First', strategy: 'big-bang' }, { stateFile });
      const result = createMigration({ name: 'Second', strategy: 'big-bang' }, { stateFile });
      expect(result.migration.id).toBe('MIG-002');
    });

    it('should accept string components', () => {
      const result = createMigration({
        name: 'test',
        strategy: 'phased-cutover',
        components: ['auth', 'payments']
      }, { stateFile });
      expect(result.success).toBe(true);
      expect(result.migration.components[0].name).toBe('auth');
      expect(result.migration.components[1].name).toBe('payments');
    });
  });

  describe('advancePhase', () => {
    it('should return error for invalid phase', () => {
      const result = advancePhase('MIG-001', 'invalid-phase', { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid phase');
    });

    it('should return error for non-existent migration', () => {
      const result = advancePhase('MIG-999', 'planning', { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Migration not found');
    });

    it('should advance the phase successfully', () => {
      createMigration({ name: 'test', strategy: 'big-bang' }, { stateFile });
      const result = advancePhase('MIG-001', 'planning', { stateFile });
      expect(result.success).toBe(true);
      expect(result.phase).toBe('planning');
      expect(result.migration_id).toBe('MIG-001');
    });

    it('should persist the phase change to disk', () => {
      createMigration({ name: 'test', strategy: 'big-bang' }, { stateFile });
      advancePhase('MIG-001', 'migration', { stateFile });
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      expect(state.migrations[0].current_phase).toBe('migration');
    });
  });

  describe('generateReport', () => {
    it('should return empty report when no migrations exist', () => {
      const result = generateReport({ stateFile });
      expect(result.success).toBe(true);
      expect(result.total_migrations).toBe(0);
      expect(result.by_strategy).toEqual({});
      expect(result.by_phase).toEqual({});
    });

    it('should report counts by strategy and phase', () => {
      createMigration({ name: 'A', strategy: 'big-bang' }, { stateFile });
      createMigration({ name: 'B', strategy: 'big-bang' }, { stateFile });
      createMigration({ name: 'C', strategy: 'strangler-fig' }, { stateFile });
      advancePhase('MIG-001', 'planning', { stateFile });
      const result = generateReport({ stateFile });
      expect(result.success).toBe(true);
      expect(result.total_migrations).toBe(3);
      expect(result.by_strategy['big-bang']).toBe(2);
      expect(result.by_strategy['strangler-fig']).toBe(1);
      expect(result.by_phase.planning).toBe(1);
      expect(result.by_phase.discovery).toBe(2);
    });
  });
});
