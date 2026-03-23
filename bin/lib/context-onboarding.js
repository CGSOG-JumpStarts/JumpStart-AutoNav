/**
 * context-onboarding.js — Context-Aware Onboarding (Item 76)
 *
 * New team member enters a project and gets a curated summary,
 * key decisions, and current risks.
 *
 * Usage:
 *   node bin/lib/context-onboarding.js generate|customize [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ONBOARDING_SECTIONS = ['overview', 'architecture', 'decisions', 'risks', 'team', 'getting_started'];

/**
 * Generate onboarding package for a new team member.
 */
function generateOnboarding(root, options = {}) {
  const pkg = {
    generated_at: new Date().toISOString(),
    role: options.role || 'engineer',
    sections: {}
  };

  // Project overview
  const configFile = path.join(root, '.jumpstart', 'config.yaml');
  if (fs.existsSync(configFile)) {
    pkg.sections.overview = { config_exists: true };
  } else {
    pkg.sections.overview = { config_exists: false };
  }

  // Architecture decisions
  const decisionsDir = path.join(root, 'specs', 'decisions');
  const decisions = [];
  if (fs.existsSync(decisionsDir)) {
    for (const f of fs.readdirSync(decisionsDir).filter(f => f.endsWith('.md'))) {
      decisions.push({ file: f, name: f.replace('.md', '') });
    }
  }
  pkg.sections.decisions = { total: decisions.length, files: decisions };

  // Current risks
  const riskFile = path.join(root, '.jumpstart', 'state', 'risk-register.json');
  if (fs.existsSync(riskFile)) {
    try {
      const risks = JSON.parse(fs.readFileSync(riskFile, 'utf8'));
      pkg.sections.risks = {
        total: (risks.risks || []).length,
        high: (risks.risks || []).filter(r => r.score >= 15).length
      };
    } catch { pkg.sections.risks = { total: 0, high: 0 }; }
  } else {
    pkg.sections.risks = { total: 0, high: 0 };
  }

  // Phase status
  const stateFile = path.join(root, '.jumpstart', 'state', 'state.json');
  if (fs.existsSync(stateFile)) {
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      pkg.sections.project_status = {
        current_phase: state.current_phase || 0,
        current_agent: state.current_agent || null
      };
    } catch { pkg.sections.project_status = { current_phase: 0 }; }
  } else {
    pkg.sections.project_status = { current_phase: 0 };
  }

  // Available specs
  const specsDir = path.join(root, 'specs');
  const specs = [];
  if (fs.existsSync(specsDir)) {
    for (const f of fs.readdirSync(specsDir).filter(f => f.endsWith('.md'))) {
      specs.push(f);
    }
  }
  pkg.sections.specs = { total: specs.length, files: specs };

  // Getting started
  const readmeFile = path.join(root, 'README.md');
  pkg.sections.getting_started = {
    has_readme: fs.existsSync(readmeFile),
    has_package_json: fs.existsSync(path.join(root, 'package.json'))
  };

  return { success: true, onboarding: pkg };
}

/**
 * Customize onboarding for a specific role.
 */
function customizeForRole(onboarding, role) {
  if (!onboarding) return { success: false, error: 'Onboarding data is required' };

  const roleFocus = {
    engineer: ['architecture', 'getting_started', 'decisions'],
    product: ['overview', 'specs', 'risks'],
    executive: ['overview', 'risks', 'project_status'],
    qa: ['specs', 'getting_started', 'risks']
  };

  const focus = roleFocus[role] || roleFocus.engineer;
  
  return {
    success: true,
    role,
    focus_areas: focus,
    relevant_sections: Object.fromEntries(
      Object.entries(onboarding.sections || {}).filter(([k]) => focus.includes(k))
    )
  };
}

module.exports = {
  generateOnboarding, customizeForRole,
  ONBOARDING_SECTIONS
};
