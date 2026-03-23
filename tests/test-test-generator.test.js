/**
 * test-test-generator.test.js — Tests for Test Generation Tied to Acceptance Criteria
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-testgen-'));
  fs.mkdirSync(path.join(tmpDir, '.jumpstart', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'specs'), { recursive: true });
  return tmpDir;
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

const {
  extractCriteria,
  generateTestStubs,
  checkCoverage,
  TEST_TYPES,
  TEST_FRAMEWORKS
} = require('../bin/lib/test-generator.js');

describe('test-generator', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  describe('TEST_TYPES', () => {
    it('should contain all expected test types', () => {
      expect(TEST_TYPES).toEqual(['unit', 'integration', 'api', 'ui', 'contract', 'e2e']);
    });
  });

  describe('TEST_FRAMEWORKS', () => {
    it('should define frameworks for javascript, typescript, and python', () => {
      expect(TEST_FRAMEWORKS).toHaveProperty('javascript');
      expect(TEST_FRAMEWORKS).toHaveProperty('typescript');
      expect(TEST_FRAMEWORKS).toHaveProperty('python');
    });

    it('should use vitest for javascript', () => {
      expect(TEST_FRAMEWORKS.javascript.framework).toBe('vitest');
      expect(TEST_FRAMEWORKS.javascript.extension).toBe('.test.js');
    });

    it('should use pytest for python', () => {
      expect(TEST_FRAMEWORKS.python.framework).toBe('pytest');
    });
  });

  describe('extractCriteria', () => {
    it('should extract Given criteria', () => {
      const content = '- Given the user is authenticated';
      const criteria = extractCriteria(content);
      expect(criteria.length).toBe(1);
      expect(criteria[0].type).toBe('given');
      expect(criteria[0].criterion).toContain('the user is authenticated');
    });

    it('should extract When criteria', () => {
      const content = '- When the user clicks submit';
      const criteria = extractCriteria(content);
      expect(criteria.length).toBe(1);
      expect(criteria[0].type).toBe('when');
    });

    it('should extract Then criteria', () => {
      const content = '- Then the form is submitted';
      const criteria = extractCriteria(content);
      expect(criteria.length).toBe(1);
      expect(criteria[0].type).toBe('then');
    });

    it('should extract AC acceptance criteria', () => {
      const content = '- AC1: The system returns 200 OK';
      const criteria = extractCriteria(content);
      expect(criteria.length).toBe(1);
      expect(criteria[0].type).toBe('acceptance');
    });

    it('should associate criteria with story IDs', () => {
      const content = '**E1-S01**\n- Given a user exists\n**E2-S03**\n- Then data is saved';
      const criteria = extractCriteria(content);
      expect(criteria.length).toBe(2);
      expect(criteria[0].story).toBe('E1-S01');
      expect(criteria[1].story).toBe('E2-S03');
    });

    it('should return empty array for content with no criteria', () => {
      const criteria = extractCriteria('# Just a heading\nNo criteria here.');
      expect(criteria).toEqual([]);
    });

    it('should handle multiple criteria in the same story', () => {
      const content = '**E1-S01**\n- Given A\n- When B\n- Then C';
      const criteria = extractCriteria(content);
      expect(criteria.length).toBe(3);
      expect(criteria.every(c => c.story === 'E1-S01')).toBe(true);
    });
  });

  describe('generateTestStubs', () => {
    it('should generate test stubs for javascript', () => {
      const criteria = [
        { story: 'E1-S01', criterion: 'user can login', type: 'given' },
        { story: 'E1-S01', criterion: 'system returns 200', type: 'then' }
      ];
      const result = generateTestStubs(criteria);
      expect(result.success).toBe(true);
      expect(result.total_criteria).toBe(2);
      expect(result.test_files).toBe(1);
      expect(result.framework).toBe('vitest');
      expect(result.files[0].content).toContain("describe('E1-S01'");
    });

    it('should return error for unsupported language', () => {
      const result = generateTestStubs([{ criterion: 'test', type: 'given' }], { language: 'rust' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported language');
    });

    it('should group criteria by story', () => {
      const criteria = [
        { story: 'E1-S01', criterion: 'A', type: 'given' },
        { story: 'E2-S01', criterion: 'B', type: 'when' }
      ];
      const result = generateTestStubs(criteria);
      expect(result.test_files).toBe(2);
    });

    it('should assign story "general" to criteria without story', () => {
      const criteria = [{ criterion: 'Standalone test', type: 'acceptance' }];
      const result = generateTestStubs(criteria);
      expect(result.success).toBe(true);
      expect(result.files[0].story).toBe('general');
    });

    it('should generate python test stubs', () => {
      const criteria = [{ story: 'E1-S01', criterion: 'works', type: 'then' }];
      const result = generateTestStubs(criteria, { language: 'python' });
      expect(result.success).toBe(true);
      expect(result.framework).toBe('pytest');
      expect(result.files[0].fileName).toContain('_test.py');
    });
  });

  describe('checkCoverage', () => {
    it('should return error when PRD is missing', () => {
      const result = checkCoverage(tmpDir);
      expect(result.success).toBe(false);
      expect(result.error).toContain('PRD not found');
    });

    it('should return 0 coverage when no tests exist', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'prd.md'), '- Given the user logs in');
      const result = checkCoverage(tmpDir);
      expect(result.success).toBe(true);
      expect(result.total_criteria).toBeGreaterThan(0);
      expect(result.coverage).toBe(0);
    });

    it('should detect covered criteria from test content', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'prd.md'), '- Given the user authenticates');
      fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'tests', 'auth.test.js'), "it('user authenticates', () => {});");
      const result = checkCoverage(tmpDir);
      expect(result.success).toBe(true);
      expect(result.covered).toBeGreaterThan(0);
    });
  });
});
