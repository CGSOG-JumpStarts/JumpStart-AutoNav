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
  analyzeFailure,
  analyzeTestFile,
  generateReport,
  FAILURE_PATTERNS
} = require('../bin/lib/root-cause-analysis.js');

describe('root-cause-analysis', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  describe('FAILURE_PATTERNS', () => {
    it('should be an array of pattern objects', () => {
      expect(Array.isArray(FAILURE_PATTERNS)).toBe(true);
      for (const fp of FAILURE_PATTERNS) {
        expect(fp).toHaveProperty('pattern');
        expect(fp).toHaveProperty('category');
        expect(fp).toHaveProperty('fix');
      }
    });
  });

  describe('analyzeFailure', () => {
    it('should return error for empty output', () => {
      const result = analyzeFailure('');
      expect(result.success).toBe(false);
    });
    it('should detect missing module errors', () => {
      const result = analyzeFailure("Cannot find module 'express'");
      expect(result.success).toBe(true);
      expect(result.total_hypotheses).toBeGreaterThan(0);
      expect(result.categories).toContain('missing-dependency');
    });
    it('should detect syntax errors', () => {
      const result = analyzeFailure('SyntaxError: Unexpected token }');
      expect(result.success).toBe(true);
      expect(result.categories).toContain('syntax-error');
      expect(result.primary_cause).toBeTruthy();
    });
    it('should detect type errors', () => {
      const result = analyzeFailure('TypeError: foo is not a function');
      expect(result.success).toBe(true);
      expect(result.categories).toContain('type-error');
    });
    it('should return empty hypotheses for clean output', () => {
      const result = analyzeFailure('All tests passed. 42 specs, 0 failures.');
      expect(result.success).toBe(true);
      expect(result.total_hypotheses).toBe(0);
      expect(result.primary_cause).toBeNull();
    });
    it('should detect timeout errors', () => {
      const result = analyzeFailure('Error: timeout of 5000ms exceeded');
      expect(result.categories).toContain('timeout');
    });
    it('should provide recommended actions', () => {
      const result = analyzeFailure("Cannot find module 'lodash'\nSyntaxError: bad syntax");
      expect(result.recommended_actions.length).toBeGreaterThan(0);
    });
  });

  describe('analyzeTestFile', () => {
    it('should return error for missing file', () => {
      const result = analyzeTestFile(path.join(tmpDir, 'nope.txt'));
      expect(result.success).toBe(false);
    });
    it('should analyze a test output file', () => {
      const fp = path.join(tmpDir, 'output.txt');
      fs.writeFileSync(fp, "TypeError: bar is not a function\nSyntaxError: Unexpected end", 'utf8');
      const result = analyzeTestFile(fp);
      expect(result.success).toBe(true);
      expect(result.file).toBe(fp);
      expect(result.total_hypotheses).toBeGreaterThan(0);
    });
  });

  describe('generateReport', () => {
    it('should return error for invalid analysis', () => {
      const result = generateReport(null);
      expect(result.success).toBe(false);
    });
    it('should generate report from analysis', () => {
      const analysis = analyzeFailure("Cannot find module 'x'\nSyntaxError: bad");
      const report = generateReport(analysis);
      expect(report.success).toBe(true);
      expect(report.summary.total_issues).toBeGreaterThan(0);
      expect(report.action_plan).toBeDefined();
    });
    it('should report by category', () => {
      const analysis = analyzeFailure("TypeError: x is not a function\nTypeError: y is not a function");
      const report = generateReport(analysis);
      expect(report.by_category).toHaveProperty('type-error');
    });
  });
});
