/**
 * enterprise-templates.js — Guided Enterprise Templates (Item 67)
 *
 * Industry-specific templates for healthcare, insurance, banking,
 * manufacturing, retail, public sector, and internal platform engineering.
 *
 * Usage:
 *   node bin/lib/enterprise-templates.js list|get|apply [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const VERTICALS = [
  'healthcare', 'insurance', 'banking', 'manufacturing',
  'retail', 'public-sector', 'platform-engineering'
];

const TEMPLATE_CATALOG = {
  healthcare: {
    label: 'Healthcare',
    compliance: ['HIPAA', 'HITECH', 'FDA-21-CFR-Part-11'],
    data_concerns: ['PHI', 'patient-consent', 'de-identification'],
    nfrs: ['audit-trail', 'data-encryption-at-rest', 'access-control'],
    personas: ['clinician', 'patient', 'admin', 'compliance-officer']
  },
  insurance: {
    label: 'Insurance',
    compliance: ['SOC2', 'state-regulations', 'NAIC'],
    data_concerns: ['PII', 'claims-data', 'underwriting-models'],
    nfrs: ['audit-trail', 'data-retention', 'fraud-detection'],
    personas: ['policyholder', 'agent', 'underwriter', 'claims-adjuster']
  },
  banking: {
    label: 'Banking',
    compliance: ['PCI-DSS', 'SOX', 'GDPR', 'AML-KYC'],
    data_concerns: ['PII', 'transaction-data', 'account-info'],
    nfrs: ['encryption', 'audit-trail', 'multi-factor-auth'],
    personas: ['customer', 'teller', 'relationship-manager', 'risk-officer']
  },
  manufacturing: {
    label: 'Manufacturing',
    compliance: ['ISO-9001', 'ISO-27001'],
    data_concerns: ['IoT-sensor-data', 'supply-chain', 'quality-metrics'],
    nfrs: ['real-time-processing', 'edge-computing', 'uptime-sla'],
    personas: ['plant-manager', 'operator', 'quality-engineer', 'supply-chain-manager']
  },
  retail: {
    label: 'Retail',
    compliance: ['PCI-DSS', 'CCPA', 'GDPR'],
    data_concerns: ['customer-data', 'payment-info', 'inventory'],
    nfrs: ['scalability', 'low-latency', 'high-availability'],
    personas: ['shopper', 'store-manager', 'merchandiser', 'support-agent']
  },
  'public-sector': {
    label: 'Public Sector',
    compliance: ['FedRAMP', 'FISMA', 'Section-508', 'WCAG'],
    data_concerns: ['citizen-data', 'classified-info', 'FOIA'],
    nfrs: ['accessibility', 'audit-trail', 'data-sovereignty'],
    personas: ['citizen', 'case-worker', 'agency-admin', 'auditor']
  },
  'platform-engineering': {
    label: 'Internal Platform Engineering',
    compliance: ['SOC2', 'internal-governance'],
    data_concerns: ['service-configs', 'deployment-state', 'metrics'],
    nfrs: ['self-service', 'golden-paths', 'developer-experience'],
    personas: ['platform-engineer', 'app-developer', 'sre', 'security-engineer']
  }
};

/**
 * List available enterprise templates.
 */
function listTemplates() {
  return {
    success: true,
    verticals: VERTICALS,
    templates: VERTICALS.map(v => ({
      id: v,
      label: TEMPLATE_CATALOG[v].label,
      compliance_count: TEMPLATE_CATALOG[v].compliance.length,
      persona_count: TEMPLATE_CATALOG[v].personas.length
    }))
  };
}

/**
 * Get detailed template for a vertical.
 */
function getTemplate(vertical) {
  if (!VERTICALS.includes(vertical)) {
    return { success: false, error: `Unknown vertical: ${vertical}. Valid: ${VERTICALS.join(', ')}` };
  }

  return {
    success: true,
    vertical,
    template: TEMPLATE_CATALOG[vertical]
  };
}

/**
 * Apply template to project configuration.
 */
function applyTemplate(root, vertical, options = {}) {
  if (!VERTICALS.includes(vertical)) {
    return { success: false, error: `Unknown vertical: ${vertical}. Valid: ${VERTICALS.join(', ')}` };
  }

  const template = TEMPLATE_CATALOG[vertical];
  const applied = {
    vertical,
    label: template.label,
    compliance_frameworks: template.compliance,
    data_concerns: template.data_concerns,
    nfr_requirements: template.nfrs,
    personas: template.personas,
    applied_at: new Date().toISOString()
  };

  // Save applied template state
  const stateDir = path.join(root, '.jumpstart', 'state');
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, 'enterprise-template.json'),
    JSON.stringify(applied, null, 2) + '\n', 'utf8'
  );

  return { success: true, applied };
}

module.exports = {
  listTemplates,
  getTemplate,
  applyTemplate,
  VERTICALS,
  TEMPLATE_CATALOG
};
