/**
 * role-views.ts — role-based project views port (T4.3.3, cluster H).
 *
 * Pure-library port of `bin/lib/role-views.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `ROLES` (constant array)
 *   - `ROLE_FOCUS` (constant map)
 *   - `generateView(root, role, options?)` => {success, view?, error?}
 *   - `listRoles()` => {success, roles}
 *   - `generateRoleSummary(root, role)` => {success, summary?, error?}
 *
 * Behavior parity:
 *   - Role list, focus areas, and exclude lists verbatim from legacy.
 *   - State file path: `.jumpstart/state/state.json`.
 *   - Risk register path: `.jumpstart/state/risk-register.json` (only
 *     read for roles whose focus includes `risks`).
 *   - JSON parse failures return safe defaults (no throw).
 *
 * @see bin/lib/role-views.js (legacy reference)
 * @see specs/implementation-plan.md T4.3.3
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Public types

export type RoleId = 'executive' | 'architect' | 'product' | 'engineer';

export interface RoleConfig {
  label: string;
  focus: string[];
  exclude: string[];
}

export interface PhaseStatus {
  current_phase: number | string;
  current_agent?: string | null;
}

export interface RiskSummary {
  total: number;
  high: number;
}

export interface RoleViewSections {
  available_specs?: string[];
  phase_status?: PhaseStatus;
  risks?: RiskSummary;
  [key: string]: unknown;
}

export interface RoleView {
  role: RoleId;
  label: string;
  generated_at: string;
  focus_areas: string[];
  excluded_areas: string[];
  sections: RoleViewSections;
}

export interface GenerateViewResult {
  success: boolean;
  view?: RoleView;
  error?: string;
}

export interface ListRolesEntry {
  id: RoleId;
  label: string;
  focus: string[];
  exclude: string[];
}

export interface ListRolesResult {
  success: boolean;
  roles: ListRolesEntry[];
}

export interface RoleSummary {
  role: RoleId;
  label: string;
  current_phase: number | string;
  specs_count: number;
  generated_at: string;
}

export interface GenerateRoleSummaryResult {
  success: boolean;
  summary?: RoleSummary;
  error?: string;
}

// Constants (verbatim from legacy)

export const ROLES: RoleId[] = ['executive', 'architect', 'product', 'engineer'];

export const ROLE_FOCUS: Record<RoleId, RoleConfig> = {
  executive: {
    label: 'Executive View',
    focus: ['timeline', 'risks', 'budget', 'milestones', 'decisions'],
    exclude: ['code_details', 'test_coverage', 'api_contracts'],
  },
  architect: {
    label: 'Architect View',
    focus: ['components', 'data_model', 'api_contracts', 'decisions', 'tech_stack', 'nfrs'],
    exclude: ['budget', 'stakeholder_comms'],
  },
  product: {
    label: 'Product View',
    focus: ['stories', 'acceptance_criteria', 'personas', 'journeys', 'scope', 'priorities'],
    exclude: ['api_contracts', 'data_model', 'test_coverage'],
  },
  engineer: {
    label: 'Engineer View',
    focus: ['tasks', 'api_contracts', 'data_model', 'test_coverage', 'tech_stack', 'code_details'],
    exclude: ['budget', 'stakeholder_comms', 'personas'],
  },
};

// Implementation

/** Generate a role-specific view of the project. */
export function generateView(
  root: string,
  role: string,
  _options: Record<string, unknown> = {}
): GenerateViewResult {
  if (!ROLES.includes(role as RoleId)) {
    return { success: false, error: `Unknown role: ${role}. Valid roles: ${ROLES.join(', ')}` };
  }

  const typedRole = role as RoleId;
  const config = ROLE_FOCUS[typedRole];
  const view: RoleView = {
    role: typedRole,
    label: config.label,
    generated_at: new Date().toISOString(),
    focus_areas: config.focus,
    excluded_areas: config.exclude,
    sections: {},
  };

  // Gather available specs
  const specsDir = join(root, 'specs');
  const availableSpecs: string[] = [];
  if (existsSync(specsDir)) {
    for (const f of readdirSync(specsDir).filter((entry) => entry.endsWith('.md'))) {
      availableSpecs.push(f);
    }
  }
  view.sections.available_specs = availableSpecs;

  // Phase status
  const stateFile = join(root, '.jumpstart', 'state', 'state.json');
  if (existsSync(stateFile)) {
    try {
      const state = JSON.parse(readFileSync(stateFile, 'utf8')) as {
        current_phase?: number | string;
        current_agent?: string | null;
      };
      view.sections.phase_status = {
        current_phase: state.current_phase || 0,
        current_agent: state.current_agent || null,
      };
    } catch {
      view.sections.phase_status = { current_phase: 0 };
    }
  } else {
    view.sections.phase_status = { current_phase: 0 };
  }

  // Risk summary (if relevant to role)
  if (config.focus.includes('risks')) {
    const riskFile = join(root, '.jumpstart', 'state', 'risk-register.json');
    if (existsSync(riskFile)) {
      try {
        const risks = JSON.parse(readFileSync(riskFile, 'utf8')) as {
          risks?: Array<{ score?: number }>;
        };
        view.sections.risks = {
          total: (risks.risks || []).length,
          high: (risks.risks || []).filter((r) => (r.score ?? 0) >= 15).length,
        };
      } catch {
        view.sections.risks = { total: 0, high: 0 };
      }
    } else {
      view.sections.risks = { total: 0, high: 0 };
    }
  }

  return { success: true, view };
}

/** List all available roles and their focus areas. */
export function listRoles(): ListRolesResult {
  return {
    success: true,
    roles: ROLES.map((r) => ({
      id: r,
      label: ROLE_FOCUS[r].label,
      focus: ROLE_FOCUS[r].focus,
      exclude: ROLE_FOCUS[r].exclude,
    })),
  };
}

/** Generate summary for a specific role. */
export function generateRoleSummary(root: string, role: string): GenerateRoleSummaryResult {
  const viewResult = generateView(root, role);
  if (!viewResult.success || !viewResult.view) {
    return { success: false, error: viewResult.error };
  }

  const view = viewResult.view;
  const summary: RoleSummary = {
    role: view.role,
    label: view.label,
    current_phase: view.sections.phase_status ? view.sections.phase_status.current_phase : 0,
    specs_count: view.sections.available_specs ? view.sections.available_specs.length : 0,
    generated_at: view.generated_at,
  };

  return { success: true, summary };
}
