/**
 * test-ai-intake.test.js — Tests for AI Use Case Intake Templates
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-ai-intake-'));
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
  createIntake,
  listIntakes,
  assessIntake,
  INTAKE_SECTIONS,
  RISK_TIERS
} = require('../bin/lib/ai-intake.js');

describe('ai-intake', () => {
  let tmpDir;
  let stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'ai-intake.json');
  });

  afterEach(() => cleanup(tmpDir));

  describe('constants', () => {
    it('INTAKE_SECTIONS contains expected sections', () => {
      expect(INTAKE_SECTIONS).toContain('business-value');
      expect(INTAKE_SECTIONS).toContain('data-sensitivity');
      expect(INTAKE_SECTIONS).toContain('model-risk');
      expect(INTAKE_SECTIONS).toContain('ethical-review');
      expect(INTAKE_SECTIONS.length).toBe(6);
    });

    it('RISK_TIERS has 4 tiers', () => {
      expect(RISK_TIERS).toHaveLength(4);
      expect(RISK_TIERS[0].tier).toBe(1);
      expect(RISK_TIERS[3].tier).toBe(4);
      expect(RISK_TIERS[3].label).toBe('Critical Risk');
    });
  });

  describe('defaultState', () => {
    it('returns a valid default state', () => {
      const state = defaultState();
      expect(state.version).toBe('1.0.0');
      expect(state.intakes).toEqual([]);
      expect(state.last_updated).toBeNull();
    });
  });

  describe('loadState / saveState', () => {
    it('returns default state when file does not exist', () => {
      const state = loadState(stateFile);
      expect(state.intakes).toEqual([]);
    });

    it('round-trips state correctly', () => {
      const state = defaultState();
      state.intakes.push({ id: 'AI-001', name: 'test' });
      saveState(state, stateFile);
      const loaded = loadState(stateFile);
      expect(loaded.intakes).toHaveLength(1);
      expect(loaded.last_updated).toBeTruthy();
    });

    it('returns default state on corrupt JSON', () => {
      fs.writeFileSync(stateFile, 'corrupt!', 'utf8');
      const state = loadState(stateFile);
      expect(state.intakes).toEqual([]);
    });
  });

  describe('createIntake', () => {
    it('creates a valid intake', () => {
      const result = createIntake(
        { name: 'Chatbot', description: 'Customer support chatbot', sponsor: 'VP Eng' },
        { stateFile }
      );
      expect(result.success).toBe(true);
      expect(result.intake.id).toBe('AI-001');
      expect(result.intake.name).toBe('Chatbot');
      expect(result.intake.status).toBe('draft');
      expect(result.intake.risk_tier).toBe(1);
      expect(result.intake.risk_label).toBe('Low Risk');
    });

    it('auto-assigns tier 4 for PHI data', () => {
      const result = createIntake(
        { name: 'Medical AI', description: 'Health records analysis', data_types: ['PHI'] },
        { stateFile }
      );
      expect(result.success).toBe(true);
      expect(result.intake.risk_tier).toBe(4);
      expect(result.intake.risk_label).toBe('Critical Risk');
    });

    it('auto-assigns tier 3 for PII data', () => {
      const result = createIntake(
        { name: 'User AI', description: 'User analysis', data_types: ['PII'] },
        { stateFile }
      );
      expect(result.success).toBe(true);
      expect(result.intake.risk_tier).toBe(3);
    });

    it('auto-assigns tier 2 for business-sensitive data', () => {
      const result = createIntake(
        { name: 'Biz AI', description: 'Business tool', data_types: ['business-sensitive'] },
        { stateFile }
      );
      expect(result.success).toBe(true);
      expect(result.intake.risk_tier).toBe(2);
    });

    it('picks highest tier from mixed data types', () => {
      const result = createIntake(
        { name: 'Mixed', description: 'Mixed data', data_types: ['internal', 'PCI'] },
        { stateFile }
      );
      expect(result.success).toBe(true);
      expect(result.intake.risk_tier).toBe(4);
    });

    it('fails when required fields are missing', () => {
      const result = createIntake({}, { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });

    it('fails with null input', () => {
      const result = createIntake(null, { stateFile });
      expect(result.success).toBe(false);
    });
  });

  describe('listIntakes', () => {
    beforeEach(() => {
      createIntake({ name: 'A', description: 'D1', data_types: ['PII'] }, { stateFile });
      createIntake({ name: 'B', description: 'D2' }, { stateFile });
    });

    it('lists all intakes', () => {
      const result = listIntakes({}, { stateFile });
      expect(result.success).toBe(true);
      expect(result.total).toBe(2);
    });

    it('filters by status', () => {
      const result = listIntakes({ status: 'draft' }, { stateFile });
      expect(result.total).toBe(2);
    });

    it('filters by risk_tier', () => {
      const result = listIntakes({ risk_tier: 3 }, { stateFile });
      expect(result.total).toBe(1);
      expect(result.intakes[0].name).toBe('A');
    });
  });

  describe('assessIntake', () => {
    it('assesses an intake with no sections completed', () => {
      createIntake({ name: 'Test', description: 'Desc' }, { stateFile });
      const result = assessIntake('AI-001', { stateFile });
      expect(result.success).toBe(true);
      expect(result.completeness).toBe(0);
      expect(result.missing_sections).toEqual(INTAKE_SECTIONS);
      expect(result.ready_for_review).toBe(false);
    });

    it('assesses an intake with some sections completed', () => {
      createIntake({ name: 'Test', description: 'Desc' }, { stateFile });
      // Manually update state to add completed sections
      const state = loadState(stateFile);
      state.intakes[0].sections_completed = ['business-value', 'data-sensitivity', 'model-risk', 'operating-model', 'ethical-review'];
      saveState(state, stateFile);
      const result = assessIntake('AI-001', { stateFile });
      expect(result.completeness).toBe(83);
      expect(result.ready_for_review).toBe(true);
      expect(result.missing_sections).toEqual(['compliance-requirements']);
    });

    it('fails when intake not found', () => {
      const result = assessIntake('AI-999', { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });
});
