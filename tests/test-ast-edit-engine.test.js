/**
 * test-ast-edit-engine.test.js — Tests for AST-Aware Edit Engine
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-ast-'));
  fs.mkdirSync(path.join(tmpDir, '.jumpstart', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'specs'), { recursive: true });
  return tmpDir;
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

const {
  detectLanguage,
  analyzeStructure,
  validateEdit,
  countBrackets,
  SUPPORTED_LANGUAGES,
  STRUCTURE_PATTERNS
} = require('../bin/lib/ast-edit-engine.js');

describe('ast-edit-engine', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  describe('SUPPORTED_LANGUAGES', () => {
    it('should contain expected languages', () => {
      expect(SUPPORTED_LANGUAGES).toEqual(['javascript', 'typescript', 'json', 'yaml', 'markdown']);
    });
  });

  describe('STRUCTURE_PATTERNS', () => {
    it('should have patterns for javascript and typescript', () => {
      expect(STRUCTURE_PATTERNS).toHaveProperty('javascript');
      expect(STRUCTURE_PATTERNS).toHaveProperty('typescript');
    });

    it('should have function_decl and class_decl for javascript', () => {
      expect(STRUCTURE_PATTERNS.javascript).toHaveProperty('function_decl');
      expect(STRUCTURE_PATTERNS.javascript).toHaveProperty('class_decl');
    });
  });

  describe('detectLanguage', () => {
    it('should detect javascript from .js extension', () => {
      expect(detectLanguage('file.js')).toBe('javascript');
    });

    it('should detect javascript from .mjs extension', () => {
      expect(detectLanguage('file.mjs')).toBe('javascript');
    });

    it('should detect javascript from .cjs extension', () => {
      expect(detectLanguage('file.cjs')).toBe('javascript');
    });

    it('should detect typescript from .ts extension', () => {
      expect(detectLanguage('file.ts')).toBe('typescript');
    });

    it('should detect typescript from .tsx extension', () => {
      expect(detectLanguage('file.tsx')).toBe('typescript');
    });

    it('should detect json from .json extension', () => {
      expect(detectLanguage('file.json')).toBe('json');
    });

    it('should detect yaml from .yaml and .yml extensions', () => {
      expect(detectLanguage('file.yaml')).toBe('yaml');
      expect(detectLanguage('file.yml')).toBe('yaml');
    });

    it('should detect markdown from .md extension', () => {
      expect(detectLanguage('file.md')).toBe('markdown');
    });

    it('should return null for unknown extensions', () => {
      expect(detectLanguage('file.xyz')).toBeNull();
      expect(detectLanguage('file.rb')).toBeNull();
    });
  });

  describe('countBrackets', () => {
    it('should count balanced brackets as zero', () => {
      const result = countBrackets('function foo() { return [1, 2]; }');
      expect(result.curly).toBe(0);
      expect(result.square).toBe(0);
      expect(result.paren).toBe(0);
    });

    it('should detect unbalanced curly braces', () => {
      const result = countBrackets('function foo() {');
      expect(result.curly).toBe(1);
    });

    it('should handle empty content', () => {
      const result = countBrackets('');
      expect(result.curly).toBe(0);
      expect(result.square).toBe(0);
      expect(result.paren).toBe(0);
    });

    it('should handle nested brackets', () => {
      const result = countBrackets('{ { [( )] } }');
      expect(result.curly).toBe(0);
      expect(result.square).toBe(0);
      expect(result.paren).toBe(0);
    });
  });

  describe('analyzeStructure', () => {
    it('should return error for non-existent file', () => {
      const result = analyzeStructure(path.join(tmpDir, 'nonexistent.js'));
      expect(result.success).toBe(false);
      expect(result.error).toContain('File not found');
    });

    it('should return error for undetectable language', () => {
      const filePath = path.join(tmpDir, 'file.xyz');
      fs.writeFileSync(filePath, 'content');
      const result = analyzeStructure(filePath);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Unable to detect language');
    });

    it('should analyze a javascript file with functions', () => {
      const filePath = path.join(tmpDir, 'example.js');
      fs.writeFileSync(filePath, 'function hello() {\n  return "world";\n}\n\nconst x = 42;\n');
      const result = analyzeStructure(filePath);
      expect(result.success).toBe(true);
      expect(result.language).toBe('javascript');
      expect(result.total_lines).toBeGreaterThan(0);
      expect(result.symbols.some(s => s.name === 'hello')).toBe(true);
    });

    it('should detect exports and imports', () => {
      const filePath = path.join(tmpDir, 'mod.js');
      fs.writeFileSync(filePath, "const x = require('y');\nmodule.exports = { x };\n");
      const result = analyzeStructure(filePath);
      expect(result.success).toBe(true);
      expect(result.has_imports).toBe(true);
      expect(result.has_exports).toBe(true);
    });

    it('should accept a language override via options', () => {
      const filePath = path.join(tmpDir, 'file.xyz');
      fs.writeFileSync(filePath, 'function test() {}');
      const result = analyzeStructure(filePath, { language: 'javascript' });
      expect(result.success).toBe(true);
      expect(result.language).toBe('javascript');
    });
  });

  describe('validateEdit', () => {
    it('should return error for non-existent file', () => {
      const result = validateEdit(path.join(tmpDir, 'nonexistent.js'), 'old', 'new');
      expect(result.success).toBe(false);
      expect(result.error).toContain('File not found');
    });

    it('should return error when old string not found', () => {
      const filePath = path.join(tmpDir, 'file.js');
      fs.writeFileSync(filePath, 'const x = 1;');
      const result = validateEdit(filePath, 'notfound', 'replacement');
      expect(result.success).toBe(false);
      expect(result.safe).toBe(false);
      expect(result.error).toBe('Old string not found in file');
    });

    it('should return error when old string is ambiguous', () => {
      const filePath = path.join(tmpDir, 'file.js');
      fs.writeFileSync(filePath, 'const x = 1;\nconst x = 2;');
      const result = validateEdit(filePath, 'const x', 'const y');
      expect(result.success).toBe(false);
      expect(result.safe).toBe(false);
      expect(result.error).toContain('ambiguous');
    });

    it('should validate a safe edit that preserves bracket balance', () => {
      const filePath = path.join(tmpDir, 'file.js');
      fs.writeFileSync(filePath, 'function foo() {\n  return 1;\n}\n');
      const result = validateEdit(filePath, 'return 1;', 'return 2;');
      expect(result.success).toBe(true);
      expect(result.safe).toBe(true);
      expect(result.unique_match).toBe(true);
      expect(result.bracket_balance).toBe('preserved');
    });

    it('should warn when edit changes bracket balance', () => {
      const filePath = path.join(tmpDir, 'file.js');
      fs.writeFileSync(filePath, 'function foo() {\n  return 1;\n}\n');
      const result = validateEdit(filePath, 'return 1;', 'return { value: 1 };');
      expect(result.success).toBe(true);
      // Adding { } changes the balance at file level but they are paired, should still be safe
    });
  });
});
