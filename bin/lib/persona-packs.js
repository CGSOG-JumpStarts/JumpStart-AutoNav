/**
 * persona-packs.js — Persona Packs for Enterprise Roles (Item 80)
 *
 * Business analyst, product owner, architect, security lead,
 * platform engineer, SRE, data steward persona definitions.
 *
 * Usage:
 *   node bin/lib/persona-packs.js list|get|apply [options]
 */

'use strict';

const PERSONA_CATALOG = {
  'business-analyst': {
    label: 'Business Analyst',
    focus: ['requirements', 'process-modeling', 'stakeholder-management', 'data-analysis'],
    artifacts: ['product-brief', 'prd', 'process-maps'],
    tools: ['elicitation', 'estimation', 'ambiguity-heatmap']
  },
  'product-owner': {
    label: 'Product Owner',
    focus: ['backlog', 'prioritization', 'user-stories', 'acceptance-criteria'],
    artifacts: ['prd', 'product-brief', 'backlog'],
    tools: ['estimation', 'playback-summaries', 'handoff']
  },
  'architect': {
    label: 'Architect',
    focus: ['system-design', 'tech-stack', 'nfrs', 'data-modeling'],
    artifacts: ['architecture', 'decisions', 'diagrams'],
    tools: ['diagram-studio', 'reference-arch', 'fitness-functions']
  },
  'security-lead': {
    label: 'Security Lead',
    focus: ['threat-modeling', 'compliance', 'access-control', 'data-protection'],
    artifacts: ['security-review', 'compliance-report', 'threat-model'],
    tools: ['credential-boundary', 'data-classification', 'compliance-packs']
  },
  'platform-engineer': {
    label: 'Platform Engineer',
    focus: ['infrastructure', 'ci-cd', 'golden-paths', 'developer-experience'],
    artifacts: ['deployment-guide', 'platform-config', 'runbooks'],
    tools: ['ci-cd-integration', 'env-promotion', 'platform-engineering']
  },
  'sre': {
    label: 'Site Reliability Engineer',
    focus: ['monitoring', 'incident-response', 'sla-slo', 'capacity-planning'],
    artifacts: ['runbooks', 'sla-report', 'incident-log'],
    tools: ['sla-slo', 'incident-feedback', 'ops-ownership']
  },
  'data-steward': {
    label: 'Data Steward',
    focus: ['data-governance', 'data-quality', 'lineage', 'classification'],
    artifacts: ['data-catalog', 'classification-report', 'lineage-map'],
    tools: ['data-classification', 'data-contracts', 'domain-ontology']
  }
};

const PERSONAS = Object.keys(PERSONA_CATALOG);

function listPersonas() {
  return {
    success: true,
    personas: PERSONAS.map(p => ({
      id: p,
      label: PERSONA_CATALOG[p].label,
      focus_count: PERSONA_CATALOG[p].focus.length,
      tools_count: PERSONA_CATALOG[p].tools.length
    }))
  };
}

function getPersona(personaId) {
  if (!PERSONA_CATALOG[personaId]) {
    return { success: false, error: `Unknown persona: ${personaId}. Valid: ${PERSONAS.join(', ')}` };
  }
  return { success: true, persona: { id: personaId, ...PERSONA_CATALOG[personaId] } };
}

function applyPersona(personaId, options = {}) {
  if (!PERSONA_CATALOG[personaId]) {
    return { success: false, error: `Unknown persona: ${personaId}` };
  }

  const persona = PERSONA_CATALOG[personaId];
  return {
    success: true,
    persona_id: personaId,
    label: persona.label,
    recommended_tools: persona.tools,
    relevant_artifacts: persona.artifacts,
    focus_areas: persona.focus,
    applied_at: new Date().toISOString()
  };
}

module.exports = {
  listPersonas, getPersona, applyPersona,
  PERSONAS, PERSONA_CATALOG
};
