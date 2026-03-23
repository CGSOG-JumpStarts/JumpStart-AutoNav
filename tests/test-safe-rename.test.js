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
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  return tmpDir;
}
function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

const {
  planRename,
  findReferences,
  validateRename,
  REFERENCE_PATTERNS
} = require('../bin/lib/safe-rename.js');

describe('safe-rename', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });
  afterEach(() => cleanup(tmpDir));

  describe('REFERENCE_PATTERNS', () => {
    it('has known pattern types', () => {
      const types = REFERENCE_PATTERNS.map(p => p.type);
      expect(types).toContain('import');
      expect(types).toContain('markdown-link');
    });
  });

  describe('findReferences', () => {
    it('returns empty when no refs', () => {
      fs.writeFileSync(path.join(tmpDir, 'src', 'a.js'), 'const x = 1;\n');
      const refs = findReferences(tmpDir, 'src/other.js');
      expect(refs).toEqual([]);
    });
    it('finds references in JS files', () => {
      fs.writeFileSync(path.join(tmpDir, 'src', 'a.js'), "const b = require('./b');\n");
      fs.writeFileSync(path.join(tmpDir, 'src', 'b.js'), 'module.exports = 1;\n');
      const refs = findReferences(tmpDir, 'src/b.js');
      expect(refs.length).toBeGreaterThan(0);
    });
    it('finds references in markdown', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'doc.md'), 'See [link](src/utils.js)\n');
      fs.writeFileSync(path.join(tmpDir, 'src', 'utils.js'), '');
      const refs = findReferences(tmpDir, 'src/utils.js');
      expect(refs.length).toBeGreaterThan(0);
    });
  });

  describe('planRename', () => {
    it('fails without paths', () => {
      expect(planRename(tmpDir, '', 'new.js').success).toBe(false);
    });
    it('fails when source missing', () => {
      const r = planRename(tmpDir, 'no-file.js', 'new.js');
      expect(r.success).toBe(false);
      expect(r.error).toContain('Source not found');
    });
    it('plans a rename successfully', () => {
      fs.writeFileSync(path.join(tmpDir, 'src', 'old.js'), 'x');
      const r = planRename(tmpDir, 'src/old.js', 'src/new.js');
      expect(r.success).toBe(true);
      expect(r.old_path).toBe('src/old.js');
      expect(r.new_path).toBe('src/new.js');
    });
  });

  describe('validateRename', () => {
    it('reports clean rename', () => {
      fs.writeFileSync(path.join(tmpDir, 'src', 'new.js'), 'x');
      const r = validateRename(tmpDir, 'src/old.js', 'src/new.js');
      expect(r.success).toBe(true);
      expect(r.new_file_exists).toBe(true);
      expect(r.old_file_removed).toBe(true);
      expect(r.clean).toBe(true);
    });
    it('detects incomplete rename', () => {
      fs.writeFileSync(path.join(tmpDir, 'src', 'old.js'), 'x');
      const r = validateRename(tmpDir, 'src/old.js', 'src/new.js');
      expect(r.new_file_exists).toBe(false);
      expect(r.old_file_removed).toBe(false);
      expect(r.clean).toBe(false);
    });
  });
});
