/**
 * test-credential-boundary.test.js — Tests for Secrets & Credential Boundary Checks
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-cred-'));
  fs.mkdirSync(path.join(tmpDir, '.jumpstart', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'specs'), { recursive: true });
  return tmpDir;
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

const {
  scanBoundaries,
  scanProject,
  generateReport,
  BOUNDARY_PATTERNS,
  SAFE_PATTERNS
} = require('../bin/lib/credential-boundary.js');

describe('credential-boundary', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => cleanup(tmpDir));

  describe('constants', () => {
    it('BOUNDARY_PATTERNS is non-empty', () => {
      expect(BOUNDARY_PATTERNS.length).toBeGreaterThan(0);
      expect(BOUNDARY_PATTERNS[0]).toHaveProperty('name');
      expect(BOUNDARY_PATTERNS[0]).toHaveProperty('pattern');
      expect(BOUNDARY_PATTERNS[0]).toHaveProperty('severity');
    });

    it('SAFE_PATTERNS is non-empty', () => {
      expect(SAFE_PATTERNS.length).toBeGreaterThan(0);
    });
  });

  describe('scanBoundaries', () => {
    it('detects hardcoded secrets', () => {
      const testFile = path.join(tmpDir, 'config.md');
      fs.writeFileSync(testFile, 'password = "SuperSecret12345678"\n', 'utf8');
      const result = scanBoundaries([testFile], tmpDir);
      expect(result.success).toBe(true);
      expect(result.files_scanned).toBe(1);
      expect(result.total_findings).toBeGreaterThan(0);
      expect(result.pass).toBe(false);
    });

    it('detects private key material', () => {
      const testFile = path.join(tmpDir, 'key.md');
      fs.writeFileSync(testFile, '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAK\n', 'utf8');
      const result = scanBoundaries([testFile], tmpDir);
      expect(result.total_findings).toBeGreaterThan(0);
      expect(result.critical).toBeGreaterThan(0);
    });

    it('detects inline connection strings', () => {
      const testFile = path.join(tmpDir, 'db.md');
      fs.writeFileSync(testFile, 'mongodb://admin:password123@host:27017/db\n', 'utf8');
      const result = scanBoundaries([testFile], tmpDir);
      expect(result.total_findings).toBeGreaterThan(0);
    });

    it('returns clean result for safe files', () => {
      const testFile = path.join(tmpDir, 'clean.md');
      fs.writeFileSync(testFile, '# Architecture\n\nThis is clean content.\n', 'utf8');
      const result = scanBoundaries([testFile], tmpDir);
      expect(result.success).toBe(true);
      expect(result.total_findings).toBe(0);
      expect(result.pass).toBe(true);
    });

    it('skips non-existent files', () => {
      const result = scanBoundaries(['/nonexistent/file.md'], tmpDir);
      expect(result.success).toBe(true);
      expect(result.files_scanned).toBe(0);
    });

    it('ignores safe patterns like vault references', () => {
      const testFile = path.join(tmpDir, 'safe.md');
      fs.writeFileSync(testFile, 'password = "${VAULT_SECRET}"\n', 'utf8');
      const result = scanBoundaries([testFile], tmpDir);
      expect(result.total_findings).toBe(0);
    });
  });

  describe('scanProject', () => {
    it('scans project root recursively', () => {
      const subDir = path.join(tmpDir, 'specs');
      fs.writeFileSync(path.join(subDir, 'test.md'), '# Clean file\n', 'utf8');
      const result = scanProject(tmpDir);
      expect(result.success).toBe(true);
      expect(result.files_scanned).toBeGreaterThan(0);
    });

    it('excludes node_modules and .git', () => {
      fs.mkdirSync(path.join(tmpDir, 'node_modules'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'node_modules', 'pkg.js'), 'password = "secret12345678"\n', 'utf8');
      const result = scanProject(tmpDir);
      expect(result.findings.filter(f => f.file.includes('node_modules'))).toHaveLength(0);
    });

    it('detects secrets in nested files', () => {
      const nested = path.join(tmpDir, 'src');
      fs.mkdirSync(nested, { recursive: true });
      fs.writeFileSync(path.join(nested, 'config.js'), 'const secret = "SuperSecret12345678";\npassword = "abcdefgh12345678"\n', 'utf8');
      const result = scanProject(tmpDir);
      expect(result.total_findings).toBeGreaterThan(0);
    });
  });

  describe('generateReport', () => {
    it('generates report from scan results', () => {
      const scanResult = {
        files_scanned: 5,
        findings: [
          { file: 'a.md', line: 1, pattern: 'Hardcoded secret in spec', severity: 'critical', matched: 'test' },
          { file: 'b.md', line: 2, pattern: 'Bearer token in spec', severity: 'high', matched: 'test' }
        ],
        total_findings: 2,
        pass: false
      };
      const result = generateReport(scanResult);
      expect(result.success).toBe(true);
      expect(result.by_severity['critical']).toBe(1);
      expect(result.by_severity['high']).toBe(1);
      expect(result.by_pattern['Hardcoded secret in spec']).toBe(1);
      expect(result.critical_findings).toHaveLength(1);
      expect(result.recommendations.length).toBeGreaterThan(0);
    });

    it('generates clean report when no findings', () => {
      const scanResult = { files_scanned: 3, findings: [], total_findings: 0, pass: true };
      const result = generateReport(scanResult);
      expect(result.success).toBe(true);
      expect(result.summary.pass).toBe(true);
      expect(result.recommendations).toEqual(['No credential boundary issues detected']);
    });
  });
});
