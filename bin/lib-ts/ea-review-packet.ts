/**
 * ea-review-packet.ts — Enterprise Architecture Review Packet port (T4.4.3, cluster L).
 *
 * Pure-library port of `bin/lib/ea-review-packet.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `PACKET_SECTIONS` (constant array)
 *   - `generatePacket(root, options?)` => PacketResult
 *
 * Behavior parity:
 *   - Inputs scanned: `specs/architecture.md`, `specs/decisions/*.md`,
 *     `.jumpstart/policies.json`, `.jumpstart/state/waivers.json`,
 *     `.jumpstart/state/risk-register.json`,
 *     `.jumpstart/state/compliance.json`.
 *   - High-risk threshold: score >= 15.
 *   - Active waivers: status === 'approved'.
 *   - Completeness: round((presentSections / 7) * 100).
 *   - JSON parse failures mark section as not present.
 *   - JSON shape validation rejects `__proto__` / `constructor` / `prototype`.
 *   - CLI entry-point intentionally omitted.
 *
 * @see bin/lib/ea-review-packet.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.3
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type PacketSectionKey =
  | 'architecture-overview'
  | 'decision-summary'
  | 'standards-alignment'
  | 'exception-list'
  | 'risk-assessment'
  | 'diagrams'
  | 'compliance-status';

export interface PacketSection {
  present: boolean;
  [key: string]: unknown;
}

export interface PacketOptions {
  [key: string]: unknown;
}

export interface PacketResult {
  success: boolean;
  packet_id: string;
  completeness: number;
  sections_present: number;
  sections_total: number;
  sections: Record<string, PacketSection>;
  gaps: string[];
}

export const PACKET_SECTIONS: PacketSectionKey[] = [
  'architecture-overview',
  'decision-summary',
  'standards-alignment',
  'exception-list',
  'risk-assessment',
  'diagrams',
  'compliance-status',
];

function _safeParseJson(content: string): Record<string, unknown> | null {
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

interface InternalPacket {
  id: string;
  generated_at: string;
  project_root: string;
  sections: Record<string, PacketSection>;
}

/**
 * Generate an EA review packet from project artifacts.
 */
export function generatePacket(root: string, _options: PacketOptions = {}): PacketResult {
  const packet: InternalPacket = {
    id: `EA-${Date.now()}`,
    generated_at: new Date().toISOString(),
    project_root: root,
    sections: {},
  };

  // Architecture overview
  const archFile = join(root, 'specs', 'architecture.md');
  if (existsSync(archFile)) {
    try {
      const content = readFileSync(archFile, 'utf8');
      const sections = content.match(/^##\s+.+$/gm) || [];
      packet.sections['architecture-overview'] = {
        present: true,
        sections: sections.map((s) => s.replace(/^##\s+/, '')),
        word_count: content.split(/\s+/).length,
      };
    } catch {
      packet.sections['architecture-overview'] = { present: false };
    }
  } else {
    packet.sections['architecture-overview'] = { present: false };
  }

  // Decision summary (ADRs)
  const decisionsDir = join(root, 'specs', 'decisions');
  if (existsSync(decisionsDir)) {
    const adrs = readdirSync(decisionsDir).filter((f) => f.endsWith('.md'));
    packet.sections['decision-summary'] = {
      present: adrs.length > 0,
      total_adrs: adrs.length,
      adrs: adrs.map((f) => f.replace('.md', '')),
    };
  } else {
    packet.sections['decision-summary'] = { present: false, total_adrs: 0, adrs: [] };
  }

  // Standards alignment
  const policyFile = join(root, '.jumpstart', 'policies.json');
  if (existsSync(policyFile)) {
    const policies = _safeParseJson(readFileSync(policyFile, 'utf8'));
    if (policies) {
      const policyList = Array.isArray(policies.policies) ? policies.policies : null;
      packet.sections['standards-alignment'] = {
        present: true,
        total_policies: policyList ? policyList.length : 0,
      };
    } else {
      packet.sections['standards-alignment'] = { present: false };
    }
  } else {
    packet.sections['standards-alignment'] = { present: false };
  }

  // Exception list (waivers)
  const waiverFile = join(root, '.jumpstart', 'state', 'waivers.json');
  if (existsSync(waiverFile)) {
    const waivers = _safeParseJson(readFileSync(waiverFile, 'utf8'));
    if (waivers) {
      const list = Array.isArray(waivers.waivers)
        ? (waivers.waivers as Array<Record<string, unknown>>)
        : [];
      const active = list.filter((w) => w.status === 'approved');
      packet.sections['exception-list'] = {
        present: true,
        total_exceptions: active.length,
        exceptions: active.map((w) => ({
          id: w.id,
          title: w.title,
          expires_at: w.expires_at,
        })),
      };
    } else {
      packet.sections['exception-list'] = { present: false };
    }
  } else {
    packet.sections['exception-list'] = { present: false, total_exceptions: 0 };
  }

  // Risk assessment
  const riskFile = join(root, '.jumpstart', 'state', 'risk-register.json');
  if (existsSync(riskFile)) {
    const risks = _safeParseJson(readFileSync(riskFile, 'utf8'));
    if (risks) {
      const list = Array.isArray(risks.risks)
        ? (risks.risks as Array<Record<string, unknown>>)
        : [];
      const highRisks = list.filter(
        (r) => typeof r.score === 'number' && (r.score as number) >= 15
      );
      packet.sections['risk-assessment'] = {
        present: true,
        total_risks: list.length,
        high_risks: highRisks.length,
      };
    } else {
      packet.sections['risk-assessment'] = { present: false };
    }
  } else {
    packet.sections['risk-assessment'] = { present: false };
  }

  // Diagrams
  if (existsSync(archFile)) {
    try {
      const content = readFileSync(archFile, 'utf8');
      const mermaidBlocks = (content.match(/```mermaid/g) || []).length;
      packet.sections.diagrams = { present: mermaidBlocks > 0, count: mermaidBlocks };
    } catch {
      packet.sections.diagrams = { present: false, count: 0 };
    }
  } else {
    packet.sections.diagrams = { present: false, count: 0 };
  }

  // Compliance status
  const complianceFile = join(root, '.jumpstart', 'state', 'compliance.json');
  if (existsSync(complianceFile)) {
    const compliance = _safeParseJson(readFileSync(complianceFile, 'utf8'));
    if (compliance) {
      packet.sections['compliance-status'] = {
        present: true,
        frameworks: Array.isArray(compliance.applied_frameworks)
          ? (compliance.applied_frameworks as unknown[])
          : [],
      };
    } else {
      packet.sections['compliance-status'] = { present: false };
    }
  } else {
    packet.sections['compliance-status'] = { present: false };
  }

  const presentSections = Object.values(packet.sections).filter((s) => s.present).length;
  const completeness = Math.round((presentSections / PACKET_SECTIONS.length) * 100);

  return {
    success: true,
    packet_id: packet.id,
    completeness,
    sections_present: presentSections,
    sections_total: PACKET_SECTIONS.length,
    sections: packet.sections,
    gaps: PACKET_SECTIONS.filter((s) => !packet.sections[s]?.present),
  };
}
