/**
 * test-reference-architectures.test.js — Tests for Org-wide Reusable Reference Architectures
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-refarch-'));
  fs.mkdirSync(path.join(tmpDir, '.jumpstart'), { recursive: true });
  return tmpDir;
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

const {
  defaultRegistry,
  loadRegistry,
  saveRegistry,
  listPatterns,
  getPattern,
  registerPattern,
  instantiatePattern,
  BUILTIN_PATTERNS,
  PATTERN_CATEGORIES
} = require('../bin/lib/reference-architectures');

describe('reference-architectures', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  describe('BUILTIN_PATTERNS', () => {
    it('has at least 4 built-in patterns', () => {
      expect(BUILTIN_PATTERNS.length).toBeGreaterThanOrEqual(4);
    });

    it('includes RAG pipeline', () => {
      expect(BUILTIN_PATTERNS.some(p => p.id === 'rag-pipeline')).toBe(true);
    });

    it('includes API platform', () => {
      expect(BUILTIN_PATTERNS.some(p => p.id === 'api-platform')).toBe(true);
    });

    it('includes event-driven', () => {
      expect(BUILTIN_PATTERNS.some(p => p.id === 'event-driven')).toBe(true);
    });

    it('each pattern has required fields', () => {
      for (const p of BUILTIN_PATTERNS) {
        expect(p.id).toBeTruthy();
        expect(p.name).toBeTruthy();
        expect(p.description).toBeTruthy();
        expect(p.components).toBeInstanceOf(Array);
      }
    });
  });

  describe('PATTERN_CATEGORIES', () => {
    it('includes expected categories', () => {
      expect(PATTERN_CATEGORIES).toContain('api-platform');
      expect(PATTERN_CATEGORIES).toContain('event-driven');
      expect(PATTERN_CATEGORIES).toContain('rag');
      expect(PATTERN_CATEGORIES).toContain('agent-app');
    });
  });

  describe('defaultRegistry', () => {
    it('returns registry with built-in patterns', () => {
      const r = defaultRegistry();
      expect(r.patterns.length).toBeGreaterThanOrEqual(4);
      expect(r.custom_patterns).toEqual([]);
    });
  });

  describe('listPatterns', () => {
    it('lists all patterns', () => {
      const result = listPatterns();
      expect(result.success).toBe(true);
      expect(result.total).toBeGreaterThanOrEqual(4);
    });

    it('filters by category', () => {
      const result = listPatterns({ category: 'rag' });
      expect(result.patterns.every(p => p.category === 'rag')).toBe(true);
    });
  });

  describe('getPattern', () => {
    it('returns a built-in pattern', () => {
      const result = getPattern('rag-pipeline');
      expect(result.success).toBe(true);
      expect(result.pattern.name).toBe('RAG Pipeline');
      expect(result.pattern.components.length).toBeGreaterThan(0);
    });

    it('errors for unknown pattern', () => {
      const result = getPattern('nonexistent');
      expect(result.success).toBe(false);
    });
  });

  describe('registerPattern', () => {
    it('registers a custom pattern', () => {
      const registryFile = path.join(tmpDir, '.jumpstart', 'reference-architectures.json');
      const result = registerPattern({
        name: 'Custom CMS',
        category: 'other',
        description: 'Custom content management system',
        components: ['content-api', 'admin-ui', 'storage']
      }, { registryFile });

      expect(result.success).toBe(true);
      expect(result.pattern.custom).toBe(true);
    });

    it('errors without name', () => {
      const result = registerPattern({});
      expect(result.success).toBe(false);
    });

    it('prevents duplicate IDs', () => {
      const registryFile = path.join(tmpDir, '.jumpstart', 'reference-architectures.json');
      registerPattern({ name: 'Test', description: 'Test' }, { registryFile });
      const result = registerPattern({ name: 'Test', description: 'Test dup' }, { registryFile });
      expect(result.success).toBe(false);
    });
  });

  describe('instantiatePattern', () => {
    it('creates directory structure', () => {
      const registryFile = path.join(tmpDir, '.jumpstart', 'reference-architectures.json');
      const result = instantiatePattern('api-platform', tmpDir, { registryFile });

      expect(result.success).toBe(true);
      expect(result.directories_created.length).toBeGreaterThan(0);
      expect(result.components.length).toBeGreaterThan(0);
    });

    it('skips existing directories', () => {
      const registryFile = path.join(tmpDir, '.jumpstart', 'reference-architectures.json');
      instantiatePattern('api-platform', tmpDir, { registryFile });
      const result = instantiatePattern('api-platform', tmpDir, { registryFile });

      expect(result.success).toBe(true);
      expect(result.directories_skipped.length).toBeGreaterThan(0);
    });

    it('errors for unknown pattern', () => {
      const result = instantiatePattern('nonexistent', tmpDir);
      expect(result.success).toBe(false);
    });

    it('creates README.md in each directory', () => {
      const registryFile = path.join(tmpDir, '.jumpstart', 'reference-architectures.json');
      const result = instantiatePattern('rag-pipeline', tmpDir, { registryFile });

      for (const dir of result.directories_created) {
        const readmePath = path.join(tmpDir, dir, 'README.md');
        expect(fs.existsSync(readmePath)).toBe(true);
      }
    });
  });
});
