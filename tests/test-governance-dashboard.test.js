/**
 * Tests for bin/lib/governance-dashboard.js — Governance Dashboards for Leadership (Item 40)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  gatherGovernanceData,
  renderDashboardText
} = require('../bin/lib/governance-dashboard.js');

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-test-'));
  fs.mkdirSync(path.join(tmpDir, '.jumpstart', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'specs'), { recursive: true });
  return tmpDir;
}
function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

describe('governance-dashboard', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  describe('gatherGovernanceData', () => {
    it('returns success with empty project', () => {
      const result = gatherGovernanceData(tmpDir);
      expect(result.success).toBe(true);
      expect(result.generated_at).toBeDefined();
      expect(result.project_root).toBe(tmpDir);
      expect(result.governance_score).toBe(0);
    });

    it('returns default section values with no state files', () => {
      const result = gatherGovernanceData(tmpDir);
      expect(result.sections.policies).toEqual({ total: 0, enabled: 0 });
      expect(result.sections.waivers).toEqual({ total: 0, pending: 0, approved: 0, expired: 0 });
      expect(result.sections.security).toEqual({ findings: 0, critical: 0, high: 0 });
      expect(result.sections.risks).toEqual({ total: 0, high: 0, unmitigated: 0 });
      expect(result.sections.compliance).toEqual({ frameworks: 0, frameworks_list: [] });
      expect(result.sections.readiness.level).toBe('Not assessed');
      expect(result.sections.environment.current).toBe('unknown');
    });

    it('reads policies from policies.json', () => {
      fs.writeFileSync(path.join(tmpDir, '.jumpstart', 'policies.json'),
        JSON.stringify({ policies: [
          { name: 'p1', enabled: true },
          { name: 'p2', enabled: false },
          { name: 'p3' }
        ] }), 'utf8');

      const result = gatherGovernanceData(tmpDir);
      expect(result.sections.policies.total).toBe(3);
      expect(result.sections.policies.enabled).toBe(2); // p1 + p3 (enabled !== false)
    });

    it('reads waivers from state', () => {
      fs.writeFileSync(path.join(tmpDir, '.jumpstart', 'state', 'waivers.json'),
        JSON.stringify({ waivers: [
          { id: 'w1', status: 'pending' },
          { id: 'w2', status: 'approved' },
          { id: 'w3', status: 'expired' }
        ] }), 'utf8');

      const result = gatherGovernanceData(tmpDir);
      expect(result.sections.waivers.total).toBe(3);
      expect(result.sections.waivers.pending).toBe(1);
      expect(result.sections.waivers.approved).toBe(1);
      expect(result.sections.waivers.expired).toBe(1);
    });

    it('reads risks from risk-register.json', () => {
      fs.writeFileSync(path.join(tmpDir, '.jumpstart', 'state', 'risk-register.json'),
        JSON.stringify({ risks: [
          { name: 'r1', score: 20, status: 'identified' },
          { name: 'r2', score: 5, mitigation: 'done', status: 'mitigated' },
          { name: 'r3', score: 10, status: 'identified' }
        ] }), 'utf8');

      const result = gatherGovernanceData(tmpDir);
      expect(result.sections.risks.total).toBe(3);
      expect(result.sections.risks.high).toBe(1); // score >= 15
      expect(result.sections.risks.unmitigated).toBe(2); // r1 and r3
    });

    it('reads compliance frameworks', () => {
      fs.writeFileSync(path.join(tmpDir, '.jumpstart', 'state', 'compliance.json'),
        JSON.stringify({ applied_frameworks: ['SOC2', 'GDPR'] }), 'utf8');

      const result = gatherGovernanceData(tmpDir);
      expect(result.sections.compliance.frameworks).toBe(2);
      expect(result.sections.compliance.frameworks_list).toEqual(['SOC2', 'GDPR']);
    });

    it('reads release readiness', () => {
      fs.writeFileSync(path.join(tmpDir, '.jumpstart', 'state', 'release-readiness.json'),
        JSON.stringify({ current_readiness: {
          total_score: 85,
          level: 'Ready',
          recommendation: 'Ship it'
        } }), 'utf8');

      const result = gatherGovernanceData(tmpDir);
      expect(result.sections.readiness.score).toBe(85);
      expect(result.sections.readiness.level).toBe('Ready');
      expect(result.sections.readiness.recommendation).toBe('Ship it');
    });

    it('reads environment promotion state', () => {
      fs.writeFileSync(path.join(tmpDir, '.jumpstart', 'state', 'environment-promotion.json'),
        JSON.stringify({
          current_environment: 'staging',
          promotion_history: [{ from: 'dev', to: 'staging' }]
        }), 'utf8');

      const result = gatherGovernanceData(tmpDir);
      expect(result.sections.environment.current).toBe('staging');
      expect(result.sections.environment.promotions).toBe(1);
    });

    it('calculates governance score from multiple sections', () => {
      fs.writeFileSync(path.join(tmpDir, '.jumpstart', 'policies.json'),
        JSON.stringify({ policies: [{ name: 'p1' }] }), 'utf8');
      fs.writeFileSync(path.join(tmpDir, '.jumpstart', 'state', 'compliance.json'),
        JSON.stringify({ applied_frameworks: ['SOC2'] }), 'utf8');

      const result = gatherGovernanceData(tmpDir);
      expect(result.governance_score).toBeGreaterThan(0);
    });

    it('handles corrupted policies.json gracefully', () => {
      fs.writeFileSync(path.join(tmpDir, '.jumpstart', 'policies.json'), 'broken!', 'utf8');
      const result = gatherGovernanceData(tmpDir);
      expect(result.sections.policies).toEqual({ total: 0, enabled: 0 });
    });

    it('handles corrupted risk-register.json gracefully', () => {
      fs.writeFileSync(path.join(tmpDir, '.jumpstart', 'state', 'risk-register.json'), '{bad}', 'utf8');
      const result = gatherGovernanceData(tmpDir);
      expect(result.sections.risks).toEqual({ total: 0, high: 0, unmitigated: 0 });
    });
  });

  describe('renderDashboardText', () => {
    it('renders dashboard text from gathered data', () => {
      const data = gatherGovernanceData(tmpDir);
      const text = renderDashboardText(data);
      expect(text).toContain('Governance Dashboard');
      expect(text).toContain('Governance Score:');
      expect(text).toContain('Policies:');
      expect(text).toContain('Waivers:');
      expect(text).toContain('Risks:');
    });

    it('includes all section fields in output', () => {
      fs.writeFileSync(path.join(tmpDir, '.jumpstart', 'policies.json'),
        JSON.stringify({ policies: [{ name: 'p1' }] }), 'utf8');
      fs.writeFileSync(path.join(tmpDir, '.jumpstart', 'state', 'compliance.json'),
        JSON.stringify({ applied_frameworks: ['SOC2'] }), 'utf8');

      const data = gatherGovernanceData(tmpDir);
      const text = renderDashboardText(data);
      expect(text).toContain('Compliance:');
      expect(text).toContain('Readiness:');
      expect(text).toContain('Environment:');
    });

    it('renders with populated data correctly', () => {
      const data = {
        generated_at: '2024-01-01T00:00:00Z',
        governance_score: 75,
        sections: {
          policies: { total: 3, enabled: 2 },
          waivers: { total: 1, pending: 1, approved: 0, expired: 0 },
          risks: { total: 5, high: 1, unmitigated: 2 },
          compliance: { frameworks: 2 },
          readiness: { score: 80, level: 'Ready' },
          environment: { current: 'staging' }
        }
      };

      const text = renderDashboardText(data);
      expect(text).toContain('75%');
      expect(text).toContain('3 (2 enabled)');
      expect(text).toContain('1 (1 pending');
      expect(text).toContain('5 (1 high');
      expect(text).toContain('staging');
    });
  });
});
