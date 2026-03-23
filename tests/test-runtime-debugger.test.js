/**
 * test-runtime-debugger.test.js — Tests for Runtime-Aware Debugging Mode
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-debugger-'));
  fs.mkdirSync(path.join(tmpDir, '.jumpstart', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'specs'), { recursive: true });
  return tmpDir;
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

const {
  analyzeLogs,
  analyzeLogFile,
  correlateWithSource,
  generateHypotheses,
  LOG_PATTERNS
} = require('../bin/lib/runtime-debugger.js');

describe('runtime-debugger', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  describe('LOG_PATTERNS', () => {
    it('should define patterns for known log types', () => {
      expect(LOG_PATTERNS).toHaveProperty('error');
      expect(LOG_PATTERNS).toHaveProperty('warning');
      expect(LOG_PATTERNS).toHaveProperty('exception');
      expect(LOG_PATTERNS).toHaveProperty('stack_trace');
      expect(LOG_PATTERNS).toHaveProperty('timeout');
      expect(LOG_PATTERNS).toHaveProperty('oom');
      expect(LOG_PATTERNS).toHaveProperty('connection');
    });

    it('should match ERROR keyword', () => {
      expect(LOG_PATTERNS.error.test('ERROR: something failed')).toBe(true);
    });

    it('should match WARNING keyword', () => {
      expect(LOG_PATTERNS.warning.test('WARNING: deprecated API')).toBe(true);
    });
  });

  describe('analyzeLogs', () => {
    it('should return empty findings for clean logs', () => {
      const result = analyzeLogs('INFO: Server started\nINFO: Listening on port 3000');
      expect(result.success).toBe(true);
      expect(result.total_findings).toBe(0);
      expect(result.summary.errors).toBe(0);
      expect(result.summary.warnings).toBe(0);
    });

    it('should detect ERROR lines', () => {
      const result = analyzeLogs('ERROR: Database connection failed\nINFO: Retrying...');
      expect(result.success).toBe(true);
      expect(result.total_findings).toBe(1);
      expect(result.findings[0].type).toBe('error');
      expect(result.findings[0].severity).toBe('high');
      expect(result.summary.errors).toBe(1);
    });

    it('should detect WARNING lines', () => {
      const result = analyzeLogs('WARN: Disk space low');
      expect(result.success).toBe(true);
      expect(result.findings[0].type).toBe('warning');
      expect(result.summary.warnings).toBe(1);
    });

    it('should detect exception patterns', () => {
      const result = analyzeLogs('TypeError: Cannot read properties of undefined');
      expect(result.success).toBe(true);
      expect(result.findings[0].type).toBe('exception');
      expect(result.findings[0].severity).toBe('high');
    });

    it('should detect timeout patterns', () => {
      const result = analyzeLogs('Request timed out after 30000ms');
      expect(result.success).toBe(true);
      expect(result.findings[0].type).toBe('timeout');
    });

    it('should detect OOM patterns', () => {
      const result = analyzeLogs('heap out of memory detected');
      expect(result.success).toBe(true);
      expect(result.findings.some(f => f.type === 'oom')).toBe(true);
    });

    it('should detect connection issues', () => {
      const result = analyzeLogs('ECONNREFUSED 127.0.0.1:5432');
      expect(result.success).toBe(true);
      expect(result.findings[0].type).toBe('connection');
    });

    it('should track line numbers correctly', () => {
      const result = analyzeLogs('OK\nOK\nERROR: fail');
      expect(result.findings[0].line).toBe(3);
    });

    it('should handle empty log content', () => {
      const result = analyzeLogs('');
      expect(result.success).toBe(true);
      expect(result.total_findings).toBe(0);
    });
  });

  describe('analyzeLogFile', () => {
    it('should return error for non-existent file', () => {
      const result = analyzeLogFile(path.join(tmpDir, 'nonexistent.log'));
      expect(result.success).toBe(false);
      expect(result.error).toContain('Log file not found');
    });

    it('should analyze a log file from disk', () => {
      const logFile = path.join(tmpDir, 'app.log');
      fs.writeFileSync(logFile, 'INFO: Start\nERROR: Crash\nWARN: Low memory');
      const result = analyzeLogFile(logFile);
      expect(result.success).toBe(true);
      expect(result.file).toBe(logFile);
      expect(result.summary.errors).toBe(1);
      expect(result.summary.warnings).toBe(1);
    });

    it('should handle empty log file', () => {
      const logFile = path.join(tmpDir, 'empty.log');
      fs.writeFileSync(logFile, '');
      const result = analyzeLogFile(logFile);
      expect(result.success).toBe(true);
      expect(result.total_findings).toBe(0);
    });
  });

  describe('correlateWithSource', () => {
    it('should correlate errors referencing source files', () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'app.js'), 'code');
      const findings = [
        { content: 'at src/app.js:42 — TypeError', severity: 'high' }
      ];
      const result = correlateWithSource(findings, tmpDir);
      expect(result.success).toBe(true);
      expect(result.total).toBe(1);
      expect(result.correlations[0].source_file).toBe('src/app.js');
      expect(result.correlations[0].source_line).toBe(42);
      expect(result.correlations[0].file_exists).toBe(true);
      expect(result.actionable).toBe(1);
    });

    it('should handle findings with no file references', () => {
      const findings = [
        { content: 'Generic error with no file path', severity: 'high' }
      ];
      const result = correlateWithSource(findings, tmpDir);
      expect(result.success).toBe(true);
      expect(result.total).toBe(0);
    });

    it('should flag non-existent files', () => {
      const findings = [
        { content: 'at missing/file.js:10 — Error', severity: 'high' }
      ];
      const result = correlateWithSource(findings, tmpDir);
      expect(result.success).toBe(true);
      expect(result.correlations[0].file_exists).toBe(false);
      expect(result.actionable).toBe(0);
    });

    it('should handle empty findings array', () => {
      const result = correlateWithSource([], tmpDir);
      expect(result.success).toBe(true);
      expect(result.total).toBe(0);
    });
  });

  describe('generateHypotheses', () => {
    it('should generate no hypotheses for clean analysis', () => {
      const analysis = {
        summary: { errors: 0, warnings: 0, exceptions: 0, timeouts: 0, oom: 0, connection_issues: 0 }
      };
      const result = generateHypotheses(analysis);
      expect(result.success).toBe(true);
      expect(result.total).toBe(0);
      expect(result.hypotheses).toEqual([]);
    });

    it('should generate OOM hypothesis', () => {
      const analysis = {
        summary: { errors: 0, warnings: 0, exceptions: 0, timeouts: 0, oom: 3, connection_issues: 0 }
      };
      const result = generateHypotheses(analysis);
      expect(result.hypotheses.some(h => h.hypothesis.includes('Memory leak'))).toBe(true);
    });

    it('should generate timeout hypothesis', () => {
      const analysis = {
        summary: { errors: 0, warnings: 0, exceptions: 0, timeouts: 2, oom: 0, connection_issues: 0 }
      };
      const result = generateHypotheses(analysis);
      expect(result.hypotheses.some(h => h.hypothesis.includes('Network connectivity'))).toBe(true);
    });

    it('should generate connection hypothesis', () => {
      const analysis = {
        summary: { errors: 0, warnings: 0, exceptions: 0, timeouts: 0, oom: 0, connection_issues: 5 }
      };
      const result = generateHypotheses(analysis);
      expect(result.hypotheses.some(h => h.hypothesis.includes('Service dependency'))).toBe(true);
    });

    it('should generate exception hypothesis', () => {
      const analysis = {
        summary: { errors: 0, warnings: 0, exceptions: 4, timeouts: 0, oom: 0, connection_issues: 0 }
      };
      const result = generateHypotheses(analysis);
      expect(result.hypotheses.some(h => h.hypothesis.includes('Unhandled exception'))).toBe(true);
    });

    it('should generate multiple hypotheses when multiple issues exist', () => {
      const analysis = {
        summary: { errors: 1, warnings: 1, exceptions: 2, timeouts: 1, oom: 1, connection_issues: 1 }
      };
      const result = generateHypotheses(analysis);
      expect(result.total).toBe(4);
    });
  });
});
