/**
 * test-fitness-functions.test.js — Tests for Architectural Fitness Functions
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-fitness-'));
  fs.mkdirSync(path.join(tmpDir, '.jumpstart'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  return tmpDir;
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

const {
  defaultRegistry,
  loadRegistry,
  saveRegistry,
  addFitnessFunction,
  evaluateFitness,
  listFitnessFunctions,
  BUILTIN_CHECKS,
  FITNESS_CATEGORIES
} = require('../bin/lib/fitness-functions');

describe('fitness-functions', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  describe('defaultRegistry', () => {
    it('returns valid default structure', () => {
      const r = defaultRegistry();
      expect(r.version).toBe('1.0.0');
      expect(r.functions).toEqual([]);
      expect(r.evaluation_history).toEqual([]);
    });
  });

  describe('FITNESS_CATEGORIES', () => {
    it('includes expected categories', () => {
      expect(FITNESS_CATEGORIES).toContain('dependency');
      expect(FITNESS_CATEGORIES).toContain('structure');
      expect(FITNESS_CATEGORIES).toContain('security');
    });
  });

  describe('BUILTIN_CHECKS', () => {
    it('has max_file_length check', () => {
      const result = BUILTIN_CHECKS.max_file_length('line1\nline2\nline3\n', 5);
      expect(result.passed).toBe(true);
      expect(result.value).toBe(4);
    });

    it('fails max_file_length when exceeded', () => {
      const longContent = Array(600).fill('line').join('\n');
      const result = BUILTIN_CHECKS.max_file_length(longContent, 500);
      expect(result.passed).toBe(false);
    });

    it('has max_function_params check', () => {
      const content = 'function test(a, b, c) {}';
      const result = BUILTIN_CHECKS.max_function_params(content, 5);
      expect(result.passed).toBe(true);
      expect(result.value).toBe(3);
    });

    it('fails max_function_params when exceeded', () => {
      const content = 'function test(a, b, c, d, e, f, g) {}';
      const result = BUILTIN_CHECKS.max_function_params(content, 5);
      expect(result.passed).toBe(false);
    });

    it('has pattern_match check', () => {
      const result = BUILTIN_CHECKS.pattern_match('console.log("test")', null, 'console\\.log');
      expect(result.passed).toBe(false);
      expect(result.value).toBeGreaterThan(0);
    });

    it('pattern_match passes when no match', () => {
      const result = BUILTIN_CHECKS.pattern_match('clean code', null, 'console\\.log');
      expect(result.passed).toBe(true);
    });
  });

  describe('addFitnessFunction', () => {
    it('adds a fitness function', () => {
      const registryFile = path.join(tmpDir, '.jumpstart', 'fitness-functions.json');
      const result = addFitnessFunction({
        name: 'No console.log',
        category: 'structure',
        description: 'Disallow console.log statements',
        check_type: 'pattern',
        pattern: 'console\\.log'
      }, { registryFile });

      expect(result.success).toBe(true);
      expect(result.function.name).toBe('No console.log');
    });

    it('errors without name', () => {
      const result = addFitnessFunction({}, {});
      expect(result.success).toBe(false);
    });

    it('errors with invalid category', () => {
      const result = addFitnessFunction({
        name: 'Test',
        category: 'invalid',
        description: 'Test function'
      }, {});
      expect(result.success).toBe(false);
    });

    it('prevents duplicate IDs', () => {
      const registryFile = path.join(tmpDir, '.jumpstart', 'fitness-functions.json');
      addFitnessFunction({ id: 'test-1', name: 'Test 1', category: 'structure', description: 'Test' }, { registryFile });
      const result = addFitnessFunction({ id: 'test-1', name: 'Test 1 dup', category: 'structure', description: 'Dup' }, { registryFile });
      expect(result.success).toBe(false);
    });
  });

  describe('evaluateFitness', () => {
    it('evaluates with no functions registered', () => {
      const registryFile = path.join(tmpDir, '.jumpstart', 'fitness-functions.json');
      const result = evaluateFitness(tmpDir, { registryFile });
      expect(result.success).toBe(true);
      expect(result.all_passed).toBe(true);
    });

    it('detects violations', () => {
      const registryFile = path.join(tmpDir, '.jumpstart', 'fitness-functions.json');
      addFitnessFunction({
        name: 'No console.log',
        category: 'structure',
        description: 'No console.log',
        check_type: 'pattern',
        pattern: 'console\\.log'
      }, { registryFile });

      // Create a file with console.log
      fs.writeFileSync(path.join(tmpDir, 'src', 'app.js'), 'console.log("debug");\n', 'utf8');

      const result = evaluateFitness(tmpDir, { registryFile });
      expect(result.all_passed).toBe(false);
      expect(result.results[0].violations).toBeGreaterThan(0);
    });

    it('passes when no violations', () => {
      const registryFile = path.join(tmpDir, '.jumpstart', 'fitness-functions.json');
      addFitnessFunction({
        name: 'No console.log',
        category: 'structure',
        description: 'No console.log',
        check_type: 'pattern',
        pattern: 'console\\.log'
      }, { registryFile });

      fs.writeFileSync(path.join(tmpDir, 'src', 'app.js'), 'const x = 1;\n', 'utf8');

      const result = evaluateFitness(tmpDir, { registryFile });
      expect(result.all_passed).toBe(true);
    });
  });

  describe('listFitnessFunctions', () => {
    it('lists registered functions', () => {
      const registryFile = path.join(tmpDir, '.jumpstart', 'fitness-functions.json');
      addFitnessFunction({ name: 'Test', category: 'structure', description: 'Test func' }, { registryFile });

      const result = listFitnessFunctions({}, { registryFile });
      expect(result.success).toBe(true);
      expect(result.total).toBe(1);
    });

    it('filters by category', () => {
      const registryFile = path.join(tmpDir, '.jumpstart', 'fitness-functions.json');
      addFitnessFunction({ name: 'A', category: 'structure', description: 'A' }, { registryFile });
      addFitnessFunction({ name: 'B', category: 'security', description: 'B' }, { registryFile });

      const result = listFitnessFunctions({ category: 'security' }, { registryFile });
      expect(result.total).toBe(1);
    });
  });
});
