/**
 * cab-output.js — Change Advisory Board Output Mode (Item 37)
 *
 * Generate CAB-ready summaries and implementation risk memos.
 *
 * Usage:
 *   node bin/lib/cab-output.js generate|status [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const CAB_SECTIONS = ['change-description', 'risk-assessment', 'impact-analysis', 'rollback-plan',
  'testing-summary', 'approval-status', 'implementation-schedule', 'communication-plan'];

/**
 * Generate a CAB-ready change summary.
 *
 * @param {string} root - Project root.
 * @param {object} [options]
 * @returns {object}
 */
function generateCABSummary(root, options = {}) {
  const summary = {
    id: `CAB-${Date.now()}`,
    generated_at: new Date().toISOString(),
    sections: {}
  };

  // Change description from specs
  const prdFile = path.join(root, 'specs', 'prd.md');
  if (fs.existsSync(prdFile)) {
    try {
      const content = fs.readFileSync(prdFile, 'utf8');
      const title = (content.match(/^#\s+(.+)$/m) || [])[1] || 'Untitled';
      const stories = (content.match(/\bE\d+-S\d+\b/g) || []).length;
      summary.sections['change-description'] = { present: true, title, user_stories: stories };
    } catch { summary.sections['change-description'] = { present: false }; }
  } else {
    summary.sections['change-description'] = { present: false };
  }

  // Risk assessment
  const riskFile = path.join(root, '.jumpstart', 'state', 'risk-register.json');
  if (fs.existsSync(riskFile)) {
    try {
      const risks = JSON.parse(fs.readFileSync(riskFile, 'utf8'));
      const high = (risks.risks || []).filter(r => r.score >= 15);
      summary.sections['risk-assessment'] = { present: true, total_risks: (risks.risks || []).length, high_risks: high.length };
    } catch { summary.sections['risk-assessment'] = { present: false }; }
  } else {
    summary.sections['risk-assessment'] = { present: false };
  }

  // Impact analysis
  const archFile = path.join(root, 'specs', 'architecture.md');
  summary.sections['impact-analysis'] = { present: fs.existsSync(archFile) };

  // Rollback plan
  summary.sections['rollback-plan'] = {
    present: false,
    recommendation: 'Define rollback strategy in architecture specs'
  };
  if (fs.existsSync(archFile)) {
    try {
      const content = fs.readFileSync(archFile, 'utf8');
      if (/rollback|roll.back|revert/i.test(content)) {
        summary.sections['rollback-plan'] = { present: true };
      }
    } catch { /* ignore */ }
  }

  // Testing summary
  const hasTests = fs.existsSync(path.join(root, 'tests')) || fs.existsSync(path.join(root, 'test'));
  summary.sections['testing-summary'] = { present: hasTests };

  // Approval status
  const approvalFile = path.join(root, '.jumpstart', 'state', 'role-approvals.json');
  if (fs.existsSync(approvalFile)) {
    try {
      const approvals = JSON.parse(fs.readFileSync(approvalFile, 'utf8'));
      const workflows = Object.values(approvals.workflows || {});
      const approved = workflows.filter(w => w.status === 'approved').length;
      summary.sections['approval-status'] = { present: true, total: workflows.length, approved };
    } catch { summary.sections['approval-status'] = { present: false }; }
  } else {
    summary.sections['approval-status'] = { present: false };
  }

  // Implementation schedule
  const planFile = path.join(root, 'specs', 'implementation-plan.md');
  summary.sections['implementation-schedule'] = { present: fs.existsSync(planFile) };

  // Communication plan
  summary.sections['communication-plan'] = { present: false, recommendation: 'Add communication plan' };

  const presentSections = Object.values(summary.sections).filter(s => s.present).length;
  const completeness = Math.round((presentSections / CAB_SECTIONS.length) * 100);

  const riskLevel = summary.sections['risk-assessment'] && summary.sections['risk-assessment'].high_risks > 0
    ? 'high' : completeness >= 70 ? 'standard' : 'elevated';

  return {
    success: true,
    cab_id: summary.id,
    completeness,
    risk_level: riskLevel,
    recommendation: completeness >= 80 ? 'Ready for CAB review' : 'Additional documentation needed',
    sections: summary.sections,
    gaps: CAB_SECTIONS.filter(s => !summary.sections[s] || !summary.sections[s].present)
  };
}

module.exports = {
  generateCABSummary,
  CAB_SECTIONS
};
