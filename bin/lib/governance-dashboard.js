/**
 * governance-dashboard.js — Governance Dashboards for Leadership (Item 40)
 *
 * Show policy violations, open waivers, security findings,
 * readiness trends, and delivery risk.
 *
 * Usage:
 *   node bin/lib/governance-dashboard.js [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Gather governance dashboard data from project state files.
 *
 * @param {string} root - Project root.
 * @param {object} [options]
 * @returns {object}
 */
function gatherGovernanceData(root, options = {}) {
  const data = {
    generated_at: new Date().toISOString(),
    project_root: root,
    sections: {}
  };

  // Policy violations
  const policyFile = path.join(root, '.jumpstart', 'policies.json');
  if (fs.existsSync(policyFile)) {
    try {
      const policies = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
      data.sections.policies = {
        total: policies.policies ? policies.policies.length : 0,
        enabled: (policies.policies || []).filter(p => p.enabled !== false).length
      };
    } catch { data.sections.policies = { total: 0, enabled: 0 }; }
  } else {
    data.sections.policies = { total: 0, enabled: 0 };
  }

  // Open waivers
  const waiverFile = path.join(root, '.jumpstart', 'state', 'waivers.json');
  if (fs.existsSync(waiverFile)) {
    try {
      const waivers = JSON.parse(fs.readFileSync(waiverFile, 'utf8'));
      const all = waivers.waivers || [];
      data.sections.waivers = {
        total: all.length,
        pending: all.filter(w => w.status === 'pending').length,
        approved: all.filter(w => w.status === 'approved').length,
        expired: all.filter(w => w.status === 'expired').length
      };
    } catch { data.sections.waivers = { total: 0, pending: 0, approved: 0, expired: 0 }; }
  } else {
    data.sections.waivers = { total: 0, pending: 0, approved: 0, expired: 0 };
  }

  // Security findings
  data.sections.security = { findings: 0, critical: 0, high: 0 };

  // Risk register
  const riskFile = path.join(root, '.jumpstart', 'state', 'risk-register.json');
  if (fs.existsSync(riskFile)) {
    try {
      const risks = JSON.parse(fs.readFileSync(riskFile, 'utf8'));
      const all = risks.risks || [];
      data.sections.risks = {
        total: all.length,
        high: all.filter(r => r.score >= 15).length,
        unmitigated: all.filter(r => !r.mitigation && r.status === 'identified').length
      };
    } catch { data.sections.risks = { total: 0, high: 0, unmitigated: 0 }; }
  } else {
    data.sections.risks = { total: 0, high: 0, unmitigated: 0 };
  }

  // Compliance
  const complianceFile = path.join(root, '.jumpstart', 'state', 'compliance.json');
  if (fs.existsSync(complianceFile)) {
    try {
      const compliance = JSON.parse(fs.readFileSync(complianceFile, 'utf8'));
      data.sections.compliance = {
        frameworks: (compliance.applied_frameworks || []).length,
        frameworks_list: compliance.applied_frameworks || []
      };
    } catch { data.sections.compliance = { frameworks: 0, frameworks_list: [] }; }
  } else {
    data.sections.compliance = { frameworks: 0, frameworks_list: [] };
  }

  // Release readiness
  const readinessFile = path.join(root, '.jumpstart', 'state', 'release-readiness.json');
  if (fs.existsSync(readinessFile)) {
    try {
      const readiness = JSON.parse(fs.readFileSync(readinessFile, 'utf8'));
      if (readiness.current_readiness) {
        data.sections.readiness = {
          score: readiness.current_readiness.total_score,
          level: readiness.current_readiness.level,
          recommendation: readiness.current_readiness.recommendation
        };
      } else {
        data.sections.readiness = { score: null, level: 'Not assessed' };
      }
    } catch { data.sections.readiness = { score: null, level: 'Error' }; }
  } else {
    data.sections.readiness = { score: null, level: 'Not assessed' };
  }

  // Environment promotion
  const envFile = path.join(root, '.jumpstart', 'state', 'environment-promotion.json');
  if (fs.existsSync(envFile)) {
    try {
      const env = JSON.parse(fs.readFileSync(envFile, 'utf8'));
      data.sections.environment = {
        current: env.current_environment,
        promotions: (env.promotion_history || []).length
      };
    } catch { data.sections.environment = { current: 'unknown' }; }
  } else {
    data.sections.environment = { current: 'unknown' };
  }

  // Calculate overall governance score
  let scoreItems = 0;
  let scoreTotal = 0;

  if (data.sections.policies.total > 0) { scoreItems++; scoreTotal += 80; }
  if (data.sections.compliance.frameworks > 0) { scoreItems++; scoreTotal += 80; }
  if (data.sections.risks.total > 0) { scoreItems++; scoreTotal += data.sections.risks.unmitigated === 0 ? 90 : 50; }
  if (data.sections.readiness.score !== null) { scoreItems++; scoreTotal += data.sections.readiness.score; }

  data.governance_score = scoreItems > 0 ? Math.round(scoreTotal / scoreItems) : 0;

  return { success: true, ...data };
}

/**
 * Render governance dashboard as text.
 *
 * @param {object} data
 * @returns {string}
 */
function renderDashboardText(data) {
  const lines = [];
  lines.push(`\n🏛️  Governance Dashboard  (${data.generated_at})`);
  lines.push(`${'─'.repeat(50)}`);
  lines.push(`  Governance Score: ${data.governance_score}%`);
  lines.push(`  Policies: ${data.sections.policies.total} (${data.sections.policies.enabled} enabled)`);
  lines.push(`  Waivers: ${data.sections.waivers.total} (${data.sections.waivers.pending} pending, ${data.sections.waivers.approved} approved)`);
  lines.push(`  Risks: ${data.sections.risks.total} (${data.sections.risks.high} high, ${data.sections.risks.unmitigated} unmitigated)`);
  lines.push(`  Compliance: ${data.sections.compliance.frameworks} framework(s)`);
  lines.push(`  Readiness: ${data.sections.readiness.level} (${data.sections.readiness.score || 'N/A'}%)`);
  lines.push(`  Environment: ${data.sections.environment.current}`);
  lines.push('');
  return lines.join('\n');
}

module.exports = {
  gatherGovernanceData,
  renderDashboardText
};
