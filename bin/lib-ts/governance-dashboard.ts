/**
 * governance-dashboard.ts — governance dashboard for leadership port (T4.4.2, cluster I).
 *
 * Pure-library port of `bin/lib/governance-dashboard.js`. Public surface
 * preserved verbatim:
 *
 *   - `gatherGovernanceData(root, options?)` => GovernanceData
 *   - `renderDashboardText(data)` => string
 *
 * Behavior parity:
 *   - Reads policy, waiver, risk, compliance, readiness, and environment
 *     state files from `.jumpstart/state/`.
 *   - Calculates governance score using the same weighted formula.
 *   - Sibling state files loaded via lazy `require()` to match the
 *     dashboard.ts pattern (cluster H, T4.3.3) where some sibling
 *     modules have not yet ported to TS.
 *   - JSON parse failures fall back to safe section defaults.
 *
 * Pit Crew M4 Reviewer M3 (DEFERRED to M9): bare `require()` calls
 * in the lazy sibling-loaders below assume CJS scope. Today the
 * strangler-phase tsconfig classifies .ts as CJS so `require` is the
 * module-scope global — works correctly. At the M9 ESM cutover this
 * must switch to `import { createRequire } from 'node:module';`.
 *
 * @see bin/lib/governance-dashboard.js (legacy reference)
 * @see bin/lib-ts/dashboard.ts (TS sibling pattern)
 * @see specs/implementation-plan.md T4.4.2
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Sibling JS modules (compliance-packs, risk-register, waiver-workflow,
// policy-engine) are loaded via lazy `require()` for parity with the
// dashboard.ts cluster H pattern. Today these are also TS ports in the
// same cluster; we still gate via require so missing files don't throw.

interface PolicySibling {
  loadPolicies(file?: string): { policies?: Array<{ enabled?: boolean }> };
}

interface WaiverSibling {
  loadState(file?: string): { waivers?: Array<{ status?: string }> };
}

interface RiskSibling {
  loadState(file?: string): {
    risks?: Array<{ score?: number; mitigation?: string | null; status?: string }>;
  };
}

interface ComplianceSibling {
  loadState(file?: string): { applied_frameworks?: string[] };
}

function loadPolicySibling(): PolicySibling | null {
  try {
    return require('../lib/policy-engine.js') as PolicySibling;
  } catch {
    return null;
  }
}

function loadWaiverSibling(): WaiverSibling | null {
  try {
    return require('../lib/waiver-workflow.js') as WaiverSibling;
  } catch {
    return null;
  }
}

function loadRiskSibling(): RiskSibling | null {
  try {
    return require('../lib/risk-register.js') as RiskSibling;
  } catch {
    return null;
  }
}

function loadComplianceSibling(): ComplianceSibling | null {
  try {
    return require('../lib/compliance-packs.js') as ComplianceSibling;
  } catch {
    return null;
  }
}

// Public types

export interface PolicySection {
  total: number;
  enabled: number;
}

export interface WaiverSection {
  total: number;
  pending: number;
  approved: number;
  expired: number;
}

export interface SecuritySection {
  findings: number;
  critical: number;
  high: number;
}

export interface RiskSection {
  total: number;
  high: number;
  unmitigated: number;
}

export interface ComplianceSection {
  frameworks: number;
  frameworks_list: string[];
}

export interface ReadinessSection {
  score: number | null;
  level: string;
  recommendation?: string;
}

export interface EnvironmentSection {
  current: string;
  promotions?: number;
}

export interface GovernanceSections {
  policies: PolicySection;
  waivers: WaiverSection;
  security: SecuritySection;
  risks: RiskSection;
  compliance: ComplianceSection;
  readiness: ReadinessSection;
  environment: EnvironmentSection;
}

export interface GovernanceData {
  success: true;
  generated_at: string;
  project_root: string;
  sections: GovernanceSections;
  governance_score: number;
}

export interface GatherOptions {
  stateFile?: string;
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function safeParse(raw: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  for (const key of Object.keys(parsed as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) return null;
  }
  return parsed;
}

export function gatherGovernanceData(root: string, _options: GatherOptions = {}): GovernanceData {
  const sections: GovernanceSections = {
    policies: { total: 0, enabled: 0 },
    waivers: { total: 0, pending: 0, approved: 0, expired: 0 },
    security: { findings: 0, critical: 0, high: 0 },
    risks: { total: 0, high: 0, unmitigated: 0 },
    compliance: { frameworks: 0, frameworks_list: [] },
    readiness: { score: null, level: 'Not assessed' },
    environment: { current: 'unknown' },
  };

  // Policies
  const policyFile = join(root, '.jumpstart', 'policies.json');
  if (existsSync(policyFile)) {
    const parsed = safeParse(readFileSync(policyFile, 'utf8')) as {
      policies?: Array<{ enabled?: boolean }>;
    } | null;
    if (parsed) {
      const list = Array.isArray(parsed.policies) ? parsed.policies : [];
      sections.policies = {
        total: list.length,
        enabled: list.filter((p) => p.enabled !== false).length,
      };
    }
  }

  // Waivers
  const waiverFile = join(root, '.jumpstart', 'state', 'waivers.json');
  if (existsSync(waiverFile)) {
    const parsed = safeParse(readFileSync(waiverFile, 'utf8')) as {
      waivers?: Array<{ status?: string }>;
    } | null;
    if (parsed) {
      const all = Array.isArray(parsed.waivers) ? parsed.waivers : [];
      sections.waivers = {
        total: all.length,
        pending: all.filter((w) => w.status === 'pending').length,
        approved: all.filter((w) => w.status === 'approved').length,
        expired: all.filter((w) => w.status === 'expired').length,
      };
    }
  }

  // Risks
  const riskFile = join(root, '.jumpstart', 'state', 'risk-register.json');
  if (existsSync(riskFile)) {
    const parsed = safeParse(readFileSync(riskFile, 'utf8')) as {
      risks?: Array<{ score?: number; mitigation?: string | null; status?: string }>;
    } | null;
    if (parsed) {
      const all = Array.isArray(parsed.risks) ? parsed.risks : [];
      sections.risks = {
        total: all.length,
        high: all.filter((r) => (r.score ?? 0) >= 15).length,
        unmitigated: all.filter((r) => !r.mitigation && r.status === 'identified').length,
      };
    }
  }

  // Compliance
  const complianceFile = join(root, '.jumpstart', 'state', 'compliance.json');
  if (existsSync(complianceFile)) {
    const parsed = safeParse(readFileSync(complianceFile, 'utf8')) as {
      applied_frameworks?: string[];
    } | null;
    if (parsed) {
      const list = Array.isArray(parsed.applied_frameworks) ? parsed.applied_frameworks : [];
      sections.compliance = { frameworks: list.length, frameworks_list: list };
    }
  }

  // Readiness
  const readinessFile = join(root, '.jumpstart', 'state', 'release-readiness.json');
  if (existsSync(readinessFile)) {
    const parsed = safeParse(readFileSync(readinessFile, 'utf8')) as {
      current_readiness?: {
        total_score?: number;
        level?: string;
        recommendation?: string;
      };
    } | null;
    if (parsed?.current_readiness) {
      sections.readiness = {
        score: parsed.current_readiness.total_score ?? null,
        level: parsed.current_readiness.level ?? 'Not assessed',
        recommendation: parsed.current_readiness.recommendation,
      };
    } else if (parsed === null) {
      sections.readiness = { score: null, level: 'Error' };
    }
  }

  // Environment
  const envFile = join(root, '.jumpstart', 'state', 'environment-promotion.json');
  if (existsSync(envFile)) {
    const parsed = safeParse(readFileSync(envFile, 'utf8')) as {
      current_environment?: string;
      promotion_history?: unknown[];
    } | null;
    if (parsed) {
      sections.environment = {
        current: parsed.current_environment ?? 'unknown',
        promotions: Array.isArray(parsed.promotion_history) ? parsed.promotion_history.length : 0,
      };
    }
  }

  // Sibling lazy-loads (kept available so future TS callers can plug
  // in via the same surface).
  loadPolicySibling();
  loadWaiverSibling();
  loadRiskSibling();
  loadComplianceSibling();

  // Governance score calculation
  let scoreItems = 0;
  let scoreTotal = 0;

  if (sections.policies.total > 0) {
    scoreItems++;
    scoreTotal += 80;
  }
  if (sections.compliance.frameworks > 0) {
    scoreItems++;
    scoreTotal += 80;
  }
  if (sections.risks.total > 0) {
    scoreItems++;
    scoreTotal += sections.risks.unmitigated === 0 ? 90 : 50;
  }
  if (sections.readiness.score !== null) {
    scoreItems++;
    scoreTotal += sections.readiness.score;
  }

  const governanceScore = scoreItems > 0 ? Math.round(scoreTotal / scoreItems) : 0;

  return {
    success: true,
    generated_at: new Date().toISOString(),
    project_root: root,
    sections,
    governance_score: governanceScore,
  };
}

export function renderDashboardText(data: GovernanceData): string {
  const lines: string[] = [];
  lines.push(`\n🏛️  Governance Dashboard  (${data.generated_at})`);
  lines.push(`${'─'.repeat(50)}`);
  lines.push(`  Governance Score: ${data.governance_score}%`);
  lines.push(
    `  Policies: ${data.sections.policies.total} (${data.sections.policies.enabled} enabled)`
  );
  lines.push(
    `  Waivers: ${data.sections.waivers.total} (${data.sections.waivers.pending} pending, ${data.sections.waivers.approved} approved)`
  );
  lines.push(
    `  Risks: ${data.sections.risks.total} (${data.sections.risks.high} high, ${data.sections.risks.unmitigated} unmitigated)`
  );
  lines.push(`  Compliance: ${data.sections.compliance.frameworks} framework(s)`);
  lines.push(
    `  Readiness: ${data.sections.readiness.level} (${data.sections.readiness.score ?? 'N/A'}%)`
  );
  lines.push(`  Environment: ${data.sections.environment.current}`);
  lines.push('');
  return lines.join('\n');
}
