/**
 * test-raci-matrix.test.js — Tests for RACI-Aware Approvals
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-raci-'));
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
  defineAssignment,
  checkPermission,
  generateReport,
  RACI_ROLES,
  DEFAULT_PHASES,
  DEFAULT_ARTIFACTS
} = require('../bin/lib/raci-matrix');

describe('raci-matrix', () => {
  let tmpDir;
  let stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'raci-matrix.json');
  });

  afterEach(() => cleanup(tmpDir));

  describe('constants', () => {
    it('exports RACI roles', () => {
      expect(RACI_ROLES).toEqual(['responsible', 'accountable', 'consulted', 'informed']);
    });

    it('exports default phases', () => {
      expect(DEFAULT_PHASES).toContain('developer');
      expect(DEFAULT_PHASES).toContain('architect');
      expect(DEFAULT_PHASES.length).toBe(6);
    });

    it('exports default artifacts', () => {
      expect(DEFAULT_ARTIFACTS.length).toBeGreaterThan(0);
      for (const a of DEFAULT_ARTIFACTS) {
        expect(a).toMatch(/^specs\//);
      }
    });
  });

  describe('defaultState', () => {
    it('returns a fresh state with empty assignments', () => {
      const state = defaultState();
      expect(state.version).toBe('1.0.0');
      expect(state.assignments).toEqual({});
      expect(state.stakeholders).toEqual([]);
    });
  });

  describe('loadState / saveState', () => {
    it('returns default state when file does not exist', () => {
      const state = loadState(stateFile);
      expect(state.assignments).toEqual({});
    });

    it('round-trips state', () => {
      const state = defaultState();
      state.stakeholders.push('alice');
      saveState(state, stateFile);

      const loaded = loadState(stateFile);
      expect(loaded.stakeholders).toContain('alice');
      expect(loaded.last_updated).toBeTruthy();
    });

    it('returns default state for corrupt JSON', () => {
      fs.writeFileSync(stateFile, '{{bad}}', 'utf8');
      const state = loadState(stateFile);
      expect(state.version).toBe('1.0.0');
    });
  });

  describe('defineAssignment', () => {
    it('defines a RACI assignment for an artifact', () => {
      const result = defineAssignment('specs/prd.md', {
        responsible: 'pm',
        accountable: 'lead',
        consulted: ['architect'],
        informed: ['dev']
      }, { stateFile });

      expect(result.success).toBe(true);
      expect(result.artifact).toBe('specs/prd.md');
      expect(result.assignment.responsible).toBe('pm');
      expect(result.assignment.accountable).toBe('lead');
    });

    it('defaults responsible to accountable if not provided', () => {
      const result = defineAssignment('specs/architecture.md', {
        accountable: 'architect'
      }, { stateFile });

      expect(result.success).toBe(true);
      expect(result.assignment.responsible).toBe('architect');
    });

    it('returns error when artifact is missing', () => {
      const result = defineAssignment('', { accountable: 'lead' }, { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('artifact is required');
    });

    it('returns error when accountable is missing', () => {
      const result = defineAssignment('specs/prd.md', {}, { stateFile });
      expect(result.success).toBe(false);
      expect(result.error).toContain('accountable is required');
    });

    it('tracks stakeholders across assignments', () => {
      defineAssignment('specs/prd.md', {
        accountable: 'lead',
        consulted: ['alice'],
        informed: ['bob']
      }, { stateFile });

      defineAssignment('specs/architecture.md', {
        accountable: 'architect',
        consulted: ['alice', 'charlie']
      }, { stateFile });

      const loaded = loadState(stateFile);
      expect(loaded.stakeholders).toContain('lead');
      expect(loaded.stakeholders).toContain('alice');
      expect(loaded.stakeholders).toContain('bob');
      expect(loaded.stakeholders).toContain('architect');
      expect(loaded.stakeholders).toContain('charlie');
    });
  });

  describe('checkPermission', () => {
    it('allows approval when actor is accountable', () => {
      defineAssignment('specs/prd.md', {
        accountable: 'lead',
        responsible: 'pm'
      }, { stateFile });

      const result = checkPermission('specs/prd.md', 'lead', 'approve', { stateFile });
      expect(result.success).toBe(true);
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('Accountable');
    });

    it('allows approval when actor is responsible', () => {
      defineAssignment('specs/prd.md', {
        accountable: 'lead',
        responsible: 'pm'
      }, { stateFile });

      const result = checkPermission('specs/prd.md', 'pm', 'approve', { stateFile });
      expect(result.allowed).toBe(true);
    });

    it('denies approval to non R/A actors', () => {
      defineAssignment('specs/prd.md', {
        accountable: 'lead',
        responsible: 'pm',
        consulted: ['dev']
      }, { stateFile });

      const result = checkPermission('specs/prd.md', 'dev', 'approve', { stateFile });
      expect(result.allowed).toBe(false);
    });

    it('allows review for consulted actors', () => {
      defineAssignment('specs/prd.md', {
        accountable: 'lead',
        consulted: ['reviewer']
      }, { stateFile });

      const result = checkPermission('specs/prd.md', 'reviewer', 'review', { stateFile });
      expect(result.allowed).toBe(true);
    });

    it('denies review to non C/R/A actors', () => {
      defineAssignment('specs/prd.md', {
        accountable: 'lead',
        informed: ['observer']
      }, { stateFile });

      const result = checkPermission('specs/prd.md', 'observer', 'review', { stateFile });
      expect(result.allowed).toBe(false);
    });

    it('allows anything when no assignment is defined', () => {
      const result = checkPermission('specs/unknown.md', 'anyone', 'approve', { stateFile });
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('unrestricted');
    });
  });

  describe('generateReport', () => {
    it('returns empty matrix for fresh state', () => {
      const result = generateReport({ stateFile });
      expect(result.success).toBe(true);
      expect(result.matrix).toHaveLength(0);
      expect(result.gaps.length).toBe(DEFAULT_ARTIFACTS.length);
      expect(result.coverage).toBe(0);
    });

    it('reports coverage after assignments', () => {
      defineAssignment('specs/prd.md', { accountable: 'lead' }, { stateFile });
      defineAssignment('specs/architecture.md', { accountable: 'arch' }, { stateFile });

      const result = generateReport({ stateFile });
      expect(result.matrix).toHaveLength(2);
      expect(result.total_assignments).toBe(2);
      expect(result.coverage).toBeGreaterThan(0);
      expect(result.gaps.length).toBe(DEFAULT_ARTIFACTS.length - 2);
    });

    it('includes stakeholder list', () => {
      defineAssignment('specs/prd.md', {
        accountable: 'lead',
        consulted: ['alice']
      }, { stateFile });

      const result = generateReport({ stateFile });
      expect(result.stakeholders).toContain('lead');
      expect(result.stakeholders).toContain('alice');
    });
  });
});
