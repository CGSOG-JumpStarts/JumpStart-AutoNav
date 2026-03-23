import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const {
  checkOperation,
  validateFileOperation,
  RISK_RULES,
  PROTECTED_PATHS
} = require('../bin/lib/tool-guardrails.js');

describe('tool-guardrails', () => {
  describe('RISK_RULES', () => {
    it('should be an array of rules with id, pattern, risk', () => {
      expect(Array.isArray(RISK_RULES)).toBe(true);
      for (const rule of RISK_RULES) {
        expect(rule).toHaveProperty('id');
        expect(rule).toHaveProperty('pattern');
        expect(rule).toHaveProperty('risk');
      }
    });
  });

  describe('PROTECTED_PATHS', () => {
    it('should include .env and .git/', () => {
      expect(PROTECTED_PATHS).toContain('.env');
      expect(PROTECTED_PATHS).toContain('.git/');
    });
  });

  describe('checkOperation', () => {
    it('should return error for empty operation', () => {
      const result = checkOperation('');
      expect(result.success).toBe(false);
    });
    it('should detect sudo usage as critical', () => {
      const result = checkOperation('sudo rm something');
      expect(result.success).toBe(true);
      expect(result.risk_level).toBe('critical');
      expect(result.allowed).toBe(false);
    });
    it('should detect recursive delete as critical', () => {
      const result = checkOperation('rm -rf /tmp/stuff');
      expect(result.success).toBe(true);
      expect(result.violations.some(v => v.rule_id === 'recursive-delete')).toBe(true);
    });
    it('should allow safe operations', () => {
      const result = checkOperation('echo hello');
      expect(result.success).toBe(true);
      expect(result.total_violations).toBe(0);
      expect(result.risk_level).toBe('none');
    });
    it('should detect protected path access', () => {
      const result = checkOperation('edit .env file');
      expect(result.violations.some(v => v.rule_id === 'protected-path')).toBe(true);
    });
    it('should detect git force push', () => {
      const result = checkOperation('git push --force origin main');
      expect(result.requires_approval).toBe(true);
    });
    it('should detect network calls', () => {
      const result = checkOperation('curl http://example.com');
      expect(result.violations.some(v => v.rule_id === 'network-call')).toBe(true);
    });
  });

  describe('validateFileOperation', () => {
    it('should allow creating a normal file', () => {
      const result = validateFileOperation('create', 'src/index.js');
      expect(result.success).toBe(true);
      expect(result.allowed).toBe(true);
    });
    it('should block deleting protected paths', () => {
      const result = validateFileOperation('delete', '.env');
      expect(result.allowed).toBe(false);
    });
    it('should warn on editing sensitive files', () => {
      const result = validateFileOperation('edit', 'secrets.env');
      expect(result.warnings.some(w => w.message.includes('sensitive'))).toBe(true);
      expect(result.requires_review).toBe(true);
    });
    it('should warn on large edits', () => {
      const result = validateFileOperation('edit', 'big.js', { lines_changed: 200 });
      expect(result.warnings.some(w => w.message.includes('Large edit'))).toBe(true);
    });
    it('should allow deleting non-protected files', () => {
      const result = validateFileOperation('delete', 'src/temp.js');
      expect(result.allowed).toBe(true);
    });
  });
});
