/**
 * playback-summaries.js — Stakeholder Playback Summaries (Item 68)
 *
 * Translate technical outputs into business-language summaries
 * for each audience.
 *
 * Usage:
 *   node bin/lib/playback-summaries.js generate|list [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const AUDIENCES = ['executive', 'technical', 'product', 'operations', 'compliance'];

const AUDIENCE_CONFIG = {
  executive: {
    label: 'Executive Summary',
    focus: ['business_value', 'timeline', 'budget', 'risks', 'decisions'],
    tone: 'strategic',
    max_length: 500
  },
  technical: {
    label: 'Technical Summary',
    focus: ['architecture', 'tech_stack', 'api_design', 'data_model', 'nfrs'],
    tone: 'technical',
    max_length: 1000
  },
  product: {
    label: 'Product Summary',
    focus: ['user_stories', 'acceptance_criteria', 'personas', 'scope', 'prioritization'],
    tone: 'user-centric',
    max_length: 800
  },
  operations: {
    label: 'Operations Summary',
    focus: ['deployment', 'monitoring', 'runbooks', 'sla_slo', 'incident_response'],
    tone: 'operational',
    max_length: 700
  },
  compliance: {
    label: 'Compliance Summary',
    focus: ['regulations', 'controls', 'evidence', 'audit_trail', 'data_classification'],
    tone: 'regulatory',
    max_length: 600
  }
};

/**
 * Generate a playback summary for a target audience.
 */
function generateSummary(root, audience, options = {}) {
  if (!AUDIENCES.includes(audience)) {
    return { success: false, error: `Unknown audience: ${audience}. Valid: ${AUDIENCES.join(', ')}` };
  }

  const config = AUDIENCE_CONFIG[audience];
  const summary = {
    audience,
    label: config.label,
    tone: config.tone,
    focus_areas: config.focus,
    generated_at: new Date().toISOString(),
    sections: {}
  };

  // Gather data from available specs
  const specsDir = path.join(root, 'specs');
  const availableSpecs = [];
  if (fs.existsSync(specsDir)) {
    for (const f of fs.readdirSync(specsDir).filter(f => f.endsWith('.md'))) {
      availableSpecs.push(f);
      try {
        const content = fs.readFileSync(path.join(specsDir, f), 'utf8');
        summary.sections[f] = {
          available: true,
          size: content.length,
          has_approval: content.includes('Phase Gate Approval')
        };
      } catch { summary.sections[f] = { available: true, size: 0 }; }
    }
  }

  // Phase status
  const stateFile = path.join(root, '.jumpstart', 'state', 'state.json');
  if (fs.existsSync(stateFile)) {
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      summary.project_status = {
        current_phase: state.current_phase || 0,
        last_agent: state.current_agent || null
      };
    } catch { summary.project_status = { current_phase: 0 }; }
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
function listAudiences() {
  return {
    success: true,
    audiences: AUDIENCES.map(a => ({
      id: a,
      label: AUDIENCE_CONFIG[a].label,
      tone: AUDIENCE_CONFIG[a].tone,
      focus: AUDIENCE_CONFIG[a].focus
    }))
  };
}

module.exports = {
  generateSummary,
  listAudiences,
  AUDIENCES,
  AUDIENCE_CONFIG
};
