/**
 * context-onboarding.ts — Context-Aware Onboarding port (T4.4.3, cluster L).
 *
 * Pure-library port of `bin/lib/context-onboarding.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `ONBOARDING_SECTIONS` (constant array)
 *   - `generateOnboarding(root, options?)` => GenerateResult
 *   - `customizeForRole(onboarding, role)` => CustomizeResult
 *
 * Behavior parity:
 *   - Reads `<root>/.jumpstart/config.yaml`,
 *     `<root>/specs/decisions/*.md`,
 *     `<root>/.jumpstart/state/risk-register.json`,
 *     `<root>/.jumpstart/state/state.json`,
 *     `<root>/specs/*.md`, `<root>/README.md`, `<root>/package.json`.
 *   - Default role: engineer.
 *   - JSON shape validation rejects `__proto__` / `constructor` / `prototype`.
 *
 * @see bin/lib/context-onboarding.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.3
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface OnboardingSection {
  config_exists?: boolean;
  total?: number;
  files?: Array<{ file: string; name: string } | string>;
  high?: number;
  current_phase?: number;
  current_agent?: string | null;
  has_readme?: boolean;
  has_package_json?: boolean;
}

export interface OnboardingPackage {
  generated_at: string;
  role: string;
  sections: Record<string, OnboardingSection>;
}

export interface GenerateOptions {
  role?: string;
  [key: string]: unknown;
}

export interface GenerateResult {
  success: boolean;
  onboarding: OnboardingPackage;
}

export interface CustomizeResult {
  success: boolean;
  role?: string;
  focus_areas?: string[];
  relevant_sections?: Record<string, OnboardingSection>;
  error?: string;
}

interface RiskEntry {
  score: number;
  [key: string]: unknown;
}

export const ONBOARDING_SECTIONS: string[] = [
  'overview',
  'architecture',
  'decisions',
  'risks',
  'team',
  'getting_started',
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

/**
 * Generate onboarding package for a new team member.
 */
export function generateOnboarding(root: string, options: GenerateOptions = {}): GenerateResult {
  const pkg: OnboardingPackage = {
    generated_at: new Date().toISOString(),
    role: options.role || 'engineer',
    sections: {},
  };

  const configFile = join(root, '.jumpstart', 'config.yaml');
  pkg.sections.overview = { config_exists: existsSync(configFile) };

  const decisionsDir = join(root, 'specs', 'decisions');
  const decisions: Array<{ file: string; name: string }> = [];
  if (existsSync(decisionsDir)) {
    for (const f of readdirSync(decisionsDir).filter((f) => f.endsWith('.md'))) {
      decisions.push({ file: f, name: f.replace('.md', '') });
    }
  }
  pkg.sections.decisions = { total: decisions.length, files: decisions };

  const riskFile = join(root, '.jumpstart', 'state', 'risk-register.json');
  if (existsSync(riskFile)) {
    const risks = _safeParse(readFileSync(riskFile, 'utf8'));
    if (risks) {
      const list = Array.isArray(risks.risks) ? (risks.risks as RiskEntry[]) : [];
      pkg.sections.risks = {
        total: list.length,
        high: list.filter((r) => r.score >= 15).length,
      };
    } else {
      pkg.sections.risks = { total: 0, high: 0 };
    }
  } else {
    pkg.sections.risks = { total: 0, high: 0 };
  }

  const stateFile = join(root, '.jumpstart', 'state', 'state.json');
  if (existsSync(stateFile)) {
    const state = _safeParse(readFileSync(stateFile, 'utf8'));
    if (state) {
      pkg.sections.project_status = {
        current_phase: typeof state.current_phase === 'number' ? state.current_phase : 0,
        current_agent: typeof state.current_agent === 'string' ? state.current_agent : null,
      };
    } else {
      pkg.sections.project_status = { current_phase: 0 };
    }
  } else {
    pkg.sections.project_status = { current_phase: 0 };
  }

  const specsDir = join(root, 'specs');
  const specs: string[] = [];
  if (existsSync(specsDir)) {
    for (const f of readdirSync(specsDir).filter((f) => f.endsWith('.md'))) {
      specs.push(f);
    }
  }
  pkg.sections.specs = { total: specs.length, files: specs };

  const readmeFile = join(root, 'README.md');
  pkg.sections.getting_started = {
    has_readme: existsSync(readmeFile),
    has_package_json: existsSync(join(root, 'package.json')),
  };

  return { success: true, onboarding: pkg };
}

/**
 * Customize onboarding for a specific role.
 */
export function customizeForRole(
  onboarding: OnboardingPackage | null | undefined,
  role: string
): CustomizeResult {
  if (!onboarding) return { success: false, error: 'Onboarding data is required' };

  const roleFocus: Record<string, string[]> = {
    engineer: ['architecture', 'getting_started', 'decisions'],
    product: ['overview', 'specs', 'risks'],
    executive: ['overview', 'risks', 'project_status'],
    qa: ['specs', 'getting_started', 'risks'],
  };

  const focus = roleFocus[role] || roleFocus.engineer;

  return {
    success: true,
    role,
    focus_areas: focus,
    relevant_sections: Object.fromEntries(
      Object.entries(onboarding.sections || {}).filter(([k]) => focus.includes(k))
    ),
  };
}
