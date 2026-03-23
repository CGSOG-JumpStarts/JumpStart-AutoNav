/**
 * test-contract-first.test.js — Tests for Contract-First Implementation Assistant
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-contract-'));
  fs.mkdirSync(path.join(tmpDir, '.jumpstart', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'specs'), { recursive: true });
  return tmpDir;
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

const {
  extractContracts,
  verifyCompliance,
  CONTRACT_TYPES
} = require('../bin/lib/contract-first.js');

describe('contract-first', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  describe('CONTRACT_TYPES', () => {
    it('should contain all expected contract types', () => {
      expect(CONTRACT_TYPES).toEqual(['rest-api', 'graphql', 'event', 'grpc', 'message-queue']);
    });
  });

  describe('extractContracts', () => {
    it('should return error when architecture spec is missing', () => {
      const result = extractContracts(tmpDir);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Architecture spec not found');
    });

    it('should extract REST API endpoints', () => {
      const archContent = '## API\nGET /api/users\nPOST /api/users\nDELETE /api/users/{id}\n';
      fs.writeFileSync(path.join(tmpDir, 'specs', 'architecture.md'), archContent);
      const result = extractContracts(tmpDir);
      expect(result.success).toBe(true);
      expect(result.total_contracts).toBe(3);
      expect(result.contracts[0].type).toBe('rest-api');
      expect(result.contracts[0].method).toBe('GET');
      expect(result.contracts[0].path).toBe('/api/users');
      expect(result.by_type['rest-api']).toBe(3);
    });

    it('should extract PUT and PATCH endpoints', () => {
      const archContent = 'PUT /api/settings\nPATCH /api/users/{id}\n';
      fs.writeFileSync(path.join(tmpDir, 'specs', 'architecture.md'), archContent);
      const result = extractContracts(tmpDir);
      expect(result.success).toBe(true);
      expect(result.total_contracts).toBe(2);
      expect(result.contracts[0].method).toBe('PUT');
      expect(result.contracts[1].method).toBe('PATCH');
    });

    it('should extract event definitions', () => {
      const archContent = '## Events\nevent: user.created\ntopic: order.placed\n';
      fs.writeFileSync(path.join(tmpDir, 'specs', 'architecture.md'), archContent);
      const result = extractContracts(tmpDir);
      expect(result.success).toBe(true);
      expect(result.contracts.some(c => c.type === 'event' && c.name === 'user.created')).toBe(true);
      expect(result.contracts.some(c => c.type === 'event' && c.name === 'order.placed')).toBe(true);
    });

    it('should return empty contracts for spec with no endpoints or events', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'architecture.md'), '# Architecture\nJust text, no endpoints.');
      const result = extractContracts(tmpDir);
      expect(result.success).toBe(true);
      expect(result.total_contracts).toBe(0);
    });

    it('should include line numbers for contracts', () => {
      const archContent = 'Line 1\nGET /api/health\n';
      fs.writeFileSync(path.join(tmpDir, 'specs', 'architecture.md'), archContent);
      const result = extractContracts(tmpDir);
      expect(result.contracts[0].line).toBeGreaterThan(0);
    });
  });

  describe('verifyCompliance', () => {
    it('should return error when architecture spec is missing', () => {
      const result = verifyCompliance(tmpDir);
      expect(result.success).toBe(false);
    });

    it('should report 100% compliance when no contracts exist', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'architecture.md'), '# No APIs defined');
      const result = verifyCompliance(tmpDir);
      expect(result.success).toBe(true);
      expect(result.compliance).toBe(100);
      expect(result.violations).toBe(0);
    });

    it('should report violations for unimplemented endpoints', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'architecture.md'), 'GET /api/users\nPOST /api/orders\n');
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'app.js'), '// empty implementation');
      const result = verifyCompliance(tmpDir);
      expect(result.success).toBe(true);
      expect(result.violations).toBe(2);
      expect(result.compliance).toBe(0);
    });

    it('should detect implemented endpoints in source', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'architecture.md'), 'GET /api/users\n');
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'routes.js'), "app.get('/api/users', handler);");
      const result = verifyCompliance(tmpDir);
      expect(result.success).toBe(true);
      expect(result.implemented).toBe(1);
      expect(result.violations).toBe(0);
      expect(result.compliance).toBe(100);
    });

    it('should detect implemented events in source', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'architecture.md'), 'event: user.created\n');
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'events.js'), "emit('user.created', data);");
      const result = verifyCompliance(tmpDir);
      expect(result.success).toBe(true);
      expect(result.implemented).toBe(1);
    });

    it('should handle missing src directory gracefully', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'architecture.md'), 'GET /api/test\n');
      const result = verifyCompliance(tmpDir);
      expect(result.success).toBe(true);
      expect(result.violations).toBe(1);
    });
  });
});
