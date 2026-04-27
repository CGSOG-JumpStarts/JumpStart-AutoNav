/**
 * cab-output.ts — Change Advisory Board Output port (T4.4.3, cluster L).
 *
 * Pure-library port of `bin/lib/cab-output.js`. Public surface preserved
 * verbatim by name + signature:
 *
 *   - `CAB_SECTIONS` (constant array)
 *   - `generateCABSummary(root, options?)` => CABResult
 *
 * Behavior parity:
 *   - Reads `<root>/specs/prd.md`, `<root>/specs/architecture.md`,
 *     `<root>/specs/implementation-plan.md`,
 *     `<root>/.jumpstart/state/risk-register.json`,
 *     `<root>/.jumpstart/state/role-approvals.json`.
 *   - Risk-level threshold: any high risk → 'high', else completeness>=70 → 'standard', else 'elevated'.
 *   - JSON shape validation rejects `__proto__` / `constructor` / `prototype`.
 *
 * @see bin/lib/cab-output.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.3
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface CABSectionEntry {
  present: boolean;
  title?: string;
  user_stories?: number;
  total_risks?: number;
  high_risks?: number;
  recommendation?: string;
  total?: number;
  approved?: number;
}

export interface CABResult {
  success: boolean;
  cab_id: string;
  completeness: number;
  risk_level: 'high' | 'standard' | 'elevated';
  recommendation: string;
  sections: Record<string, CABSectionEntry>;
  gaps: string[];
}

export interface CABOptions {
  [key: string]: unknown;
}

export const CAB_SECTIONS: string[] = [
  'change-description',
  'risk-assessment',
  'impact-analysis',
  'rollback-plan',
  'testing-summary',
  'approval-status',
  'implementation-schedule',
  'communication-plan',
];

function _safeParse(content: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') return null;
  }
  return obj;
}

interface RiskEntry {
  score: number;
  [key: string]: unknown;
}

interface ApprovalWorkflow {
  status: string;
  [key: string]: unknown;
}

/**
 * Generate a CAB-ready change summary.
 */
export function generateCABSummary(root: string, _options: CABOptions = {}): CABResult {
  const summaryId = `CAB-${Date.now()}`;
  const sections: Record<string, CABSectionEntry> = {};

  // Change description
  const prdFile = join(root, 'specs', 'prd.md');
  if (existsSync(prdFile)) {
    try {
      const content = readFileSync(prdFile, 'utf8');
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const stories = (content.match(/\bE\d+-S\d+\b/g) || []).length;
      sections['change-description'] = {
        present: true,
        title: titleMatch ? titleMatch[1] : 'Untitled',
        user_stories: stories,
      };
    } catch {
      sections['change-description'] = { present: false };
    }
  } else {
    sections['change-description'] = { present: false };
  }

  // Risk assessment
  const riskFile = join(root, '.jumpstart', 'state', 'risk-register.json');
  if (existsSync(riskFile)) {
    const risks = _safeParse(readFileSync(riskFile, 'utf8'));
    if (risks) {
      const list = Array.isArray(risks.risks) ? (risks.risks as RiskEntry[]) : [];
      const high = list.filter((r) => r.score >= 15);
      sections['risk-assessment'] = {
        present: true,
        total_risks: list.length,
        high_risks: high.length,
      };
    } else {
      sections['risk-assessment'] = { present: false };
    }
  } else {
    sections['risk-assessment'] = { present: false };
  }

  // Impact analysis
  const archFile = join(root, 'specs', 'architecture.md');
  sections['impact-analysis'] = { present: existsSync(archFile) };

  // Rollback plan
  sections['rollback-plan'] = {
    present: false,
    recommendation: 'Define rollback strategy in architecture specs',
  };
  if (existsSync(archFile)) {
    try {
      const content = readFileSync(archFile, 'utf8');
      if (/rollback|roll.back|revert/i.test(content)) {
        sections['rollback-plan'] = { present: true };
      }
    } catch {
      /* ignore */
    }
  }

  // Testing summary
  const hasTests = existsSync(join(root, 'tests')) || existsSync(join(root, 'test'));
  sections['testing-summary'] = { present: hasTests };

  // Approval status
  const approvalFile = join(root, '.jumpstart', 'state', 'role-approvals.json');
  if (existsSync(approvalFile)) {
    const approvals = _safeParse(readFileSync(approvalFile, 'utf8'));
    if (approvals?.workflows && typeof approvals.workflows === 'object') {
      const workflows = Object.values(approvals.workflows as Record<string, ApprovalWorkflow>);
      const approved = workflows.filter((w) => w.status === 'approved').length;
      sections['approval-status'] = {
        present: true,
        total: workflows.length,
        approved,
      };
    } else {
      sections['approval-status'] = { present: false };
    }
  } else {
    sections['approval-status'] = { present: false };
  }

  // Implementation schedule
  const planFile = join(root, 'specs', 'implementation-plan.md');
  sections['implementation-schedule'] = { present: existsSync(planFile) };

  // Communication plan
  sections['communication-plan'] = { present: false, recommendation: 'Add communication plan' };

  const presentSections = Object.values(sections).filter((s) => s.present).length;
  const completeness = Math.round((presentSections / CAB_SECTIONS.length) * 100);

  const ra = sections['risk-assessment'];
  const riskLevel: 'high' | 'standard' | 'elevated' =
    ra && (ra.high_risks ?? 0) > 0 ? 'high' : completeness >= 70 ? 'standard' : 'elevated';

  return {
    success: true,
    cab_id: summaryId,
    completeness,
    risk_level: riskLevel,
    recommendation: completeness >= 80 ? 'Ready for CAB review' : 'Additional documentation needed',
    sections,
    gaps: CAB_SECTIONS.filter((s) => !sections[s]?.present),
  };
}
