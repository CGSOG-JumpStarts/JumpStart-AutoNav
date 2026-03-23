/**
 * test-evidence-collector.test.js — Tests for Evidence Collection Automation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-evidence-'));
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
  collectEvidence,
  packageEvidence,
  getStatus,
  EVIDENCE_TYPES
} = require('../bin/lib/evidence-collector');

describe('evidence-collector', () => {
  let tmpDir;
  let stateFile;

  beforeEach(() => {
    tmpDir = createTempProject();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'evidence.json');
  });

  afterEach(() => cleanup(tmpDir));

  describe('constants', () => {
    it('exports evidence types', () => {
      expect(EVIDENCE_TYPES).toContain('test-results');
      expect(EVIDENCE_TYPES).toContain('approval-records');
      expect(EVIDENCE_TYPES).toContain('policy-checks');
      expect(EVIDENCE_TYPES).toContain('architecture-diagrams');
      expect(EVIDENCE_TYPES).toContain('screenshots');
      expect(EVIDENCE_TYPES.length).toBe(9);
    });
  });

  describe('defaultState', () => {
    it('returns a fresh state with empty collections', () => {
      const state = defaultState();
      expect(state.version).toBe('1.0.0');
      expect(state.collections).toEqual([]);
      expect(state.evidence_items).toEqual([]);
    });
  });

  describe('loadState / saveState', () => {
    it('returns default state when file does not exist', () => {
      const state = loadState(stateFile);
      expect(state.collections).toEqual([]);
    });

    it('round-trips state', () => {
      const state = defaultState();
      state.collections.push({ id: 'c1', items_count: 3 });
      saveState(state, stateFile);

      const loaded = loadState(stateFile);
      expect(loaded.collections).toHaveLength(1);
      expect(loaded.last_updated).toBeTruthy();
    });

    it('returns default state for corrupt file', () => {
      fs.writeFileSync(stateFile, '!!!', 'utf8');
      const state = loadState(stateFile);
      expect(state.version).toBe('1.0.0');
    });
  });

  describe('collectEvidence', () => {
    it('collects spec artifacts as architecture evidence', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'architecture.md'), '# Arch', 'utf8');
      fs.writeFileSync(path.join(tmpDir, 'specs', 'prd.md'), '# PRD', 'utf8');

      const result = collectEvidence(tmpDir, { stateFile });
      expect(result.success).toBe(true);
      expect(result.items_collected).toBeGreaterThanOrEqual(2);
      expect(result.types).toContain('architecture-diagrams');
      expect(result.collection_id).toBeTruthy();
    });

    it('collects test-results when tests directory exists', () => {
      fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });

      const result = collectEvidence(tmpDir, { stateFile });
      expect(result.types).toContain('test-results');
    });

    it('collects approval records when file exists', () => {
      const approvalFile = path.join(tmpDir, '.jumpstart', 'state', 'role-approvals.json');
      fs.writeFileSync(approvalFile, '{}', 'utf8');

      const result = collectEvidence(tmpDir, { stateFile });
      expect(result.types).toContain('approval-records');
    });

    it('collects policy checks when policies file exists', () => {
      const policyFile = path.join(tmpDir, '.jumpstart', 'policies.json');
      fs.writeFileSync(policyFile, '{}', 'utf8');

      const result = collectEvidence(tmpDir, { stateFile });
      expect(result.types).toContain('policy-checks');
    });

    it('returns zero items when project is empty', () => {
      // Remove pre-created specs dir so nothing is collected
      fs.rmSync(path.join(tmpDir, 'specs'), { recursive: true, force: true });

      const result = collectEvidence(tmpDir, { stateFile });
      expect(result.success).toBe(true);
      expect(result.items_collected).toBe(0);
    });

    it('accumulates evidence items across multiple collections', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'a.md'), '# A', 'utf8');
      collectEvidence(tmpDir, { stateFile });
      collectEvidence(tmpDir, { stateFile });

      const loaded = loadState(stateFile);
      expect(loaded.collections).toHaveLength(2);
      expect(loaded.evidence_items.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('packageEvidence', () => {
    it('creates an audit manifest file', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'prd.md'), '# PRD', 'utf8');
      collectEvidence(tmpDir, { stateFile });

      const outputDir = path.join(tmpDir, '.jumpstart', 'evidence');
      const result = packageEvidence(tmpDir, { stateFile, outputDir });
      expect(result.success).toBe(true);
      expect(result.package_id).toMatch(/^audit-/);
      expect(fs.existsSync(result.output)).toBe(true);

      const manifest = JSON.parse(fs.readFileSync(result.output, 'utf8'));
      expect(manifest.total_items).toBeGreaterThan(0);
    });

    it('creates output directory if it does not exist', () => {
      const outputDir = path.join(tmpDir, 'new-dir', 'evidence');
      const result = packageEvidence(tmpDir, { stateFile, outputDir });
      expect(result.success).toBe(true);
      expect(fs.existsSync(outputDir)).toBe(true);
    });

    it('packages empty evidence when nothing collected', () => {
      const outputDir = path.join(tmpDir, '.jumpstart', 'evidence');
      const result = packageEvidence(tmpDir, { stateFile, outputDir });
      expect(result.success).toBe(true);
      expect(result.total_items).toBe(0);
    });
  });

  describe('getStatus', () => {
    it('returns status from fresh state', () => {
      const result = getStatus({ stateFile });
      expect(result.success).toBe(true);
      expect(result.total_items).toBe(0);
      expect(result.collections).toBe(0);
      expect(result.last_collection).toBeNull();
    });

    it('reflects collected evidence', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'arch.md'), '# Arch', 'utf8');
      collectEvidence(tmpDir, { stateFile });

      const result = getStatus({ stateFile });
      expect(result.total_items).toBeGreaterThan(0);
      expect(result.collections).toBe(1);
      expect(result.last_collection).toBeTruthy();
      expect(result.types).toContain('architecture-diagrams');
    });
  });
});
