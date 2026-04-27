/**
 * compliance-packs.ts — prebuilt compliance control mappings (T4.4.2, cluster I).
 *
 * Pure-library port of `bin/lib/compliance-packs.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `defaultState()` => ComplianceState
 *   - `loadState(stateFile?)` => ComplianceState
 *   - `saveState(state, stateFile?)` => void
 *   - `listFrameworks()` => ListFrameworksResult
 *   - `applyFramework(frameworkId, options?)` => ApplyResult
 *   - `checkCompliance(options?)` => CheckResult
 *   - `COMPLIANCE_FRAMEWORKS` (constant map)
 *
 * Behavior parity:
 *   - Default state path: `.jumpstart/state/compliance.json`.
 *   - 8 frameworks: SOC 2, ISO 27001, HIPAA, PCI, FedRAMP, GDPR,
 *     EU AI Act, NIST AI RMF.
 *   - JSON parse failures return safe defaults (no throw).
 *   - M3 hardening: validates parsed JSON shape; rejects __proto__.
 *
 * @see bin/lib/compliance-packs.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.2
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DEFAULT_STATE_FILE = join('.jumpstart', 'state', 'compliance.json');

// Public types

export interface ComplianceControl {
  id: string;
  category: string;
  description: string;
  checks: string[];
}

export interface ComplianceFramework {
  name: string;
  controls: ComplianceControl[];
}

export interface ComplianceState {
  version: string;
  created_at: string;
  last_updated: string | null;
  applied_frameworks: string[];
  check_results: unknown[];
}

export interface FrameworkSummary {
  id: string;
  name: string;
  controls: number;
}

export interface ListFrameworksResult {
  success: true;
  frameworks: FrameworkSummary[];
  total: number;
}

export interface ApplyResult {
  success: boolean;
  framework?: string;
  name?: string;
  controls_added?: number;
  total_applied?: number;
  error?: string;
}

export interface ComplianceFinding {
  framework: string;
  control_id: string;
  description: string;
  category: string;
  required_checks: string[];
  status: string;
}

export interface CheckResult {
  success: true;
  message?: string;
  applied_frameworks?: string[];
  total_controls?: number;
  findings: ComplianceFinding[];
  compliant: boolean;
  summary?: string;
}

export interface StateOptions {
  stateFile?: string;
}

export const COMPLIANCE_FRAMEWORKS: Record<string, ComplianceFramework> = {
  soc2: {
    name: 'SOC 2 Type II',
    controls: [
      {
        id: 'CC1.1',
        category: 'organization',
        description: 'Integrity and ethical values',
        checks: ['code-of-conduct', 'policy-engine'],
      },
      {
        id: 'CC6.1',
        category: 'security',
        description: 'Logical and physical access controls',
        checks: ['secret-scan', 'auth-review'],
      },
      {
        id: 'CC7.1',
        category: 'operations',
        description: 'System monitoring',
        checks: ['logging-review', 'alert-config'],
      },
      {
        id: 'CC8.1',
        category: 'change-management',
        description: 'Change management controls',
        checks: ['approval-workflow', 'spec-drift'],
      },
    ],
  },
  iso27001: {
    name: 'ISO 27001:2022',
    controls: [
      {
        id: 'A.5.1',
        category: 'policies',
        description: 'Information security policies',
        checks: ['policy-engine'],
      },
      {
        id: 'A.8.1',
        category: 'asset-management',
        description: 'Asset inventory',
        checks: ['data-classification'],
      },
      {
        id: 'A.8.9',
        category: 'configuration',
        description: 'Configuration management',
        checks: ['spec-drift', 'version-control'],
      },
      {
        id: 'A.8.25',
        category: 'sdlc',
        description: 'Secure development lifecycle',
        checks: ['secret-scan', 'security-review'],
      },
    ],
  },
  hipaa: {
    name: 'HIPAA',
    controls: [
      {
        id: '164.312(a)',
        category: 'access',
        description: 'Access control',
        checks: ['auth-review', 'role-approval'],
      },
      {
        id: '164.312(c)',
        category: 'integrity',
        description: 'Data integrity',
        checks: ['data-classification', 'audit-trail'],
      },
      {
        id: '164.312(e)',
        category: 'transmission',
        description: 'Transmission security',
        checks: ['encryption-review'],
      },
      {
        id: '164.308(a)(1)',
        category: 'risk',
        description: 'Risk analysis',
        checks: ['risk-register'],
      },
    ],
  },
  pci: {
    name: 'PCI DSS 4.0',
    controls: [
      {
        id: '6.2',
        category: 'software',
        description: 'Secure software development',
        checks: ['secret-scan', 'code-review'],
      },
      {
        id: '6.3',
        category: 'vulnerabilities',
        description: 'Vulnerability management',
        checks: ['dependency-scan', 'security-review'],
      },
      {
        id: '10.1',
        category: 'logging',
        description: 'Audit logging',
        checks: ['logging-review', 'audit-trail'],
      },
      {
        id: '12.1',
        category: 'policy',
        description: 'Security policy',
        checks: ['policy-engine'],
      },
    ],
  },
  fedramp: {
    name: 'FedRAMP',
    controls: [
      {
        id: 'AC-1',
        category: 'access',
        description: 'Access control policy',
        checks: ['auth-review', 'role-approval'],
      },
      {
        id: 'CM-1',
        category: 'configuration',
        description: 'Configuration management policy',
        checks: ['spec-drift', 'version-control'],
      },
      {
        id: 'RA-5',
        category: 'risk',
        description: 'Vulnerability scanning',
        checks: ['dependency-scan', 'secret-scan'],
      },
      {
        id: 'SA-11',
        category: 'development',
        description: 'Developer security testing',
        checks: ['security-review', 'code-review'],
      },
    ],
  },
  gdpr: {
    name: 'GDPR',
    controls: [
      {
        id: 'Art.25',
        category: 'design',
        description: 'Data protection by design',
        checks: ['data-classification', 'privacy-review'],
      },
      {
        id: 'Art.30',
        category: 'records',
        description: 'Records of processing',
        checks: ['data-classification', 'audit-trail'],
      },
      {
        id: 'Art.32',
        category: 'security',
        description: 'Security of processing',
        checks: ['encryption-review', 'secret-scan'],
      },
      {
        id: 'Art.35',
        category: 'impact',
        description: 'Data protection impact assessment',
        checks: ['risk-register', 'privacy-review'],
      },
    ],
  },
  'eu-ai-act': {
    name: 'EU AI Act',
    controls: [
      {
        id: 'Art.9',
        category: 'risk-management',
        description: 'Risk management system',
        checks: ['risk-register', 'model-governance'],
      },
      {
        id: 'Art.10',
        category: 'data-governance',
        description: 'Data and data governance',
        checks: ['data-classification', 'bias-review'],
      },
      {
        id: 'Art.13',
        category: 'transparency',
        description: 'Transparency and information',
        checks: ['model-documentation'],
      },
      {
        id: 'Art.15',
        category: 'accuracy',
        description: 'Accuracy, robustness, cybersecurity',
        checks: ['model-eval', 'security-review'],
      },
    ],
  },
  'nist-ai-rmf': {
    name: 'NIST AI RMF 1.0',
    controls: [
      {
        id: 'GOVERN-1',
        category: 'governance',
        description: 'AI risk governance',
        checks: ['model-governance', 'risk-register'],
      },
      {
        id: 'MAP-1',
        category: 'context',
        description: 'Context and usage mapping',
        checks: ['ai-intake', 'requirements-baseline'],
      },
      {
        id: 'MEASURE-1',
        category: 'measurement',
        description: 'AI risks measured',
        checks: ['model-eval', 'bias-review'],
      },
      {
        id: 'MANAGE-1',
        category: 'management',
        description: 'AI risks managed',
        checks: ['risk-register', 'model-governance'],
      },
    ],
  },
};

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function safeParseState(raw: string): ComplianceState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  for (const key of Object.keys(parsed)) {
    if (FORBIDDEN_KEYS.has(key)) return null;
  }
  const data = parsed as Partial<ComplianceState>;
  return {
    version: typeof data.version === 'string' ? data.version : '1.0.0',
    created_at: typeof data.created_at === 'string' ? data.created_at : new Date().toISOString(),
    last_updated: typeof data.last_updated === 'string' ? data.last_updated : null,
    applied_frameworks: Array.isArray(data.applied_frameworks)
      ? data.applied_frameworks.filter((s): s is string => typeof s === 'string')
      : [],
    check_results: Array.isArray(data.check_results) ? data.check_results : [],
  };
}

export function defaultState(): ComplianceState {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    applied_frameworks: [],
    check_results: [],
  };
}

export function loadState(stateFile?: string): ComplianceState {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  if (!existsSync(filePath)) return defaultState();
  const parsed = safeParseState(readFileSync(filePath, 'utf8'));
  return parsed ?? defaultState();
}

export function saveState(state: ComplianceState, stateFile?: string): void {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function listFrameworks(): ListFrameworksResult {
  return {
    success: true,
    frameworks: Object.entries(COMPLIANCE_FRAMEWORKS).map(([id, fw]) => ({
      id,
      name: fw.name,
      controls: fw.controls.length,
    })),
    total: Object.keys(COMPLIANCE_FRAMEWORKS).length,
  };
}

export function applyFramework(frameworkId: string, options: StateOptions = {}): ApplyResult {
  const fw = COMPLIANCE_FRAMEWORKS[frameworkId];
  if (!fw) {
    return {
      success: false,
      error: `Unknown framework: ${frameworkId}. Available: ${Object.keys(COMPLIANCE_FRAMEWORKS).join(', ')}`,
    };
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
    total_applied: state.applied_frameworks.length,
  };
}

export function checkCompliance(options: StateOptions = {}): CheckResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  if (state.applied_frameworks.length === 0) {
    return {
      success: true,
      message: 'No compliance frameworks applied',
      compliant: true,
      findings: [],
    };
  }

  const findings: ComplianceFinding[] = [];
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
        status: 'needs-review',
      });
    }
  }

  return {
    success: true,
    applied_frameworks: state.applied_frameworks,
    total_controls: findings.length,
    findings,
    compliant: false,
    summary: `${findings.length} controls require review across ${state.applied_frameworks.length} framework(s)`,
  };
}
