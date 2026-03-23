/**
 * test-codebase-retrieval.test.js — Tests for Codebase-Native Retrieval Layer
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-retrieval-'));
  fs.mkdirSync(path.join(tmpDir, '.jumpstart', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'specs'), { recursive: true });
  return tmpDir;
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

const {
  indexProject,
  queryFiles,
  RETRIEVABLE_TYPES,
  FILE_PATTERNS
} = require('../bin/lib/codebase-retrieval.js');

describe('codebase-retrieval', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  describe('RETRIEVABLE_TYPES', () => {
    it('should contain all expected types', () => {
      expect(RETRIEVABLE_TYPES).toEqual(['adrs', 'test-patterns', 'implementations', 'specs', 'configs']);
    });
  });

  describe('FILE_PATTERNS', () => {
    it('should define patterns for adrs, test-patterns, specs, and configs', () => {
      expect(FILE_PATTERNS).toHaveProperty('adrs');
      expect(FILE_PATTERNS).toHaveProperty('test-patterns');
      expect(FILE_PATTERNS).toHaveProperty('specs');
      expect(FILE_PATTERNS).toHaveProperty('configs');
    });

    it('should have array values for each pattern key', () => {
      for (const key of Object.keys(FILE_PATTERNS)) {
        expect(Array.isArray(FILE_PATTERNS[key])).toBe(true);
      }
    });
  });

  describe('indexProject', () => {
    it('should return a successful index for an empty project', () => {
      const result = indexProject(tmpDir);
      expect(result.success).toBe(true);
      expect(result.total_files).toBeGreaterThanOrEqual(0);
      expect(result).toHaveProperty('index');
      expect(result).toHaveProperty('categories');
    });

    it('should categorize spec files correctly', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'architecture.md'), '# Architecture');
      const result = indexProject(tmpDir);
      expect(result.success).toBe(true);
      expect(result.index.specs).toContain('specs/architecture.md');
    });

    it('should categorize ADR files correctly', () => {
      fs.mkdirSync(path.join(tmpDir, 'specs', 'decisions'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'specs', 'decisions', 'adr-001.md'), '# ADR 001');
      const result = indexProject(tmpDir);
      expect(result.success).toBe(true);
      expect(result.index.adrs.some(f => f.includes('adr-001.md'))).toBe(true);
    });

    it('should categorize test files correctly', () => {
      fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'tests', 'example.test.js'), 'test()');
      const result = indexProject(tmpDir);
      expect(result.index['test-patterns'].some(f => f.includes('example.test.js'))).toBe(true);
    });

    it('should categorize implementation files correctly', () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'app.js'), 'module.exports = {}');
      const result = indexProject(tmpDir);
      expect(result.index.implementations).toContain('src/app.js');
    });

    it('should exclude node_modules by default', () => {
      fs.mkdirSync(path.join(tmpDir, 'node_modules', 'pkg'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'node_modules', 'pkg', 'index.js'), '');
      const result = indexProject(tmpDir);
      const allFiles = Object.values(result.index).flat();
      expect(allFiles.some(f => f.includes('node_modules'))).toBe(false);
    });

    it('should handle non-existent root gracefully', () => {
      const result = indexProject(path.join(tmpDir, 'nonexistent'));
      expect(result.success).toBe(true);
      expect(result.total_files).toBe(0);
    });
  });

  describe('queryFiles', () => {
    it('should return error when query is empty', () => {
      const result = queryFiles(tmpDir, '');
      expect(result.success).toBe(false);
      expect(result.error).toBe('query is required');
    });

    it('should return error when query is null', () => {
      const result = queryFiles(tmpDir, null);
      expect(result.success).toBe(false);
    });

    it('should find files matching query by content', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'prd.md'), '# Product Requirements\nThis defines the authentication flow.');
      const result = queryFiles(tmpDir, 'authentication');
      expect(result.success).toBe(true);
      expect(result.total_results).toBeGreaterThanOrEqual(1);
      expect(result.results[0].file).toContain('prd.md');
    });

    it('should find files matching query by filename', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'auth-spec.md'), '# Auth Spec');
      const result = queryFiles(tmpDir, 'auth-spec');
      expect(result.success).toBe(true);
      expect(result.total_results).toBeGreaterThanOrEqual(1);
    });

    it('should respect the limit option', () => {
      for (let i = 0; i < 5; i++) {
        fs.writeFileSync(path.join(tmpDir, 'specs', `doc-${i}.md`), 'searchterm content here');
      }
      const result = queryFiles(tmpDir, 'searchterm', { limit: 2 });
      expect(result.success).toBe(true);
      expect(result.results.length).toBeLessThanOrEqual(2);
    });

    it('should sort results by match count descending', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'many.md'), 'target target target target');
      fs.writeFileSync(path.join(tmpDir, 'specs', 'few.md'), 'target');
      const result = queryFiles(tmpDir, 'target');
      expect(result.success).toBe(true);
      if (result.results.length >= 2) {
        expect(result.results[0].matches).toBeGreaterThanOrEqual(result.results[1].matches);
      }
    });
  });
});
