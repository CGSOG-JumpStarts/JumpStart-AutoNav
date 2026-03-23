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
  planMigration,
  validateMigration,
  generateReport,
  MIGRATION_TYPES,
  RISK_LEVELS
} = require('../bin/lib/db-evolution.js');

describe('db-evolution', () => {
  let tmpDir;
  let stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'db-evolution.json');
  });
  afterEach(() => cleanup(tmpDir));

  describe('constants', () => {
    it('has migration types', () => {
      expect(MIGRATION_TYPES).toContain('add-column');
      expect(MIGRATION_TYPES).toContain('drop-table');
    });
    it('has risk levels', () => {
      expect(RISK_LEVELS['add-column']).toBe('low');
      expect(RISK_LEVELS['drop-table']).toBe('high');
    });
  });

  describe('defaultState', () => {
    it('returns fresh state', () => {
      const s = defaultState();
      expect(s.migrations).toEqual([]);
      expect(s.rollback_scripts).toEqual([]);
    });
  });

  describe('loadState / saveState', () => {
    it('returns default when missing', () => {
      const s = loadState(path.join(tmpDir, 'nope.json'));
      expect(s.version).toBe('1.0.0');
    });
    it('round-trips', () => {
      const s = defaultState();
      s.migrations.push({ id: 'DB-001' });
      saveState(s, stateFile);
      expect(loadState(stateFile).migrations).toHaveLength(1);
    });
  });

  describe('planMigration', () => {
    it('fails without name/type', () => {
      expect(planMigration(null)).toEqual({ success: false, error: 'name and type are required' });
    });
    it('fails for invalid type', () => {
      const r = planMigration({ name: 'x', type: 'bogus' }, { stateFile });
      expect(r.success).toBe(false);
      expect(r.error).toContain('Invalid type');
    });
    it('plans a valid migration', () => {
      const r = planMigration({ name: 'add-email', type: 'add-column', table: 'users' }, { stateFile });
      expect(r.success).toBe(true);
      expect(r.migration.risk_level).toBe('low');
      expect(r.migration.id).toBe('DB-001');
    });
    it('assigns high risk to drop-table', () => {
      const r = planMigration({ name: 'rm-old', type: 'drop-table' }, { stateFile });
      expect(r.migration.risk_level).toBe('high');
    });
  });

  describe('validateMigration', () => {
    it('fails for missing migration', () => {
      const r = validateMigration('DB-999', { stateFile });
      expect(r.success).toBe(false);
    });
    it('validates a safe migration', () => {
      planMigration({ name: 'add-col', type: 'add-column' }, { stateFile });
      const r = validateMigration('DB-001', { stateFile });
      expect(r.success).toBe(true);
      expect(r.safe).toBe(true);
    });
    it('warns on high-risk destructive migration', () => {
      planMigration({ name: 'drop', type: 'drop-table', backward_compatible: false }, { stateFile });
      const r = validateMigration('DB-001', { stateFile });
      expect(r.warnings.length).toBeGreaterThan(0);
      expect(r.safe).toBe(false);
    });
  });

  describe('generateReport', () => {
    it('empty report', () => {
      const r = generateReport({ stateFile });
      expect(r.success).toBe(true);
      expect(r.total_migrations).toBe(0);
    });
    it('report after migrations', () => {
      planMigration({ name: 'a', type: 'add-column' }, { stateFile });
      planMigration({ name: 'b', type: 'drop-table' }, { stateFile });
      const r = generateReport({ stateFile });
      expect(r.total_migrations).toBe(2);
      expect(r.high_risk).toHaveLength(1);
    });
  });
});
