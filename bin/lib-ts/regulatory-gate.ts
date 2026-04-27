/**
 * regulatory-gate.ts — regulatory focus gate port (T4.4.2, cluster I).
 *
 * Pure-library port of `bin/lib/regulatory-gate.js`. Public surface
 * preserved verbatim:
 *
 *   - `evaluateRegulatory(input)` => RegulatoryEvaluation
 *   - `generateChecklist(classification, regulations)` => ChecklistCategory[]
 *   - `DOMAIN_REGULATIONS`, `REGION_REGULATIONS`
 *
 * Behavior parity:
 *   - 8 domains (healthcare/fintech/finance/banking/insurance/government/
 *     education/ecommerce) with regulation mappings.
 *   - 7 regions (EU/US/UK/CA/AU/BR/global).
 *   - Risk-level escalation logic preserved verbatim.
 *   - PHI/PCI/PII data type implications preserved.
 *   - CLI entry-point intentionally NOT ported.
 *
 * @see bin/lib/regulatory-gate.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.2
 */

export interface DomainRegulation {
  classification: string;
  regulations: string[];
  data_types: string[];
  min_risk: string;
}

export const DOMAIN_REGULATIONS: Record<string, DomainRegulation> = {
  healthcare: {
    classification: 'medical',
    regulations: ['HIPAA', 'HITECH', 'FDA 21 CFR Part 11'],
    data_types: ['PHI', 'PII'],
    min_risk: 'high',
  },
  fintech: {
    classification: 'financial',
    regulations: ['PCI-DSS', 'SOX', 'GLBA'],
    data_types: ['PCI', 'PII'],
    min_risk: 'high',
  },
  finance: {
    classification: 'financial',
    regulations: ['PCI-DSS', 'SOX', 'GLBA'],
    data_types: ['PCI', 'PII'],
    min_risk: 'high',
  },
  banking: {
    classification: 'financial',
    regulations: ['PCI-DSS', 'SOX', 'GLBA', 'BSA/AML'],
    data_types: ['PCI', 'PII'],
    min_risk: 'critical',
  },
  insurance: {
    classification: 'financial',
    regulations: ['SOX', 'GLBA', 'State Insurance Regulations'],
    data_types: ['PII'],
    min_risk: 'high',
  },
  government: {
    classification: 'government',
    regulations: ['FedRAMP', 'FISMA', 'NIST 800-53'],
    data_types: ['CUI', 'PII'],
    min_risk: 'high',
  },
  education: {
    classification: 'education',
    regulations: ['FERPA', 'COPPA'],
    data_types: ['PII', 'Student Records'],
    min_risk: 'medium',
  },
  ecommerce: {
    classification: 'commercial',
    regulations: ['PCI-DSS'],
    data_types: ['PCI', 'PII'],
    min_risk: 'medium',
  },
};

export const REGION_REGULATIONS: Record<string, string[]> = {
  EU: ['GDPR', 'ePrivacy Directive'],
  US: [],
  UK: ['UK GDPR', 'DPA 2018'],
  CA: ['PIPEDA'],
  AU: ['Australian Privacy Act'],
  BR: ['LGPD'],
  global: ['GDPR', 'CCPA'],
};

export interface ChecklistCategory {
  category: string;
  items: string[];
}

export interface RegulatoryInput {
  project_domain?: string;
  risk_level?: string;
  data_types?: string[];
  regions?: string[];
}

export interface RegulatoryEvaluation {
  classification: string;
  risk_level: string;
  applicable_regulations: string[];
  required_checks: string[];
  checklist_items: ChecklistCategory[];
  gate_required: boolean;
  data_types: string[];
  template: string;
}

export function generateChecklist(
  _classification: string,
  regulations: string[]
): ChecklistCategory[] {
  const checklist: ChecklistCategory[] = [];

  checklist.push({
    category: 'Data Protection',
    items: [
      'Data classification completed',
      'Data retention policy defined',
      'Encryption at rest specified',
      'Encryption in transit (TLS 1.2+) required',
      'Key management strategy documented',
    ],
  });

  checklist.push({
    category: 'Access Control',
    items: [
      'Authentication method specified',
      'Authorization model defined (RBAC/ABAC)',
      'Session management policy documented',
      'Audit logging for access events required',
    ],
  });

  if (regulations.includes('HIPAA')) {
    checklist.push({
      category: 'HIPAA Compliance',
      items: [
        'BAA required for all vendors handling PHI',
        'Minimum Necessary Standard applied',
        'PHI de-identification method selected',
        'Breach notification procedures (60-day window)',
        'Patient rights (access, amendment, accounting) supported',
      ],
    });
  }

  if (regulations.includes('PCI-DSS')) {
    checklist.push({
      category: 'PCI-DSS Compliance',
      items: [
        'Cardholder data environment (CDE) boundaries defined',
        'PCI scope and SAQ level determined',
        'Card data never stored in plaintext',
        'Network segmentation documented',
        'Vulnerability scanning cadence specified',
      ],
    });
  }

  if (regulations.includes('GDPR')) {
    checklist.push({
      category: 'GDPR Compliance',
      items: [
        'Lawful basis for processing identified',
        'Right to deletion (erasure) supported',
        'Data portability supported',
        'Privacy impact assessment required',
        'Breach notification (72-hour window)',
      ],
    });
  }

  if (regulations.includes('FedRAMP')) {
    checklist.push({
      category: 'FedRAMP Compliance',
      items: [
        'FIPS 140-2 validated cryptography required',
        'Impact level classified (Low/Moderate/High)',
        'Continuous monitoring plan documented',
        'Authority to Operate (ATO) process identified',
      ],
    });
  }

  return checklist;
}

export function evaluateRegulatory(input: RegulatoryInput): RegulatoryEvaluation {
  const project_domain = input.project_domain ?? 'general';
  const risk_level = input.risk_level ?? 'low';
  const data_types = input.data_types ?? [];
  const regions = input.regions ?? [];

  const domainKey = project_domain.toLowerCase();
  const domainInfo = DOMAIN_REGULATIONS[domainKey];

  let classification = 'general';
  let applicableRegulations: string[] = [];
  const requiredChecks: string[] = [];
  let effectiveRiskLevel = risk_level;

  if (domainInfo) {
    classification = domainInfo.classification;
    applicableRegulations = [...domainInfo.regulations];

    const riskOrder = ['low', 'medium', 'high', 'critical'];
    const domainRiskIdx = riskOrder.indexOf(domainInfo.min_risk);
    const inputRiskIdx = riskOrder.indexOf(risk_level);
    if (domainRiskIdx > inputRiskIdx) {
      effectiveRiskLevel = domainInfo.min_risk;
    }
  }

  for (const region of regions) {
    const regionRegs = REGION_REGULATIONS[region] || [];
    for (const reg of regionRegs) {
      if (!applicableRegulations.includes(reg)) {
        applicableRegulations.push(reg);
      }
    }
  }

  if (data_types.includes('PHI') && !applicableRegulations.includes('HIPAA')) {
    applicableRegulations.push('HIPAA');
  }
  if (data_types.includes('PCI') && !applicableRegulations.includes('PCI-DSS')) {
    applicableRegulations.push('PCI-DSS');
  }
  if (data_types.includes('PII')) {
    requiredChecks.push('Privacy impact assessment');
    requiredChecks.push('Data retention policy');
  }

  const checklistItems = generateChecklist(classification, applicableRegulations);
  const gateRequired =
    applicableRegulations.length > 0 ||
    effectiveRiskLevel === 'critical' ||
    effectiveRiskLevel === 'high';

  return {
    classification,
    risk_level: effectiveRiskLevel,
    applicable_regulations: applicableRegulations,
    required_checks: requiredChecks,
    checklist_items: checklistItems,
    gate_required: gateRequired,
    data_types: data_types.length > 0 ? data_types : domainInfo ? domainInfo.data_types : [],
    template: '.jumpstart/templates/compliance-checklist.md',
  };
}
