/**
 * role-views.js — Role-Based Project Views (Item 62)
 *
 * Same project data, different role-based lenses for
 * executive, architect, product, and engineer audiences.
 *
 * Usage:
 *   node bin/lib/role-views.js generate|list [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROLES = ['executive', 'architect', 'product', 'engineer'];

const ROLE_FOCUS = {
  executive: {
    label: 'Executive View',
    focus: ['timeline', 'risks', 'budget', 'milestones', 'decisions'],
    exclude: ['code_details', 'test_coverage', 'api_contracts']
  },
  architect: {
    label: 'Architect View',
    focus: ['components', 'data_model', 'api_contracts', 'decisions', 'tech_stack', 'nfrs'],
    exclude: ['budget', 'stakeholder_comms']
  },
  product: {
    label: 'Product View',
    focus: ['stories', 'acceptance_criteria', 'personas', 'journeys', 'scope', 'priorities'],
    exclude: ['api_contracts', 'data_model', 'test_coverage']
  },
  engineer: {
    label: 'Engineer View',
    focus: ['tasks', 'api_contracts', 'data_model', 'test_coverage', 'tech_stack', 'code_details'],
    exclude: ['budget', 'stakeholder_comms', 'personas']
  }
};

/**
 * Generate a role-specific view of the project.
 */
function generateView(root, role, options = {}) {
  if (!ROLES.includes(role)) {
    return { success: false, error: `Unknown role: ${role}. Valid roles: ${ROLES.join(', ')}` };
  }

  const config = ROLE_FOCUS[role];
  const view = {
    role,
    label: config.label,
    generated_at: new Date().toISOString(),
    focus_areas: config.focus,
    excluded_areas: config.exclude,
    sections: {}
  };

  // Gather available specs
  const specsDir = path.join(root, 'specs');
  const availableSpecs = [];
  if (fs.existsSync(specsDir)) {
    for (const f of fs.readdirSync(specsDir).filter(f => f.endsWith('.md'))) {
      availableSpecs.push(f);
    }
  }
  view.sections.available_specs = availableSpecs;

  // Phase status
  const stateFile = path.join(root, '.jumpstart', 'state', 'state.json');
  if (fs.existsSync(stateFile)) {
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      view.sections.phase_status = {
        current_phase: state.current_phase || 0,
        current_agent: state.current_agent || null
      };
    } catch { view.sections.phase_status = { current_phase: 0 }; }
  } else {
    view.sections.phase_status = { current_phase: 0 };
  }

  // Risk summary (if relevant to role)
  if (config.focus.includes('risks')) {
    const riskFile = path.join(root, '.jumpstart', 'state', 'risk-register.json');
    if (fs.existsSync(riskFile)) {
      try {
        const risks = JSON.parse(fs.readFileSync(riskFile, 'utf8'));
        view.sections.risks = {
          total: (risks.risks || []).length,
          high: (risks.risks || []).filter(r => r.score >= 15).length
        };
      } catch { view.sections.risks = { total: 0, high: 0 }; }
    } else {
      view.sections.risks = { total: 0, high: 0 };
    }
  }

  return { success: true, view };
}

/**
 * List all available roles and their focus areas.
 */
function listRoles() {
  return {
    success: true,
    roles: ROLES.map(r => ({
      id: r,
      label: ROLE_FOCUS[r].label,
      focus: ROLE_FOCUS[r].focus,
      exclude: ROLE_FOCUS[r].exclude
    }))
  };
}

/**
 * Generate summary for a specific role.
 */
function generateRoleSummary(root, role) {
  const viewResult = generateView(root, role);
  if (!viewResult.success) return viewResult;

  const view = viewResult.view;
  const summary = {
    role,
    label: view.label,
    current_phase: view.sections.phase_status ? view.sections.phase_status.current_phase : 0,
    specs_count: view.sections.available_specs ? view.sections.available_specs.length : 0,
    generated_at: view.generated_at
  };

  return { success: true, summary };
}

module.exports = {
  generateView,
  listRoles,
  generateRoleSummary,
  ROLES,
  ROLE_FOCUS
};
