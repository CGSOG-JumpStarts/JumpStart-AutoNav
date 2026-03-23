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
  loadConfig,
  saveConfig,
  routeTask,
  configureRoute,
  generateReport,
  TASK_TYPES,
  DEFAULT_ROUTING
} = require('../bin/lib/model-router.js');

describe('model-router', () => {
  let tmpDir;
  let configFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    configFile = path.join(tmpDir, '.jumpstart', 'model-routing.json');
  });
  afterEach(() => cleanup(tmpDir));

  describe('constants', () => {
    it('has task types', () => {
      expect(TASK_TYPES).toContain('coding');
      expect(TASK_TYPES).toContain('review');
    });
    it('has default routing', () => {
      expect(DEFAULT_ROUTING.coding.model).toBe('claude-3-sonnet');
    });
  });

  describe('loadConfig / saveConfig', () => {
    it('returns defaults when missing', () => {
      const c = loadConfig(path.join(tmpDir, 'nope.json'));
      expect(c.routing.coding.model).toBe('claude-3-sonnet');
    });
    it('round-trips', () => {
      const c = { routing: { ...DEFAULT_ROUTING, coding: { model: 'gpt-4o', reason: 'test' } } };
      saveConfig(c, configFile);
      const loaded = loadConfig(configFile);
      expect(loaded.routing.coding.model).toBe('gpt-4o');
    });
  });

  describe('routeTask', () => {
    it('fails for invalid task type', () => {
      const r = routeTask('bogus');
      expect(r.success).toBe(false);
    });
    it('routes with defaults', () => {
      const r = routeTask('coding', { configFile });
      expect(r.success).toBe(true);
      expect(r.model).toBe('claude-3-sonnet');
    });
    it('uses custom config', () => {
      saveConfig({ routing: { ...DEFAULT_ROUTING, coding: { model: 'gpt-4o', reason: 'custom' } } }, configFile);
      const r = routeTask('coding', { configFile });
      expect(r.success).toBe(true);
      expect(r.model).toBe('gpt-4o');
    });
  });

  describe('configureRoute', () => {
    it('fails for invalid task type', () => {
      expect(configureRoute('bogus', 'gpt-4o').success).toBe(false);
    });
    it('configures a route', () => {
      const r = configureRoute('review', 'gpt-4o', { configFile, reason: 'better reviews' });
      expect(r.success).toBe(true);
      expect(r.model).toBe('gpt-4o');
      const loaded = loadConfig(configFile);
      expect(loaded.routing.review.model).toBe('gpt-4o');
    });
  });

  describe('generateReport', () => {
    it('returns report with defaults', () => {
      const r = generateReport({ configFile });
      expect(r.success).toBe(true);
      expect(r.task_types).toBe(TASK_TYPES.length);
      expect(r.unique_models).toBeGreaterThan(0);
    });
  });
});
