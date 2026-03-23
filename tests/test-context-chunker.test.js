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
  estimateTokens,
  chunkContent,
  chunkImplementationPlan,
  MODEL_CONTEXT_LIMITS
} = require('../bin/lib/context-chunker.js');

describe('context-chunker', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });
  afterEach(() => cleanup(tmpDir));

  describe('MODEL_CONTEXT_LIMITS', () => {
    it('has default entry', () => {
      expect(MODEL_CONTEXT_LIMITS.default).toBeDefined();
      expect(MODEL_CONTEXT_LIMITS.default.tokens).toBeGreaterThan(0);
    });
    it('has known models', () => {
      expect(MODEL_CONTEXT_LIMITS['gpt-4']).toBeDefined();
      expect(MODEL_CONTEXT_LIMITS['claude-3-sonnet']).toBeDefined();
    });
  });

  describe('estimateTokens', () => {
    it('estimates ~4 chars per token', () => {
      expect(estimateTokens('abcd')).toBe(1);
      expect(estimateTokens('abcdefgh')).toBe(2);
    });
    it('rounds up', () => {
      expect(estimateTokens('ab')).toBe(1);
    });
    it('handles empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });
  });

  describe('chunkContent', () => {
    it('returns single chunk for small content', () => {
      const r = chunkContent('Hello world');
      expect(r.success).toBe(true);
      expect(r.chunks).toBe(1);
    });
    it('chunks large content', () => {
      const big = 'x'.repeat(200000);
      const r = chunkContent(big, { model: 'gpt-4' });
      expect(r.chunks).toBeGreaterThan(1);
    });
    it('uses model limits', () => {
      const r = chunkContent('small', { model: 'claude-3-opus' });
      expect(r.model).toBe('claude-3-opus');
    });
  });

  describe('chunkImplementationPlan', () => {
    it('fails when plan missing', () => {
      const r = chunkImplementationPlan(tmpDir);
      expect(r.success).toBe(false);
    });
    it('chunks an existing plan', () => {
      const plan = '## Phase 1\nDo stuff\n## Phase 2\nMore stuff\n';
      fs.writeFileSync(path.join(tmpDir, 'specs', 'implementation-plan.md'), plan);
      const r = chunkImplementationPlan(tmpDir);
      expect(r.success).toBe(true);
      expect(r.total_sections).toBeGreaterThan(0);
      expect(r.model_recommendations.length).toBeGreaterThan(0);
    });
  });
});
