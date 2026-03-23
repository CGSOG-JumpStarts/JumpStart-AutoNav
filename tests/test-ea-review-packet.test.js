/**
 * test-ea-review-packet.test.js — Tests for Enterprise Architecture Review Packet
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-ea-'));
  fs.mkdirSync(path.join(tmpDir, '.jumpstart', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'specs', 'decisions'), { recursive: true });
  return tmpDir;
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

const {
  generatePacket,
  PACKET_SECTIONS
} = require('../bin/lib/ea-review-packet.js');

describe('ea-review-packet', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => cleanup(tmpDir));

  describe('constants', () => {
    it('PACKET_SECTIONS contains expected sections', () => {
      expect(PACKET_SECTIONS).toContain('architecture-overview');
      expect(PACKET_SECTIONS).toContain('decision-summary');
      expect(PACKET_SECTIONS).toContain('risk-assessment');
      expect(PACKET_SECTIONS).toContain('diagrams');
      expect(PACKET_SECTIONS.length).toBe(7);
    });
  });

  describe('generatePacket', () => {
    it('generates packet with no artifacts present', () => {
      const result = generatePacket(tmpDir);
      expect(result.success).toBe(true);
      expect(result.packet_id).toMatch(/^EA-/);
      expect(result.sections_total).toBe(PACKET_SECTIONS.length);
      expect(result.gaps.length).toBeGreaterThan(0);
    });

    it('detects architecture.md overview', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'specs', 'architecture.md'),
        '## Overview\nSome content\n## Technology Stack\nMore content',
        'utf8'
      );
      const result = generatePacket(tmpDir);
      expect(result.sections['architecture-overview'].present).toBe(true);
      expect(result.sections['architecture-overview'].sections).toContain('Overview');
      expect(result.sections['architecture-overview'].sections).toContain('Technology Stack');
      expect(result.sections['architecture-overview'].word_count).toBeGreaterThan(0);
    });

    it('detects ADRs in decisions directory', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'decisions', 'ADR-001.md'), '# ADR 001', 'utf8');
      fs.writeFileSync(path.join(tmpDir, 'specs', 'decisions', 'ADR-002.md'), '# ADR 002', 'utf8');
      const result = generatePacket(tmpDir);
      expect(result.sections['decision-summary'].present).toBe(true);
      expect(result.sections['decision-summary'].total_adrs).toBe(2);
    });

    it('detects empty decisions directory', () => {
      const result = generatePacket(tmpDir);
      expect(result.sections['decision-summary'].present).toBe(false);
      expect(result.sections['decision-summary'].total_adrs).toBe(0);
    });

    it('detects mermaid diagrams in architecture.md', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'specs', 'architecture.md'),
        '## Diagrams\n```mermaid\ngraph TD\nA-->B\n```\n\n```mermaid\nsequenceDiagram\nA->>B: hello\n```',
        'utf8'
      );
      const result = generatePacket(tmpDir);
      expect(result.sections.diagrams.present).toBe(true);
      expect(result.sections.diagrams.count).toBe(2);
    });

    it('detects risk assessment from risk-register.json', () => {
      const riskState = {
        risks: [
          { id: 'RISK-001', title: 'Test', score: 20 },
          { id: 'RISK-002', title: 'Low', score: 3 }
        ]
      };
      fs.writeFileSync(
        path.join(tmpDir, '.jumpstart', 'state', 'risk-register.json'),
        JSON.stringify(riskState),
        'utf8'
      );
      const result = generatePacket(tmpDir);
      expect(result.sections['risk-assessment'].present).toBe(true);
      expect(result.sections['risk-assessment'].total_risks).toBe(2);
      expect(result.sections['risk-assessment'].high_risks).toBe(1);
    });

    it('detects standards alignment from policies.json', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.jumpstart', 'policies.json'),
        JSON.stringify({ policies: [{ id: 'P1' }, { id: 'P2' }] }),
        'utf8'
      );
      const result = generatePacket(tmpDir);
      expect(result.sections['standards-alignment'].present).toBe(true);
      expect(result.sections['standards-alignment'].total_policies).toBe(2);
    });

    it('detects compliance status', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.jumpstart', 'state', 'compliance.json'),
        JSON.stringify({ applied_frameworks: ['SOC2', 'HIPAA'] }),
        'utf8'
      );
      const result = generatePacket(tmpDir);
      expect(result.sections['compliance-status'].present).toBe(true);
      expect(result.sections['compliance-status'].frameworks).toEqual(['SOC2', 'HIPAA']);
    });

    it('calculates completeness percentage', () => {
      fs.writeFileSync(path.join(tmpDir, 'specs', 'architecture.md'), '## Overview\nContent', 'utf8');
      fs.writeFileSync(path.join(tmpDir, 'specs', 'decisions', 'ADR-001.md'), '# ADR', 'utf8');
      const result = generatePacket(tmpDir);
      expect(result.completeness).toBeGreaterThan(0);
      expect(result.sections_present).toBeGreaterThanOrEqual(2);
    });
  });
});
