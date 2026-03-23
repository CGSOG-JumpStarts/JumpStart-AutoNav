/**
 * test-spec-maturity.test.js — Tests for Spec Maturity Model
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-maturity-'));
  fs.mkdirSync(path.join(tmpDir, 'specs'), { recursive: true });
  return tmpDir;
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

const {
  runMaturityChecks,
  assessMaturity,
  assessFile,
  assessProject,
  MATURITY_LEVELS,
  MATURITY_CRITERIA
} = require('../bin/lib/spec-maturity');

describe('spec-maturity', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  describe('MATURITY_LEVELS', () => {
    it('has 5 levels', () => {
      expect(MATURITY_LEVELS).toHaveLength(5);
    });

    it('levels are ordered by min_score', () => {
      for (let i = 1; i < MATURITY_LEVELS.length; i++) {
        expect(MATURITY_LEVELS[i].min_score).toBeGreaterThan(MATURITY_LEVELS[i - 1].min_score);
      }
    });

    it('includes Draft and Production-Ready', () => {
      expect(MATURITY_LEVELS[0].name).toBe('Draft');
      expect(MATURITY_LEVELS[4].name).toBe('Production-Ready');
    });
  });

  describe('MATURITY_CRITERIA', () => {
    it('has 6 categories', () => {
      expect(Object.keys(MATURITY_CRITERIA)).toHaveLength(6);
    });

    it('weights sum to approximately 1', () => {
      const sum = Object.values(MATURITY_CRITERIA).reduce((s, c) => s + c.weight, 0);
      expect(sum).toBeCloseTo(1.0, 2);
    });

    it('each category has checks', () => {
      for (const [, config] of Object.entries(MATURITY_CRITERIA)) {
        expect(config.checks.length).toBeGreaterThan(0);
      }
    });
  });

  describe('runMaturityChecks', () => {
    it('detects frontmatter', () => {
      const result = runMaturityChecks('---\ntitle: Test\n---\n\n# Title');
      expect(result.has_frontmatter).toBe(true);
    });

    it('detects missing frontmatter', () => {
      const result = runMaturityChecks('# Title\n\nContent');
      expect(result.has_frontmatter).toBe(false);
    });

    it('detects placeholders', () => {
      const result = runMaturityChecks('[TODO] fix this [TBD]');
      expect(result.no_placeholders).toBe(false);
    });

    it('detects approval section', () => {
      const result = runMaturityChecks('## Phase Gate Approval\n\n- [x] Done\n\n**Approved by:** Human');
      expect(result.has_approval).toBe(true);
      expect(result.is_approved).toBe(true);
    });

    it('detects unapproved artifact', () => {
      const result = runMaturityChecks('## Phase Gate Approval\n\n- [ ] Done\n\n**Approved by:** Pending');
      expect(result.is_approved).toBe(false);
    });

    it('detects requirement IDs', () => {
      const result = runMaturityChecks('REQ-001: Feature\nE01-S01: Story');
      expect(result.has_requirement_ids).toBe(true);
    });

    it('detects diagrams', () => {
      const result = runMaturityChecks('```mermaid\nflowchart TD\n```');
      expect(result.has_diagrams).toBe(true);
    });

    it('detects security mentions', () => {
      const result = runMaturityChecks('Security: OAuth2 with encryption');
      expect(result.has_security).toBe(true);
    });
  });

  describe('assessMaturity', () => {
    it('scores draft content at level 1', () => {
      const result = assessMaturity('# Draft\n\n[TODO] stuff');
      expect(result.success).toBe(true);
      expect(result.maturity_level).toBeLessThanOrEqual(2);
      expect(result.maturity_name).toBeTruthy();
    });

    it('scores rich content higher', () => {
      const content = '---\ntitle: Architecture\nversion: 1.0\n---\n\n# Architecture\n\n## Table of Contents\n\n## Overview\n\nDetailed architecture document with specifications.\n\n## Acceptance Criteria\n\nAC-001: System must handle 1000 requests/sec.\n\n```mermaid\nflowchart\n```\n\n```javascript\nconst example = true;\n```\n\n[Link](other.md)\n\nREQ-001: Requirement.\nE01-S01: Story.\n\nSecurity: OAuth2 and encryption.\nCompliance: SOC 2.\nNon-functional requirements defined.\n\n## Phase Gate Approval\n\n- [x] All criteria met\n\n**Approved by:** Human\n**Approval date:** 2026-01-01\n\n' + 'Detailed content section. '.repeat(100);
      const result = assessMaturity(content);
      expect(result.overall_score).toBeGreaterThan(50);
      expect(result.maturity_level).toBeGreaterThanOrEqual(3);
    });

    it('identifies gaps', () => {
      const result = assessMaturity('# Minimal\n\nShort.');
      expect(result.gaps.length).toBeGreaterThan(0);
    });

    it('provides next level info', () => {
      const result = assessMaturity('# Draft\n\nBasic content.\n\n' + 'x'.repeat(1000));
      if (result.maturity_level < 5) {
        expect(result.next_level).toBeTruthy();
        expect(result.next_level.points_needed).toBeGreaterThan(0);
      }
    });
  });

  describe('assessFile', () => {
    it('assesses a file on disk', () => {
      const filePath = path.join(tmpDir, 'specs', 'test.md');
      fs.writeFileSync(filePath, '---\ntitle: Test\n---\n\n# Test\n\n## Section\n\nContent.\n\n' + 'x'.repeat(1100), 'utf8');
      const result = assessFile(filePath);
      expect(result.success).toBe(true);
      expect(result.file).toBe(filePath);
    });

    it('errors for missing file', () => {
      const result = assessFile('/nonexistent.md');
      expect(result.success).toBe(false);
    });
  });

  describe('assessProject', () => {
    it('assesses project artifacts', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'prd.md'),
        '# PRD\n\n## Section\n\nContent.\n\n' + 'x'.repeat(1100), 'utf8');

      const result = assessProject(tmpDir);
      expect(result.success).toBe(true);
      expect(result.artifacts.length).toBeGreaterThan(0);
      expect(result.project_maturity).toBeTruthy();
    });

    it('errors when no specs dir', () => {
      fs.rmSync(path.join(tmpDir, 'specs'), { recursive: true });
      const result = assessProject(tmpDir);
      expect(result.success).toBe(false);
    });
  });
});
