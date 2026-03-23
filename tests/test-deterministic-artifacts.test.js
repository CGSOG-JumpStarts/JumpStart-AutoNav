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
  normalizeMarkdown,
  hashContent,
  normalizeFile,
  verifyStability,
  normalizeSpecs
} = require('../bin/lib/deterministic-artifacts.js');

describe('deterministic-artifacts', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  describe('normalizeMarkdown', () => {
    it('should normalize line endings', () => {
      expect(normalizeMarkdown('a\r\nb\r\n')).toBe('a\nb\n');
    });
    it('should collapse multiple blank lines', () => {
      expect(normalizeMarkdown('a\n\n\n\nb')).toBe('a\n\nb\n');
    });
    it('should replace tabs with spaces', () => {
      const result = normalizeMarkdown('\thello');
      expect(result).not.toContain('\t');
    });
    it('should remove HTML comments', () => {
      expect(normalizeMarkdown('before<!-- comment -->after')).toBe('beforeafter\n');
    });
    it('should normalize timestamps to [TIMESTAMP]', () => {
      const result = normalizeMarkdown('date: 2024-01-15T10:30:00Z');
      expect(result).toContain('[TIMESTAMP]');
    });
    it('should normalize UUIDs to [UUID]', () => {
      const result = normalizeMarkdown('id: 550e8400-e29b-41d4-a716-446655440000');
      expect(result).toContain('[UUID]');
    });
  });

  describe('hashContent', () => {
    it('should return a 16-char hex string', () => {
      const hash = hashContent('hello world');
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });
    it('should produce same hash for equivalent content', () => {
      expect(hashContent('hello\r\nworld')).toBe(hashContent('hello\nworld'));
    });
    it('should produce different hashes for different content', () => {
      expect(hashContent('aaa')).not.toBe(hashContent('bbb'));
    });
  });

  describe('normalizeFile', () => {
    it('should return error for missing file', () => {
      const result = normalizeFile(path.join(tmpDir, 'nope.md'));
      expect(result.success).toBe(false);
    });
    it('should normalize an existing file', () => {
      const fp = path.join(tmpDir, 'test.md');
      fs.writeFileSync(fp, 'hello\r\n\r\n\r\nworld\t', 'utf8');
      const result = normalizeFile(fp);
      expect(result.success).toBe(true);
      expect(result.hash).toBeTruthy();
      expect(result.modified).toBe(true);
    });
    it('should write back when write option is true', () => {
      const fp = path.join(tmpDir, 'test.md');
      fs.writeFileSync(fp, 'hello\r\nworld', 'utf8');
      normalizeFile(fp, { write: true });
      const content = fs.readFileSync(fp, 'utf8');
      expect(content).not.toContain('\r\n');
    });
  });

  describe('verifyStability', () => {
    it('should detect identical files', () => {
      const f1 = path.join(tmpDir, 'a.md');
      const f2 = path.join(tmpDir, 'b.md');
      fs.writeFileSync(f1, '# Hello\n', 'utf8');
      fs.writeFileSync(f2, '# Hello\n', 'utf8');
      const result = verifyStability(f1, f2);
      expect(result.success).toBe(true);
      expect(result.identical).toBe(true);
      expect(result.similarity).toBe(100);
    });
    it('should detect different files', () => {
      const f1 = path.join(tmpDir, 'a.md');
      const f2 = path.join(tmpDir, 'b.md');
      fs.writeFileSync(f1, '# Hello\n', 'utf8');
      fs.writeFileSync(f2, '# Goodbye\n', 'utf8');
      const result = verifyStability(f1, f2);
      expect(result.identical).toBe(false);
    });
    it('should return error for missing file', () => {
      const f1 = path.join(tmpDir, 'a.md');
      fs.writeFileSync(f1, 'x', 'utf8');
      const result = verifyStability(f1, path.join(tmpDir, 'nope.md'));
      expect(result.success).toBe(false);
    });
  });

  describe('normalizeSpecs', () => {
    it('should return 0 files when specs dir is empty', () => {
      const result = normalizeSpecs(tmpDir);
      expect(result.success).toBe(true);
      expect(result.files).toBe(0);
    });
    it('should normalize markdown files in specs', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'test.md'), 'hello\r\nworld\t\n', 'utf8');
      const result = normalizeSpecs(tmpDir);
      expect(result.success).toBe(true);
      expect(result.files).toBe(1);
    });
    it('should return success with message when no specs dir', () => {
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-test-'));
      const result = normalizeSpecs(emptyDir);
      expect(result.success).toBe(true);
      expect(result.message).toContain('No specs');
      fs.rmSync(emptyDir, { recursive: true, force: true });
    });
  });
});
