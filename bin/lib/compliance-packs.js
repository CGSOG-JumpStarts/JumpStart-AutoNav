/**
 * compliance-packs.js — Prebuilt Compliance Control Mappings (Item 24)
 *
 * Prebuilt control mappings for SOC 2, ISO 27001, HIPAA, PCI,
 * FedRAMP, GDPR, EU AI Act, NIST AI RMF.
 *
 * Usage:
 *   node bin/lib/compliance-packs.js list|apply|check|report [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'compliance.json');

const COMPLIANCE_FRAMEWORKS = {
  'soc2': {
    name: 'SOC 2 Type II',
    controls: [
      { id: 'CC1.1', category: 'organization', description: 'Integrity and ethical values', checks: ['code-of-conduct', 'policy-engine'] },
      { id: 'CC6.1', category: 'security', description: 'Logical and physical access controls', checks: ['secret-scan', 'auth-review'] },
      { id: 'CC7.1', category: 'operations', description: 'System monitoring', checks: ['logging-review', 'alert-config'] },
      { id: 'CC8.1', category: 'change-management', description: 'Change management controls', checks: ['approval-workflow', 'spec-drift'] }
    ]
  },
  'iso27001': {
    name: 'ISO 27001:2022',
    controls: [
      { id: 'A.5.1', category: 'policies', description: 'Information security policies', checks: ['policy-engine'] },
      { id: 'A.8.1', category: 'asset-management', description: 'Asset inventory', checks: ['data-classification'] },
      { id: 'A.8.9', category: 'configuration', description: 'Configuration management', checks: ['spec-drift', 'version-control'] },
      { id: 'A.8.25', category: 'sdlc', description: 'Secure development lifecycle', checks: ['secret-scan', 'security-review'] }
    ]
  },
  'hipaa': {
    name: 'HIPAA',
    controls: [
      { id: '164.312(a)', category: 'access', description: 'Access control', checks: ['auth-review', 'role-approval'] },
      { id: '164.312(c)', category: 'integrity', description: 'Data integrity', checks: ['data-classification', 'audit-trail'] },
      { id: '164.312(e)', category: 'transmission', description: 'Transmission security', checks: ['encryption-review'] },
      { id: '164.308(a)(1)', category: 'risk', description: 'Risk analysis', checks: ['risk-register'] }
    ]
  },
  'pci': {
    name: 'PCI DSS 4.0',
    controls: [
      { id: '6.2', category: 'software', description: 'Secure software development', checks: ['secret-scan', 'code-review'] },
      { id: '6.3', category: 'vulnerabilities', description: 'Vulnerability management', checks: ['dependency-scan', 'security-review'] },
      { id: '10.1', category: 'logging', description: 'Audit logging', checks: ['logging-review', 'audit-trail'] },
      { id: '12.1', category: 'policy', description: 'Security policy', checks: ['policy-engine'] }
    ]
  },
  'fedramp': {
    name: 'FedRAMP',
    controls: [
      { id: 'AC-1', category: 'access', description: 'Access control policy', checks: ['auth-review', 'role-approval'] },
      { id: 'CM-1', category: 'configuration', description: 'Configuration management policy', checks: ['spec-drift', 'version-control'] },
      { id: 'RA-5', category: 'risk', description: 'Vulnerability scanning', checks: ['dependency-scan', 'secret-scan'] },
      { id: 'SA-11', category: 'development', description: 'Developer security testing', checks: ['security-review', 'code-review'] }
    ]
  },
  'gdpr': {
    name: 'GDPR',
    controls: [
      { id: 'Art.25', category: 'design', description: 'Data protection by design', checks: ['data-classification', 'privacy-review'] },
      { id: 'Art.30', category: 'records', description: 'Records of processing', checks: ['data-classification', 'audit-trail'] },
      { id: 'Art.32', category: 'security', description: 'Security of processing', checks: ['encryption-review', 'secret-scan'] },
      { id: 'Art.35', category: 'impact', description: 'Data protection impact assessment', checks: ['risk-register', 'privacy-review'] }
    ]
  },
  'eu-ai-act': {
    name: 'EU AI Act',
    controls: [
      { id: 'Art.9', category: 'risk-management', description: 'Risk management system', checks: ['risk-register', 'model-governance'] },
      { id: 'Art.10', category: 'data-governance', description: 'Data and data governance', checks: ['data-classification', 'bias-review'] },
      { id: 'Art.13', category: 'transparency', description: 'Transparency and information', checks: ['model-documentation'] },
      { id: 'Art.15', category: 'accuracy', description: 'Accuracy, robustness, cybersecurity', checks: ['model-eval', 'security-review'] }
    ]
  },
  'nist-ai-rmf': {
    name: 'NIST AI RMF 1.0',
    controls: [
      { id: 'GOVERN-1', category: 'governance', description: 'AI risk governance', checks: ['model-governance', 'risk-register'] },
      { id: 'MAP-1', category: 'context', description: 'Context and usage mapping', checks: ['ai-intake', 'requirements-baseline'] },
      { id: 'MEASURE-1', category: 'measurement', description: 'AI risks measured', checks: ['model-eval', 'bias-review'] },
      { id: 'MANAGE-1', category: 'management', description: 'AI risks managed', checks: ['risk-register', 'model-governance'] }
    ]
  }
};

function defaultState() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    applied_frameworks: [],
    check_results: []
  };
}

function loadState(stateFile) {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  if (!fs.existsSync(filePath)) return defaultState();
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return defaultState(); }
}

function saveState(state, stateFile) {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/**
 * List available compliance frameworks.
 * @returns {object}
 */
function listFrameworks() {
  return {
    success: true,
    frameworks: Object.entries(COMPLIANCE_FRAMEWORKS).map(([id, fw]) => ({
      id,
      name: fw.name,
      controls: fw.controls.length
    })),
    total: Object.keys(COMPLIANCE_FRAMEWORKS).length
  };
}

/**
 * Apply a compliance framework to the project.
 *
 * @param {string} frameworkId
 * @param {object} [options]
 * @returns {object}
 */
function applyFramework(frameworkId, options = {}) {
  const fw = COMPLIANCE_FRAMEWORKS[frameworkId];
  if (!fw) {
    return { success: false, error: `Unknown framework: ${frameworkId}. Available: ${Object.keys(COMPLIANCE_FRAMEWORKS).join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  if (!state.applied_frameworks.includes(frameworkId)) {
    state.applied_frameworks.push(frameworkId);
  }

  saveState(state, stateFile);

  return {
    success: true,
    framework: frameworkId,
    name: fw.name,
    controls_added: fw.controls.length,
    total_applied: state.applied_frameworks.length
  };
}

/**
 * Check compliance against applied frameworks.
 *
 * @param {object} [options]
 * @returns {object}
 */
function checkCompliance(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  if (state.applied_frameworks.length === 0) {
    return { success: true, message: 'No compliance frameworks applied', compliant: true, findings: [] };
  }

  const findings = [];
  for (const fwId of state.applied_frameworks) {
    const fw = COMPLIANCE_FRAMEWORKS[fwId];
    if (!fw) continue;
    for (const control of fw.controls) {
      findings.push({
        framework: fwId,
        control_id: control.id,
        description: control.description,
        category: control.category,
        required_checks: control.checks,
        status: 'needs-review'
      });
    }
  }

  return {
    success: true,
    applied_frameworks: state.applied_frameworks,
    total_controls: findings.length,
    findings,
    compliant: false,
    summary: `${findings.length} controls require review across ${state.applied_frameworks.length} framework(s)`
  };
}

module.exports = {
  defaultState,
  loadState,
  saveState,
  listFrameworks,
  applyFramework,
  checkCompliance,
  COMPLIANCE_FRAMEWORKS
};
