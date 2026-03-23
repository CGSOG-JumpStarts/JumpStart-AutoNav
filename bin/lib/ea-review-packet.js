/**
 * ea-review-packet.js — Enterprise Architecture Review Packet (Item 32)
 *
 * Auto-produce diagrams, decision summaries, standards alignment,
 * and exception lists.
 *
 * Usage:
 *   node bin/lib/ea-review-packet.js generate|status [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PACKET_SECTIONS = ['architecture-overview', 'decision-summary', 'standards-alignment',
  'exception-list', 'risk-assessment', 'diagrams', 'compliance-status'];

/**
 * Generate an EA review packet from project artifacts.
 *
 * @param {string} root - Project root.
 * @param {object} [options]
 * @returns {object}
 */
function generatePacket(root, options = {}) {
  const packet = {
    id: `EA-${Date.now()}`,
    generated_at: new Date().toISOString(),
    project_root: root,
    sections: {}
  };

  // Architecture overview
  const archFile = path.join(root, 'specs', 'architecture.md');
  if (fs.existsSync(archFile)) {
    try {
      const content = fs.readFileSync(archFile, 'utf8');
      const sections = content.match(/^##\s+.+$/gm) || [];
      packet.sections['architecture-overview'] = {
        present: true,
        sections: sections.map(s => s.replace(/^##\s+/, '')),
        word_count: content.split(/\s+/).length
      };
    } catch { packet.sections['architecture-overview'] = { present: false }; }
  } else {
    packet.sections['architecture-overview'] = { present: false };
  }

  // Decision summary (ADRs)
  const decisionsDir = path.join(root, 'specs', 'decisions');
  if (fs.existsSync(decisionsDir)) {
    const adrs = fs.readdirSync(decisionsDir).filter(f => f.endsWith('.md'));
    packet.sections['decision-summary'] = {
      present: adrs.length > 0,
      total_adrs: adrs.length,
      adrs: adrs.map(f => f.replace('.md', ''))
    };
  } else {
    packet.sections['decision-summary'] = { present: false, total_adrs: 0, adrs: [] };
  }

  // Standards alignment
  const policyFile = path.join(root, '.jumpstart', 'policies.json');
  if (fs.existsSync(policyFile)) {
    try {
      const policies = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
      packet.sections['standards-alignment'] = {
        present: true,
        total_policies: policies.policies ? policies.policies.length : 0
      };
    } catch { packet.sections['standards-alignment'] = { present: false }; }
  } else {
    packet.sections['standards-alignment'] = { present: false };
  }

  // Exception list (waivers)
  const waiverFile = path.join(root, '.jumpstart', 'state', 'waivers.json');
  if (fs.existsSync(waiverFile)) {
    try {
      const waivers = JSON.parse(fs.readFileSync(waiverFile, 'utf8'));
      const active = (waivers.waivers || []).filter(w => w.status === 'approved');
      packet.sections['exception-list'] = {
        present: true,
        total_exceptions: active.length,
        exceptions: active.map(w => ({ id: w.id, title: w.title, expires_at: w.expires_at }))
      };
    } catch { packet.sections['exception-list'] = { present: false }; }
  } else {
    packet.sections['exception-list'] = { present: false, total_exceptions: 0 };
  }

  // Risk assessment
  const riskFile = path.join(root, '.jumpstart', 'state', 'risk-register.json');
  if (fs.existsSync(riskFile)) {
    try {
      const risks = JSON.parse(fs.readFileSync(riskFile, 'utf8'));
      const highRisks = (risks.risks || []).filter(r => r.score >= 15);
      packet.sections['risk-assessment'] = {
        present: true,
        total_risks: (risks.risks || []).length,
        high_risks: highRisks.length
      };
    } catch { packet.sections['risk-assessment'] = { present: false }; }
  } else {
    packet.sections['risk-assessment'] = { present: false };
  }

  // Diagrams
  if (fs.existsSync(archFile)) {
    try {
      const content = fs.readFileSync(archFile, 'utf8');
      const mermaidBlocks = (content.match(/```mermaid/g) || []).length;
      packet.sections.diagrams = { present: mermaidBlocks > 0, count: mermaidBlocks };
    } catch { packet.sections.diagrams = { present: false, count: 0 }; }
  } else {
    packet.sections.diagrams = { present: false, count: 0 };
  }

  // Compliance status
  const complianceFile = path.join(root, '.jumpstart', 'state', 'compliance.json');
  if (fs.existsSync(complianceFile)) {
    try {
      const compliance = JSON.parse(fs.readFileSync(complianceFile, 'utf8'));
      packet.sections['compliance-status'] = {
        present: true,
        frameworks: compliance.applied_frameworks || []
      };
    } catch { packet.sections['compliance-status'] = { present: false }; }
  } else {
    packet.sections['compliance-status'] = { present: false };
  }

  const presentSections = Object.values(packet.sections).filter(s => s.present).length;
  const completeness = Math.round((presentSections / PACKET_SECTIONS.length) * 100);

  return {
    success: true,
    packet_id: packet.id,
    completeness,
    sections_present: presentSections,
    sections_total: PACKET_SECTIONS.length,
    sections: packet.sections,
    gaps: PACKET_SECTIONS.filter(s => !packet.sections[s] || !packet.sections[s].present)
  };
}

module.exports = {
  generatePacket,
  PACKET_SECTIONS
};
