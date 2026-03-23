/**
 * test-delivery-confidence.test.js — Tests for Delivery Confidence Scoring
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-confidence-'));
  fs.mkdirSync(path.join(tmpDir, 'specs'), { recursive: true });
  return tmpDir;
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

const {
  analyzeCompleteness,
  analyzeRisk,
  analyzeAmbiguity,
  analyzeQuality,
  analyzeEnterpriseReadiness,
  scoreConfidence,
  scoreFile,
  scoreProject,
  DIMENSIONS,
  WEIGHT_DEFAULTS,
  CONFIDENCE_LEVELS
} = require('../bin/lib/delivery-confidence');

describe('delivery-confidence', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  describe('DIMENSIONS', () => {
    it('has 5 dimensions', () => {
      expect(DIMENSIONS).toHaveLength(5);
      expect(DIMENSIONS).toContain('completeness');
      expect(DIMENSIONS).toContain('risk');
    });
  });

  describe('WEIGHT_DEFAULTS', () => {
    it('weights sum to 1', () => {
      const sum = Object.values(WEIGHT_DEFAULTS).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 2);
    });
  });

  describe('CONFIDENCE_LEVELS', () => {
    it('has 5 levels', () => {
      expect(CONFIDENCE_LEVELS).toHaveLength(5);
      expect(CONFIDENCE_LEVELS[0].label).toBe('Very High');
    });
  });

  describe('analyzeCompleteness', () => {
    it('scores high for complete content', () => {
      const content = '---\ntitle: Test\n---\n\n# Title\n\n## Section A\n\nDetailed content here that is long enough.\n\n## Section B\n\nMore content.\n\n## Phase Gate Approval\n\n- [x] Done\n\n' + 'x'.repeat(500);
      const result = analyzeCompleteness(content, 'prd');
      expect(result.score).toBeGreaterThan(50);
    });

    it('scores low for incomplete content', () => {
      const result = analyzeCompleteness('[TODO] placeholder [TBD]', 'prd');
      expect(result.score).toBeLessThan(50);
      expect(result.placeholders_found).toBeGreaterThan(0);
    });
  });

  describe('analyzeRisk', () => {
    it('scores higher when risks identified and mitigated', () => {
      const content = '## Risk Assessment\n\nRisk: Data loss possible.\nMitigation: Daily backups.';
      const result = analyzeRisk(content);
      expect(result.has_risk_section).toBe(true);
      expect(result.has_mitigations).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(80);
    });

    it('scores lower when no risks identified', () => {
      const result = analyzeRisk('Simple text about a basic feature.');
      expect(result.score).toBeLessThan(50);
    });
  });

  describe('analyzeAmbiguity', () => {
    it('scores high for precise language', () => {
      const content = 'The system will process 1000 requests per second. Authentication uses JWT tokens. Response time must be under 200ms.';
      const result = analyzeAmbiguity(content);
      expect(result.score).toBeGreaterThan(70);
    });

    it('scores lower for ambiguous language', () => {
      const content = 'The system should possibly maybe handle some requests. It could potentially do TBD things as needed etc and so on.';
      const result = analyzeAmbiguity(content);
      expect(result.total_ambiguous).toBeGreaterThan(0);
    });
  });

  describe('analyzeQuality', () => {
    it('identifies quality indicators', () => {
      const content = '## Acceptance Criteria\n\nAC-001: Test cases.\n\n```mermaid\nflowchart\n```\n\n[Link](other.md)\n\n```javascript\ncode example\n```\n\nREQ-001 traceability.';
      const result = analyzeQuality(content, '.');
      expect(result.score).toBeGreaterThan(50);
    });

    it('flags missing quality indicators', () => {
      const result = analyzeQuality('Minimal content.', '.');
      expect(result.gaps.length).toBeGreaterThan(0);
    });
  });

  describe('analyzeEnterpriseReadiness', () => {
    it('scores high for enterprise-ready content', () => {
      const content = 'Security: OAuth2 + RBAC. Scalability: horizontal scaling. Compliance: SOC 2 Type II. Monitoring: Prometheus + Grafana. Deploy via CI/CD pipeline. Documentation maintained.';
      const result = analyzeEnterpriseReadiness(content);
      expect(result.score).toBeGreaterThan(80);
    });

    it('identifies enterprise gaps', () => {
      const result = analyzeEnterpriseReadiness('Basic feature description.');
      expect(result.gaps.length).toBeGreaterThan(0);
    });
  });

  describe('scoreConfidence', () => {
    it('returns overall score with all dimensions', () => {
      const content = '---\ntitle: Test\n---\n\n# Architecture\n\n## Section\n\nDetailed content.\n\n## Risk\n\nRisk identified. Mitigation in place.\n\n## Acceptance Criteria\n\n```mermaid\nflowchart\n```\n\nSecurity: auth. Deploy: CI/CD.\n\n## Phase Gate Approval\n\n- [x] Done\n\n' + 'x'.repeat(500);
      const result = scoreConfidence(content);
      expect(result.success).toBe(true);
      expect(result.overall_score).toBeGreaterThanOrEqual(0);
      expect(result.overall_score).toBeLessThanOrEqual(100);
      expect(result.confidence_level).toBeTruthy();
      expect(result.dimensions).toHaveProperty('completeness');
      expect(result.dimensions).toHaveProperty('risk');
    });
  });

  describe('scoreFile', () => {
    it('scores a file on disk', () => {
      const filePath = path.join(tmpDir, 'specs', 'test.md');
      fs.writeFileSync(filePath, '# Test\n\n## Content\n\nDetails here.\n\n' + 'x'.repeat(600), 'utf8');
      const result = scoreFile(filePath);
      expect(result.success).toBe(true);
      expect(result.file).toBe(filePath);
    });

    it('errors for missing file', () => {
      const result = scoreFile('/nonexistent.md');
      expect(result.success).toBe(false);
    });
  });

  describe('scoreProject', () => {
    it('scores all project artifacts', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'prd.md'), '# PRD\n\n## Content\n\nDetails.\n\n' + 'x'.repeat(600), 'utf8');
      const result = scoreProject(tmpDir);
      expect(result.success).toBe(true);
      expect(result.artifacts.length).toBeGreaterThan(0);
    });

    it('errors when no specs dir', () => {
      fs.rmSync(path.join(tmpDir, 'specs'), { recursive: true });
      const result = scoreProject(tmpDir);
      expect(result.success).toBe(false);
    });
  });
});
