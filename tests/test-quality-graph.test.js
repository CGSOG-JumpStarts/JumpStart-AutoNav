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
  scanQuality,
  analyzeFileMetrics,
  calculateOverallScore,
  generateReport,
  QUALITY_DIMENSIONS,
  COMPLEXITY_THRESHOLDS
} = require('../bin/lib/quality-graph.js');

describe('quality-graph', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  describe('QUALITY_DIMENSIONS', () => {
    it('should be an array of dimension names', () => {
      expect(Array.isArray(QUALITY_DIMENSIONS)).toBe(true);
      expect(QUALITY_DIMENSIONS).toContain('complexity');
      expect(QUALITY_DIMENSIONS).toContain('churn');
    });
  });

  describe('COMPLEXITY_THRESHOLDS', () => {
    it('should have low, medium, high levels', () => {
      expect(COMPLEXITY_THRESHOLDS).toHaveProperty('low');
      expect(COMPLEXITY_THRESHOLDS).toHaveProperty('medium');
      expect(COMPLEXITY_THRESHOLDS).toHaveProperty('high');
    });
  });

  describe('analyzeFileMetrics', () => {
    it('should count lines and functions', () => {
      const content = 'function hello() {\n  return 1;\n}\nfunction world() {\n  return 2;\n}\n';
      const metrics = analyzeFileMetrics(content, '.js');
      expect(metrics.total_lines).toBe(7);
      expect(metrics.functions).toBe(2);
    });
    it('should detect TODO comments', () => {
      const content = '// TODO: fix this\n// FIXME: later\nconst x = 1;\n';
      const metrics = analyzeFileMetrics(content, '.js');
      expect(metrics.todos).toBe(2);
    });
    it('should calculate comment ratio', () => {
      const content = '// comment\ncode\ncode\ncode\n';
      const metrics = analyzeFileMetrics(content, '.js');
      expect(metrics.comment_ratio).toBe(20);
    });
    it('should classify complexity level', () => {
      const shortContent = 'const x = 1;\n';
      const metrics = analyzeFileMetrics(shortContent, '.js');
      expect(metrics.complexity_level).toBe('low');
    });
    it('should count long lines', () => {
      const longLine = 'x'.repeat(130) + '\n';
      const metrics = analyzeFileMetrics(longLine, '.js');
      expect(metrics.long_lines).toBe(1);
    });
  });

  describe('calculateOverallScore', () => {
    it('should return 100 for perfect metrics', () => {
      const metrics = {
        total_lines: 50, code_lines: 40, comment_ratio: 20,
        functions: 5, max_nesting_depth: 2, todos: 0,
        long_lines: 0, imports: 2, complexity_level: 'low'
      };
      expect(calculateOverallScore(metrics)).toBe(100);
    });
    it('should penalize large files', () => {
      const metrics = {
        total_lines: 1500, code_lines: 1200, comment_ratio: 10,
        functions: 10, max_nesting_depth: 3, todos: 0,
        long_lines: 0, imports: 5, complexity_level: 'critical'
      };
      expect(calculateOverallScore(metrics)).toBeLessThan(100);
    });
    it('should penalize TODOs', () => {
      const base = {
        total_lines: 50, code_lines: 40, comment_ratio: 20,
        functions: 5, max_nesting_depth: 2, todos: 0,
        long_lines: 0, imports: 2, complexity_level: 'low'
      };
      const withTodos = { ...base, todos: 5 };
      expect(calculateOverallScore(withTodos)).toBeLessThan(calculateOverallScore(base));
    });
    it('should never go below 0', () => {
      const terrible = {
        total_lines: 2000, code_lines: 1800, comment_ratio: 0,
        functions: 50, max_nesting_depth: 15, todos: 20,
        long_lines: 50, imports: 30, complexity_level: 'critical'
      };
      expect(calculateOverallScore(terrible)).toBe(0);
    });
  });

  describe('scanQuality', () => {
    it('should scan an empty directory', () => {
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-test-'));
      const result = scanQuality(emptyDir);
      expect(result.success).toBe(true);
      expect(result.total_files).toBe(0);
      fs.rmSync(emptyDir, { recursive: true, force: true });
    });
    it('should scan JS files', () => {
      const srcDir = path.join(tmpDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'app.js'), 'function main() {\n  return 1;\n}\n', 'utf8');
      const result = scanQuality(tmpDir);
      expect(result.success).toBe(true);
      expect(result.total_files).toBeGreaterThan(0);
      expect(result.summary).toBeDefined();
    });
    it('should exclude node_modules by default', () => {
      const nmDir = path.join(tmpDir, 'node_modules', 'pkg');
      fs.mkdirSync(nmDir, { recursive: true });
      fs.writeFileSync(path.join(nmDir, 'index.js'), 'module.exports = {};\n', 'utf8');
      const result = scanQuality(tmpDir);
      expect(result.all_files.every(f => !f.file.includes('node_modules'))).toBe(true);
    });
  });

  describe('generateReport', () => {
    it('should generate report from scan result', () => {
      const srcDir = path.join(tmpDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'app.js'), 'const x = 1;\n', 'utf8');
      const scanResult = scanQuality(tmpDir);
      const report = generateReport(scanResult);
      expect(report.success).toBe(true);
      expect(report.by_complexity).toBeDefined();
      expect(report.recommendations).toBeDefined();
    });
    it('should handle empty scan result', () => {
      const report = generateReport({ all_files: [], hotspots: [], summary: { critical_hotspots: 0, average_score: 100 } });
      expect(report.success).toBe(true);
    });
  });
});
