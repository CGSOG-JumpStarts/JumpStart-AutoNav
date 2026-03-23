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
  routeByCost,
  recordSpending,
  generateReport,
  MODEL_COSTS,
  BUDGET_PROFILES
} = require('../bin/lib/cost-router.js');

describe('cost-router', () => {
  let tmpDir;
  let configFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    configFile = path.join(tmpDir, '.jumpstart', 'cost-routing.json');
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  describe('MODEL_COSTS', () => {
    it('should contain known models', () => {
      expect(MODEL_COSTS).toHaveProperty('gpt-4o');
      expect(MODEL_COSTS).toHaveProperty('claude-3-haiku');
    });

    it('should have input and output costs for each model', () => {
      for (const [, costs] of Object.entries(MODEL_COSTS)) {
        expect(costs).toHaveProperty('input_per_1k');
        expect(costs).toHaveProperty('output_per_1k');
        expect(costs).toHaveProperty('quality');
        expect(costs).toHaveProperty('speed');
      }
    });
  });

  describe('BUDGET_PROFILES', () => {
    it('should contain economy, balanced, and premium profiles', () => {
      expect(BUDGET_PROFILES).toHaveProperty('economy');
      expect(BUDGET_PROFILES).toHaveProperty('balanced');
      expect(BUDGET_PROFILES).toHaveProperty('premium');
    });
  });

  describe('loadConfig', () => {
    it('should return default config when file does not exist', () => {
      const config = loadConfig(path.join(tmpDir, 'nonexistent.json'));
      expect(config.budget_profile).toBe('balanced');
      expect(config.spending).toEqual([]);
    });

    it('should load existing config', () => {
      const data = { budget_profile: 'economy', spending: [{ model: 'gpt-4o', cost: 0.02 }] };
      fs.writeFileSync(configFile, JSON.stringify(data), 'utf8');
      const config = loadConfig(configFile);
      expect(config.budget_profile).toBe('economy');
      expect(config.spending).toHaveLength(1);
    });

    it('should return default config for invalid JSON', () => {
      fs.writeFileSync(configFile, 'not json', 'utf8');
      const config = loadConfig(configFile);
      expect(config.budget_profile).toBe('balanced');
    });
  });

  describe('saveConfig', () => {
    it('should write config to file', () => {
      const data = { budget_profile: 'premium', spending: [] };
      saveConfig(data, configFile);
      const loaded = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      expect(loaded.budget_profile).toBe('premium');
    });

    it('should create directories if needed', () => {
      const deepPath = path.join(tmpDir, 'a', 'b', 'config.json');
      saveConfig({ budget_profile: 'economy', spending: [] }, deepPath);
      expect(fs.existsSync(deepPath)).toBe(true);
    });
  });

  describe('routeByCost', () => {
    it('should select a model for a task', () => {
      saveConfig({ budget_profile: 'balanced', spending: [] }, configFile);
      const result = routeByCost({ type: 'code-gen', estimated_tokens: 1000 }, { configFile });
      expect(result.success).toBe(true);
      expect(result.selected_model).toBeTruthy();
      expect(result.budget_profile).toBe('balanced');
    });

    it('should respect min_quality from task', () => {
      saveConfig({ budget_profile: 'balanced', spending: [] }, configFile);
      const result = routeByCost({ type: 'code-gen', min_quality: 90 }, { configFile });
      expect(result.success).toBe(true);
      expect(result.quality).toBeGreaterThanOrEqual(90);
    });

    it('should prefer cheapest for economy profile', () => {
      saveConfig({ budget_profile: 'economy', spending: [] }, configFile);
      const result = routeByCost({ type: 'code-gen', estimated_tokens: 1000 }, { configFile });
      expect(result.success).toBe(true);
      expect(result.estimated_cost).toBeDefined();
    });
  });

  describe('recordSpending', () => {
    it('should record spending for a known model', () => {
      saveConfig({ budget_profile: 'balanced', spending: [] }, configFile);
      const result = recordSpending('gpt-4o', 500, { configFile });
      expect(result.success).toBe(true);
      expect(result.model).toBe('gpt-4o');
      expect(result.cost).toBeGreaterThan(0);
    });

    it('should return error for unknown model', () => {
      const result = recordSpending('unknown-model', 500, { configFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown model');
    });

    it('should persist spending to config file', () => {
      saveConfig({ budget_profile: 'balanced', spending: [] }, configFile);
      recordSpending('gpt-4o', 1000, { configFile });
      const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      expect(config.spending).toHaveLength(1);
    });
  });

  describe('generateReport', () => {
    it('should generate report with no spending', () => {
      saveConfig({ budget_profile: 'balanced', spending: [] }, configFile);
      const result = generateReport({ configFile });
      expect(result.success).toBe(true);
      expect(result.total_cost).toBe(0);
      expect(result.total_requests).toBe(0);
    });

    it('should report spending by model', () => {
      saveConfig({
        budget_profile: 'balanced',
        spending: [
          { model: 'gpt-4o', tokens: 1000, cost: 0.02 },
          { model: 'gpt-4o', tokens: 500, cost: 0.01 }
        ]
      }, configFile);
      const result = generateReport({ configFile });
      expect(result.success).toBe(true);
      expect(result.total_requests).toBe(2);
      expect(result.by_model['gpt-4o']).toBe(0.03);
    });
  });
});
