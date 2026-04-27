/**
 * playback-summaries.ts — Stakeholder Playback Summaries port (T4.4.3, cluster L).
 *
 * Pure-library port of `bin/lib/playback-summaries.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `AUDIENCES` (constant array)
 *   - `AUDIENCE_CONFIG` (constant map)
 *   - `generateSummary(root, audience, options?)` => GenerateSummaryResult
 *   - `listAudiences()` => ListAudiencesResult
 *
 * Behavior parity:
 *   - Default audiences: executive/technical/product/operations/compliance.
 *   - Specs scanned from `<root>/specs/*.md`.
 *   - State file at `<root>/.jumpstart/state/state.json` for project status.
 *   - JSON parse failures return defaults silently.
 *   - JSON shape validation rejects `__proto__` / `constructor` / `prototype`.
 *
 * @see bin/lib/playback-summaries.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.3
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Audience = 'executive' | 'technical' | 'product' | 'operations' | 'compliance';

export interface AudienceConfigEntry {
  label: string;
  focus: string[];
  tone: string;
  max_length: number;
}

export interface SummarySectionEntry {
  available: boolean;
  size?: number;
  has_approval?: boolean;
}

export interface ProjectStatus {
  current_phase: number;
  last_agent?: string | null;
}

export interface PlaybackSummary {
  audience: string;
  label: string;
  tone: string;
  focus_areas: string[];
  generated_at: string;
  sections: Record<string, SummarySectionEntry>;
  project_status?: ProjectStatus;
  specs_available?: string[];
  max_length?: number;
}

export interface GenerateSummaryOptions {
  [key: string]: unknown;
}

export interface GenerateSummaryResult {
  success: boolean;
  summary?: PlaybackSummary;
  error?: string;
}

export interface ListAudiencesEntry {
  id: string;
  label: string;
  tone: string;
  focus: string[];
}

export interface ListAudiencesResult {
  success: boolean;
  audiences: ListAudiencesEntry[];
}

export const AUDIENCES: Audience[] = [
  'executive',
  'technical',
  'product',
  'operations',
  'compliance',
];

export const AUDIENCE_CONFIG: Record<Audience, AudienceConfigEntry> = {
  executive: {
    label: 'Executive Summary',
    focus: ['business_value', 'timeline', 'budget', 'risks', 'decisions'],
    tone: 'strategic',
    max_length: 500,
  },
  technical: {
    label: 'Technical Summary',
    focus: ['architecture', 'tech_stack', 'api_design', 'data_model', 'nfrs'],
    tone: 'technical',
    max_length: 1000,
  },
  product: {
    label: 'Product Summary',
    focus: ['user_stories', 'acceptance_criteria', 'personas', 'scope', 'prioritization'],
    tone: 'user-centric',
    max_length: 800,
  },
  operations: {
    label: 'Operations Summary',
    focus: ['deployment', 'monitoring', 'runbooks', 'sla_slo', 'incident_response'],
    tone: 'operational',
    max_length: 700,
  },
  compliance: {
    label: 'Compliance Summary',
    focus: ['regulations', 'controls', 'evidence', 'audit_trail', 'data_classification'],
    tone: 'regulatory',
    max_length: 600,
  },
};

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

/**
 * Generate a playback summary for a target audience.
 */
export function generateSummary(
  root: string,
  audience: string,
  _options: GenerateSummaryOptions = {}
): GenerateSummaryResult {
  if (!AUDIENCES.includes(audience as Audience)) {
    return {
      success: false,
      error: `Unknown audience: ${audience}. Valid: ${AUDIENCES.join(', ')}`,
    };
  }

  const config = AUDIENCE_CONFIG[audience as Audience];
  const summary: PlaybackSummary = {
    audience,
    label: config.label,
    tone: config.tone,
    focus_areas: config.focus,
    generated_at: new Date().toISOString(),
    sections: {},
  };

  const specsDir = join(root, 'specs');
  const availableSpecs: string[] = [];
  if (existsSync(specsDir)) {
    for (const f of readdirSync(specsDir).filter((f) => f.endsWith('.md'))) {
      availableSpecs.push(f);
      try {
        const content = readFileSync(join(specsDir, f), 'utf8');
        summary.sections[f] = {
          available: true,
          size: content.length,
          has_approval: content.includes('Phase Gate Approval'),
        };
      } catch {
        summary.sections[f] = { available: true, size: 0 };
      }
    }
  }

  const stateFile = join(root, '.jumpstart', 'state', 'state.json');
  if (existsSync(stateFile)) {
    const state = _safeParse(readFileSync(stateFile, 'utf8'));
    if (state) {
      summary.project_status = {
        current_phase: typeof state.current_phase === 'number' ? state.current_phase : 0,
        last_agent: typeof state.current_agent === 'string' ? state.current_agent : null,
      };
    } else {
      summary.project_status = { current_phase: 0 };
    }
  } else {
    summary.project_status = { current_phase: 0 };
  }

  summary.specs_available = availableSpecs;
  summary.max_length = config.max_length;

  return { success: true, summary };
}

/**
 * List available audience types.
 */
export function listAudiences(): ListAudiencesResult {
  return {
    success: true,
    audiences: AUDIENCES.map((a) => ({
      id: a,
      label: AUDIENCE_CONFIG[a].label,
      tone: AUDIENCE_CONFIG[a].tone,
      focus: AUDIENCE_CONFIG[a].focus,
    })),
  };
}
