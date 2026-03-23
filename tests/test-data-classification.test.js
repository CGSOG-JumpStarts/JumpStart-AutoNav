/**
 * test-data-classification.test.js — Tests for Data Classification & Handling Controls
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-dataclass-'));
  fs.mkdirSync(path.join(tmpDir, '.jumpstart', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'specs'), { recursive: true });
  return tmpDir;
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

const {
  defaultState,
  loadState,
  saveState,
  classifyAsset,
  checkCompliance,
  generateReport,
  CLASSIFICATION_LEVELS,
  HANDLING_REQUIREMENTS,
  DATA_TYPE_DEFAULTS
} = require('../bin/lib/data-classification.js');

describe('data-classification', () => {
  let tmpDir;
  let stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'data-classification.json');
  });

  afterEach(() => cleanup(tmpDir));

  describe('constants', () => {
    it('CLASSIFICATION_LEVELS contains expected levels', () => {
      expect(CLASSIFICATION_LEVELS).toEqual(['public', 'internal', 'confidential', 'restricted']);
    });

    it('HANDLING_REQUIREMENTS maps all levels', () => {
      for (const level of CLASSIFICATION_LEVELS) {
        expect(HANDLING_REQUIREMENTS).toHaveProperty(level);
      }
      expect(HANDLING_REQUIREMENTS.restricted.mfa_required).toBe(true);
    });

    it('DATA_TYPE_DEFAULTS maps known types', () => {
      expect(DATA_TYPE_DEFAULTS.PII).toBe('confidential');
      expect(DATA_TYPE_DEFAULTS.PHI).toBe('restricted');
      expect(DATA_TYPE_DEFAULTS.PCI).toBe('restricted');
    });
  });

  describe('defaultState', () => {
    it('returns a valid default state', () => {
      const state = defaultState();
      expect(state.version).toBe('1.0.0');
      expect(state.classifications).toEqual([]);
      expect(state.data_assets).toEqual([]);
    });
  });

  describe('loadState / saveState', () => {
    it('returns default state when file does not exist', () => {
      const state = loadState(stateFile);
      expect(state.data_assets).toEqual([]);
    });

    it('round-trips state correctly', () => {
      const state = defaultState();
      state.data_assets.push({ id: 'DC-001', name: 'test' });
      saveState(state, stateFile);
      const loaded = loadState(stateFile);
      expect(loaded.data_assets).toHaveLength(1);
      expect(loaded.last_updated).toBeTruthy();
    });

    it('returns default state on corrupt JSON', () => {
      fs.writeFileSync(stateFile, '{corrupt', 'utf8');
      const state = loadState(stateFile);
      expect(state.data_assets).toEqual([]);
    });
  });

  describe('classifyAsset', () => {
    it('classifies an asset with no data types as public', () => {
      const result = classifyAsset({ name: 'Homepage' }, { stateFile });
      expect(result.success).toBe(true);
      expect(result.asset.classification).toBe('public');
      expect(result.asset.id).toBe('DC-001');
    });

    it('auto-classifies PII data as confidential', () => {
      const result = classifyAsset(
        { name: 'User DB', data_types: ['PII'] },
        { stateFile }
      );
      expect(result.success).toBe(true);
      expect(result.asset.classification).toBe('confidential');
    });

    it('auto-classifies PHI data as restricted', () => {
      const result = classifyAsset(
        { name: 'Medical Records', data_types: ['PHI'] },
        { stateFile }
      );
      expect(result.success).toBe(true);
      expect(result.asset.classification).toBe('restricted');
      expect(result.asset.handling.mfa_required).toBe(true);
    });

    it('picks highest classification from multiple data types', () => {
      const result = classifyAsset(
        { name: 'Mixed', data_types: ['public-content', 'PII', 'PHI'] },
        { stateFile }
      );
      expect(result.success).toBe(true);
      expect(result.asset.classification).toBe('restricted');
    });

    it('allows manual classification override', () => {
      const result = classifyAsset(
        { name: 'Override', data_types: ['public-content'], classification: 'confidential' },
        { stateFile }
      );
      expect(result.success).toBe(true);
      expect(result.asset.classification).toBe('confidential');
    });

    it('fails when name is missing', () => {
      const result = classifyAsset({}, { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });

    it('fails with null input', () => {
      const result = classifyAsset(null, { stateFile });
      expect(result.success).toBe(false);
    });
  });

  describe('checkCompliance', () => {
    it('returns compliant when no assets', () => {
      const result = checkCompliance({ stateFile });
      expect(result.success).toBe(true);
      expect(result.compliant).toBe(true);
      expect(result.violations).toBe(0);
    });

    it('detects compliance violations for confidential assets', () => {
      classifyAsset({ name: 'SecureDB', data_types: ['PII'] }, { stateFile });
      const result = checkCompliance({ stateFile });
      expect(result.success).toBe(true);
      expect(result.violations).toBeGreaterThan(0);
      expect(result.compliant).toBe(false);
    });

    it('reports no violations for public assets', () => {
      classifyAsset({ name: 'Public Site', data_types: ['public-content'] }, { stateFile });
      const result = checkCompliance({ stateFile });
      expect(result.compliant).toBe(true);
    });
  });

  describe('generateReport', () => {
    it('returns empty report when no assets', () => {
      const result = generateReport({ stateFile });
      expect(result.success).toBe(true);
      expect(result.total_assets).toBe(0);
    });

    it('groups assets by level', () => {
      classifyAsset({ name: 'A', data_types: ['public-content'] }, { stateFile });
      classifyAsset({ name: 'B', data_types: ['PII'] }, { stateFile });
      classifyAsset({ name: 'C', data_types: ['PHI'] }, { stateFile });
      const result = generateReport({ stateFile });
      expect(result.total_assets).toBe(3);
      expect(result.by_level['public']).toBe(1);
      expect(result.by_level['confidential']).toBe(1);
      expect(result.by_level['restricted']).toBe(1);
      expect(result.restricted_assets).toHaveLength(1);
      expect(result.confidential_assets).toHaveLength(1);
    });
  });
});
