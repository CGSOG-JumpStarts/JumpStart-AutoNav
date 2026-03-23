/**
 * guided-handoff.js — Guided Handoff Packages by Team (Item 73)
 *
 * Product to engineering, engineering to QA, engineering to ops,
 * ops to support handoff package generation.
 *
 * Usage:
 *   node bin/lib/guided-handoff.js generate|list|validate [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const HANDOFF_TYPES = [
  'product-to-engineering',
  'engineering-to-qa',
  'engineering-to-ops',
  'ops-to-support'
];

const HANDOFF_CHECKLISTS = {
  'product-to-engineering': {
    label: 'Product → Engineering',
    required: ['user_stories', 'acceptance_criteria', 'wireframes', 'priorities', 'scope_boundaries'],
    optional: ['competitive_analysis', 'analytics_requirements', 'feature_flags']
  },
  'engineering-to-qa': {
    label: 'Engineering → QA',
    required: ['test_plan', 'api_contracts', 'environment_setup', 'known_limitations', 'test_data'],
    optional: ['performance_baselines', 'security_considerations', 'rollback_procedures']
  },
  'engineering-to-ops': {
    label: 'Engineering → Ops',
    required: ['deployment_guide', 'runbooks', 'monitoring_config', 'rollback_procedures', 'dependencies'],
    optional: ['load_test_results', 'capacity_planning', 'dr_procedures']
  },
  'ops-to-support': {
    label: 'Ops → Support',
    required: ['known_issues', 'troubleshooting_guide', 'escalation_paths', 'sla_details', 'faq'],
    optional: ['common_errors', 'workarounds', 'release_notes']
  }
};

/**
 * Generate a handoff package.
 */
function generateHandoff(type, root, options = {}) {
  if (!HANDOFF_TYPES.includes(type)) {
    return { success: false, error: `Unknown handoff type: ${type}. Valid: ${HANDOFF_TYPES.join(', ')}` };
  }

  const checklist = HANDOFF_CHECKLISTS[type];
  const items = [];

  for (const req of checklist.required) {
    items.push({ name: req, required: true, status: options[req] ? 'provided' : 'missing' });
  }
  for (const opt of checklist.optional) {
    items.push({ name: opt, required: false, status: options[opt] ? 'provided' : 'not_provided' });
  }

  const missing = items.filter(i => i.required && i.status === 'missing');

  return {
    success: true,
    type,
    label: checklist.label,
    items,
    complete: missing.length === 0,
    missing_required: missing.map(i => i.name),
    generated_at: new Date().toISOString()
  };
}

/**
 * List available handoff types.
 */
function listHandoffTypes() {
  return {
    success: true,
    types: HANDOFF_TYPES.map(t => ({
      id: t,
      label: HANDOFF_CHECKLISTS[t].label,
      required_count: HANDOFF_CHECKLISTS[t].required.length,
      optional_count: HANDOFF_CHECKLISTS[t].optional.length
    }))
  };
}

/**
 * Validate a handoff package completeness.
 */
function validateHandoff(type, provided, options = {}) {
  if (!HANDOFF_TYPES.includes(type)) {
    return { success: false, error: `Unknown handoff type: ${type}` };
  }

  const checklist = HANDOFF_CHECKLISTS[type];
  const providedSet = new Set(provided || []);
  const missing = checklist.required.filter(r => !providedSet.has(r));
  const coverage = checklist.required.length > 0
    ? Math.round(((checklist.required.length - missing.length) / checklist.required.length) * 100)
    : 100;

  return {
    success: true,
    type,
    complete: missing.length === 0,
    coverage_pct: coverage,
    missing,
    provided: [...providedSet]
  };
}

module.exports = {
  generateHandoff, listHandoffTypes, validateHandoff,
  HANDOFF_TYPES, HANDOFF_CHECKLISTS
};
