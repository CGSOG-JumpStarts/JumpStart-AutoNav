/**
 * test-compliance-packs.test.js — Tests for Prebuilt Compliance Control Mappings
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-compliance-'));
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
  listFrameworks,
  applyFramework,
  checkCompliance,
  COMPLIANCE_FRAMEWORKS
} = require('../bin/lib/compliance-packs');

describe('compliance-packs', () => {
  let tmpDir;
  let stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'compliance.json');
  });

  afterEach(() => cleanup(tmpDir));

  describe('constants', () => {
    it('exports compliance frameworks with expected keys', () => {
      const keys = Object.keys(COMPLIANCE_FRAMEWORKS);
      expect(keys).toContain('soc2');
      expect(keys).toContain('iso27001');
      expect(keys).toContain('hipaa');
      expect(keys).toContain('gdpr');
      expect(keys).toContain('eu-ai-act');
    });

    it('each framework has name and controls array', () => {
      for (const [, fw] of Object.entries(COMPLIANCE_FRAMEWORKS)) {
        expect(fw.name).toBeTruthy();
        expect(Array.isArray(fw.controls)).toBe(true);
        expect(fw.controls.length).toBeGreaterThan(0);
      }
    });

    it('each control has id, category, description, and checks', () => {
      for (const [, fw] of Object.entries(COMPLIANCE_FRAMEWORKS)) {
        for (const ctrl of fw.controls) {
          expect(ctrl).toHaveProperty('id');
          expect(ctrl).toHaveProperty('category');
          expect(ctrl).toHaveProperty('description');
          expect(Array.isArray(ctrl.checks)).toBe(true);
        }
      }
    });
  });

  describe('defaultState', () => {
    it('returns fresh state with no applied frameworks', () => {
      const state = defaultState();
      expect(state.version).toBe('1.0.0');
      expect(state.applied_frameworks).toEqual([]);
      expect(state.check_results).toEqual([]);
    });
  });

  describe('loadState / saveState', () => {
    it('returns default state when file does not exist', () => {
      const state = loadState(stateFile);
      expect(state.applied_frameworks).toEqual([]);
    });

    it('round-trips state', () => {
      const state = defaultState();
      state.applied_frameworks.push('soc2');
      saveState(state, stateFile);

      const loaded = loadState(stateFile);
      expect(loaded.applied_frameworks).toContain('soc2');
      expect(loaded.last_updated).toBeTruthy();
    });

    it('returns default state for corrupt file', () => {
      fs.writeFileSync(stateFile, 'corrupt!', 'utf8');
      const state = loadState(stateFile);
      expect(state.version).toBe('1.0.0');
    });
  });

  describe('listFrameworks', () => {
    it('lists all available frameworks', () => {
      const result = listFrameworks();
      expect(result.success).toBe(true);
      expect(result.total).toBe(Object.keys(COMPLIANCE_FRAMEWORKS).length);
      expect(result.frameworks.length).toBe(result.total);
    });

    it('each listed framework has id, name, and controls count', () => {
      const result = listFrameworks();
      for (const fw of result.frameworks) {
        expect(fw).toHaveProperty('id');
        expect(fw).toHaveProperty('name');
        expect(fw).toHaveProperty('controls');
        expect(typeof fw.controls).toBe('number');
      }
    });
  });

  describe('applyFramework', () => {
    it('applies a known framework successfully', () => {
      const result = applyFramework('soc2', { stateFile });
      expect(result.success).toBe(true);
      expect(result.framework).toBe('soc2');
      expect(result.name).toBe('SOC 2 Type II');
      expect(result.controls_added).toBe(COMPLIANCE_FRAMEWORKS.soc2.controls.length);
    });

    it('returns error for unknown framework', () => {
      const result = applyFramework('unknown-fw', { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown framework');
    });

    it('does not duplicate applied frameworks', () => {
      applyFramework('gdpr', { stateFile });
      applyFramework('gdpr', { stateFile });

      const loaded = loadState(stateFile);
      const gdprCount = loaded.applied_frameworks.filter(f => f === 'gdpr').length;
      expect(gdprCount).toBe(1);
    });

    it('tracks total applied count across multiple frameworks', () => {
      applyFramework('soc2', { stateFile });
      const result = applyFramework('hipaa', { stateFile });
      expect(result.total_applied).toBe(2);
    });
  });

  describe('checkCompliance', () => {
    it('returns compliant when no frameworks applied', () => {
      const result = checkCompliance({ stateFile });
      expect(result.success).toBe(true);
      expect(result.compliant).toBe(true);
      expect(result.findings).toEqual([]);
    });

    it('returns findings after applying a framework', () => {
      applyFramework('soc2', { stateFile });
      const result = checkCompliance({ stateFile });
      expect(result.success).toBe(true);
      expect(result.compliant).toBe(false);
      expect(result.total_controls).toBe(COMPLIANCE_FRAMEWORKS.soc2.controls.length);
      expect(result.findings.length).toBe(result.total_controls);
    });

    it('aggregates findings across multiple frameworks', () => {
      applyFramework('soc2', { stateFile });
      applyFramework('gdpr', { stateFile });
      const result = checkCompliance({ stateFile });
      const expectedControls = COMPLIANCE_FRAMEWORKS.soc2.controls.length +
                               COMPLIANCE_FRAMEWORKS.gdpr.controls.length;
      expect(result.total_controls).toBe(expectedControls);
      expect(result.applied_frameworks).toEqual(['soc2', 'gdpr']);
    });

    it('each finding has required fields', () => {
      applyFramework('pci', { stateFile });
      const result = checkCompliance({ stateFile });
      for (const finding of result.findings) {
        expect(finding).toHaveProperty('framework');
        expect(finding).toHaveProperty('control_id');
        expect(finding).toHaveProperty('description');
        expect(finding).toHaveProperty('category');
        expect(finding).toHaveProperty('required_checks');
        expect(finding.status).toBe('needs-review');
      }
    });
  });
});
