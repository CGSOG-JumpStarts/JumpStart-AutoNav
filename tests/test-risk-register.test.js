/**
 * test-risk-register.test.js — Tests for Risk Register Generation & Tracking
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-risk-'));
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
  addRisk,
  updateRisk,
  listRisks,
  generateReport,
  RISK_CATEGORIES,
  RISK_LIKELIHOODS,
  RISK_IMPACTS,
  RISK_STATUSES,
  RISK_SCORE_MATRIX
} = require('../bin/lib/risk-register.js');

describe('risk-register', () => {
  let tmpDir;
  let stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'risk-register.json');
  });

  afterEach(() => cleanup(tmpDir));

  describe('constants', () => {
    it('RISK_CATEGORIES contains expected categories', () => {
      expect(RISK_CATEGORIES).toContain('business');
      expect(RISK_CATEGORIES).toContain('security');
      expect(RISK_CATEGORIES).toContain('technical');
      expect(RISK_CATEGORIES.length).toBe(6);
    });

    it('RISK_SCORE_MATRIX computes expected scores', () => {
      expect(RISK_SCORE_MATRIX['rare']['negligible']).toBe(1);
      expect(RISK_SCORE_MATRIX['almost-certain']['critical']).toBe(25);
      expect(RISK_SCORE_MATRIX['possible']['moderate']).toBe(9);
    });

    it('RISK_STATUSES contains expected statuses', () => {
      expect(RISK_STATUSES).toContain('identified');
      expect(RISK_STATUSES).toContain('resolved');
      expect(RISK_STATUSES).toContain('closed');
    });
  });

  describe('defaultState', () => {
    it('returns a valid default state', () => {
      const state = defaultState();
      expect(state.version).toBe('1.0.0');
      expect(state.risks).toEqual([]);
      expect(state.mitigations).toEqual([]);
    });
  });

  describe('loadState / saveState', () => {
    it('returns default state when file does not exist', () => {
      const state = loadState(stateFile);
      expect(state.risks).toEqual([]);
    });

    it('saves and loads state correctly', () => {
      const state = defaultState();
      state.risks.push({ id: 'RISK-001', title: 'test' });
      saveState(state, stateFile);
      const loaded = loadState(stateFile);
      expect(loaded.risks).toHaveLength(1);
      expect(loaded.last_updated).toBeTruthy();
    });

    it('returns default state on corrupt JSON', () => {
      fs.writeFileSync(stateFile, 'not-json', 'utf8');
      const state = loadState(stateFile);
      expect(state.version).toBe('1.0.0');
    });
  });

  describe('addRisk', () => {
    it('adds a valid risk', () => {
      const result = addRisk(
        { title: 'Data breach', description: 'Potential data exposure', category: 'security', likelihood: 'likely', impact: 'critical' },
        { stateFile }
      );
      expect(result.success).toBe(true);
      expect(result.risk.id).toBe('RISK-001');
      expect(result.risk.score).toBe(RISK_SCORE_MATRIX['likely']['critical']);
      expect(result.risk.status).toBe('identified');
    });

    it('fails when required fields are missing', () => {
      const result = addRisk({}, { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });

    it('fails with null input', () => {
      const result = addRisk(null, { stateFile });
      expect(result.success).toBe(false);
    });

    it('rejects invalid category', () => {
      const result = addRisk(
        { title: 'Test', description: 'Desc', category: 'unknown' },
        { stateFile }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid category');
    });

    it('rejects invalid likelihood', () => {
      const result = addRisk(
        { title: 'Test', description: 'Desc', category: 'technical', likelihood: 'never' },
        { stateFile }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid likelihood');
    });

    it('rejects invalid impact', () => {
      const result = addRisk(
        { title: 'Test', description: 'Desc', category: 'technical', impact: 'huge' },
        { stateFile }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid impact');
    });

    it('uses defaults for optional fields', () => {
      const result = addRisk(
        { title: 'Test', description: 'Desc' },
        { stateFile }
      );
      expect(result.success).toBe(true);
      expect(result.risk.category).toBe('technical');
      expect(result.risk.likelihood).toBe('possible');
      expect(result.risk.impact).toBe('moderate');
    });
  });

  describe('updateRisk', () => {
    it('updates risk status', () => {
      addRisk({ title: 'Test', description: 'Desc' }, { stateFile });
      const result = updateRisk('RISK-001', { status: 'mitigating' }, { stateFile });
      expect(result.success).toBe(true);
      expect(result.risk.status).toBe('mitigating');
    });

    it('updates risk likelihood and recalculates score', () => {
      addRisk({ title: 'Test', description: 'Desc', likelihood: 'rare', impact: 'minor' }, { stateFile });
      const result = updateRisk('RISK-001', { likelihood: 'likely' }, { stateFile });
      expect(result.success).toBe(true);
      expect(result.risk.score).toBe(RISK_SCORE_MATRIX['likely']['minor']);
    });

    it('fails when risk not found', () => {
      const result = updateRisk('RISK-999', { status: 'resolved' }, { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('listRisks', () => {
    beforeEach(() => {
      addRisk({ title: 'R1', description: 'D1', category: 'security', likelihood: 'likely', impact: 'critical' }, { stateFile });
      addRisk({ title: 'R2', description: 'D2', category: 'business', likelihood: 'rare', impact: 'minor' }, { stateFile });
    });

    it('lists all risks', () => {
      const result = listRisks({}, { stateFile });
      expect(result.success).toBe(true);
      expect(result.total).toBe(2);
    });

    it('filters by category', () => {
      const result = listRisks({ category: 'security' }, { stateFile });
      expect(result.total).toBe(1);
      expect(result.risks[0].title).toBe('R1');
    });

    it('filters by minScore', () => {
      const result = listRisks({ minScore: 10 }, { stateFile });
      expect(result.total).toBe(1);
      expect(result.risks[0].title).toBe('R1');
    });
  });

  describe('generateReport', () => {
    it('returns empty report when no risks', () => {
      const result = generateReport({ stateFile });
      expect(result.success).toBe(true);
      expect(result.total_risks).toBe(0);
      expect(result.average_score).toBe(0);
    });

    it('computes report with risks', () => {
      addRisk({ title: 'R1', description: 'D1', category: 'security', likelihood: 'almost-certain', impact: 'critical' }, { stateFile });
      addRisk({ title: 'R2', description: 'D2', category: 'business', likelihood: 'rare', impact: 'minor' }, { stateFile });
      const result = generateReport({ stateFile });
      expect(result.total_risks).toBe(2);
      expect(result.high_risks).toBe(1);
      expect(result.unmitigated).toBe(2);
      expect(result.by_category['security']).toBe(1);
      expect(result.by_category['business']).toBe(1);
      expect(result.top_risks.length).toBeLessThanOrEqual(5);
    });
  });
});
