/**
 * Tests for bin/lib/cab-output.js — Change Advisory Board Output Mode (Item 37)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  generateCABSummary,
  CAB_SECTIONS
} = require('../bin/lib/cab-output.js');

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-test-'));
  fs.mkdirSync(path.join(tmpDir, '.jumpstart', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'specs'), { recursive: true });
  return tmpDir;
}
function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

describe('cab-output', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  describe('CAB_SECTIONS', () => {
    it('exports expected sections', () => {
      expect(CAB_SECTIONS).toBeInstanceOf(Array);
      expect(CAB_SECTIONS).toContain('change-description');
      expect(CAB_SECTIONS).toContain('risk-assessment');
      expect(CAB_SECTIONS).toContain('rollback-plan');
      expect(CAB_SECTIONS).toContain('testing-summary');
      expect(CAB_SECTIONS.length).toBe(8);
    });
  });

  describe('generateCABSummary', () => {
    it('returns a summary with all sections when project is empty', () => {
      const result = generateCABSummary(tmpDir);
      expect(result.success).toBe(true);
      expect(result.cab_id).toMatch(/^CAB-/);
      expect(result.sections).toBeDefined();
      expect(result.gaps).toBeInstanceOf(Array);
      expect(result.gaps.length).toBeGreaterThan(0);
    });

    it('detects missing change-description when no prd.md', () => {
      const result = generateCABSummary(tmpDir);
      expect(result.sections['change-description'].present).toBe(false);
      expect(result.gaps).toContain('change-description');
    });

    it('detects change-description from prd.md', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'prd.md'),
        '# My PRD\n\nE01-S01 user story\nE01-S02 another story\n', 'utf8');

      const result = generateCABSummary(tmpDir);
      expect(result.sections['change-description'].present).toBe(true);
      expect(result.sections['change-description'].title).toBe('My PRD');
      expect(result.sections['change-description'].user_stories).toBe(2);
    });

    it('detects risk-assessment from risk-register.json', () => {
      fs.writeFileSync(path.join(tmpDir, '.jumpstart', 'state', 'risk-register.json'),
        JSON.stringify({ risks: [
          { name: 'R1', score: 20 },
          { name: 'R2', score: 5 }
        ] }), 'utf8');

      const result = generateCABSummary(tmpDir);
      expect(result.sections['risk-assessment'].present).toBe(true);
      expect(result.sections['risk-assessment'].total_risks).toBe(2);
      expect(result.sections['risk-assessment'].high_risks).toBe(1);
      expect(result.risk_level).toBe('high');
    });

    it('detects impact-analysis when architecture.md exists', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'architecture.md'), '# Architecture\n', 'utf8');
      const result = generateCABSummary(tmpDir);
      expect(result.sections['impact-analysis'].present).toBe(true);
    });

    it('detects rollback-plan from architecture.md content', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'architecture.md'),
        '# Arch\n\n## Rollback Plan\nRevert to previous version\n', 'utf8');

      const result = generateCABSummary(tmpDir);
      expect(result.sections['rollback-plan'].present).toBe(true);
    });

    it('marks rollback-plan absent when arch has no rollback mention', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'architecture.md'),
        '# Arch\n\n## Overview\nJust a plain design doc\n', 'utf8');

      const result = generateCABSummary(tmpDir);
      expect(result.sections['rollback-plan'].present).toBe(false);
    });

    it('detects testing-summary when tests directory exists', () => {
      fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });
      const result = generateCABSummary(tmpDir);
      expect(result.sections['testing-summary'].present).toBe(true);
    });

    it('detects approval-status from role-approvals.json', () => {
      fs.writeFileSync(path.join(tmpDir, '.jumpstart', 'state', 'role-approvals.json'),
        JSON.stringify({ workflows: {
          'wf1': { status: 'approved' },
          'wf2': { status: 'pending' }
        } }), 'utf8');

      const result = generateCABSummary(tmpDir);
      expect(result.sections['approval-status'].present).toBe(true);
      expect(result.sections['approval-status'].total).toBe(2);
      expect(result.sections['approval-status'].approved).toBe(1);
    });

    it('detects implementation-schedule when plan exists', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'implementation-plan.md'), '# Plan\n', 'utf8');
      const result = generateCABSummary(tmpDir);
      expect(result.sections['implementation-schedule'].present).toBe(true);
    });

    it('calculates completeness and recommendation correctly', () => {
      // Create everything needed for high completeness
      fs.writeFileSync(path.join(tmpDir, 'specs', 'prd.md'), '# PRD\n', 'utf8');
      fs.writeFileSync(path.join(tmpDir, 'specs', 'architecture.md'), '# Arch\n\nRollback strategy\n', 'utf8');
      fs.writeFileSync(path.join(tmpDir, 'specs', 'implementation-plan.md'), '# Plan\n', 'utf8');
      fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.jumpstart', 'state', 'risk-register.json'),
        JSON.stringify({ risks: [] }), 'utf8');
      fs.writeFileSync(path.join(tmpDir, '.jumpstart', 'state', 'role-approvals.json'),
        JSON.stringify({ workflows: {} }), 'utf8');

      const result = generateCABSummary(tmpDir);
      expect(result.completeness).toBeGreaterThanOrEqual(50);
    });

    it('communication-plan is always absent', () => {
      const result = generateCABSummary(tmpDir);
      expect(result.sections['communication-plan'].present).toBe(false);
      expect(result.gaps).toContain('communication-plan');
    });
  });
});
