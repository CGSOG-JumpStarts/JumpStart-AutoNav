/**
 * quickstart.js — 5-Minute Quickstart Wizard (UX Feature 15)
 *
 * Streamlined interactive setup that asks 3–4 questions (project name,
 * type, domain, ceremony level) and drops the user into Phase 0 with
 * a clear "what's next" prompt. Composes existing install(), ceremony,
 * and next-phase modules.
 *
 * This module exports the data helpers. The interactive prompts flow
 * is driven from cli.js (which owns the prompts dependency).
 *
 * Usage (library):
 *   import { buildQuickstartConfig, getFirstCommand } from './quickstart.js';
 *   const config = buildQuickstartConfig(answers);
 *   const next = getFirstCommand(config);
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const path = require('path');

// ─── Domain Options ──────────────────────────────────────────────────────────

/**
 * Common project domains with descriptions.
 * Used to populate the wizard select and set project.domain in config.
 */
export const DOMAIN_OPTIONS = [
  { value: 'web-app',       title: 'Web Application',       description: 'Browser-based UI with backend services' },
  { value: 'mobile-app',    title: 'Mobile Application',    description: 'iOS, Android, or cross-platform mobile app' },
  { value: 'api-service',   title: 'API / Microservice',    description: 'REST or GraphQL backend service' },
  { value: 'cli-tool',      title: 'CLI Tool',              description: 'Command-line utility or developer tool' },
  { value: 'library',       title: 'Library / SDK',         description: 'Reusable package consumed by other projects' },
  { value: 'data-pipeline', title: 'Data Pipeline',         description: 'ETL, streaming, or analytics pipeline' },
  { value: 'ecommerce',     title: 'E-Commerce',            description: 'Online store, payments, inventory' },
  { value: 'saas',          title: 'SaaS Platform',         description: 'Multi-tenant software-as-a-service product' },
  { value: 'other',         title: 'Other',                 description: 'Custom domain — enter your own' }
];

// ─── Ceremony Options ────────────────────────────────────────────────────────

/**
 * Ceremony profile options mapped to ceremony.js profiles.
 */
export const CEREMONY_OPTIONS = [
  {
    value: 'light',
    title: 'Light — Fast prototyping',
    description: 'Minimal docs, skip optional gates, fast iteration. Best for proofs of concept and experiments.'
  },
  {
    value: 'standard',
    title: 'Standard — Balanced (recommended)',
    description: 'Full spec workflow with all quality gates. Good default for most projects.'
  },
  {
    value: 'rigorous',
    title: 'Rigorous — Enterprise grade',
    description: 'Maximum ceremony: adversarial review, peer review, strict TDD, security audits. For regulated or high-risk projects.'
  }
];

// ─── Config Builder ──────────────────────────────────────────────────────────

/**
 * Build a complete install configuration from wizard answers.
 * Compatible with the install() function in cli.js.
 *
 * @param {object} answers - Wizard answers.
 * @param {string} [answers.projectName] - Project name.
 * @param {string} [answers.projectType] - 'greenfield' | 'brownfield'.
 * @param {string} [answers.domain] - Domain from DOMAIN_OPTIONS.value.
 * @param {string} [answers.customDomain] - Free-text domain if 'other' was chosen.
 * @param {string} [answers.ceremony] - 'light' | 'standard' | 'rigorous'.
 * @param {string} [answers.targetDir] - Target directory.
 * @param {string} [answers.approverName] - Approver name.
 * @returns {object} Config object compatible with install().
 */
export function buildQuickstartConfig(answers = {}) {
  const domain = answers.domain === 'other'
    ? (answers.customDomain || 'general')
    : (answers.domain || 'general');

  return {
    targetDir: answers.targetDir || '.',
    projectName: answers.projectName || null,
    approverName: answers.approverName || null,
    projectType: answers.projectType || 'greenfield',
    copilot: true, // Enable Copilot integration by default in quickstart
    force: false,
    dryRun: false,
    interactive: false,
    // Quickstart-specific fields (used after install to patch config.yaml)
    domain,
    ceremony: answers.ceremony || 'standard'
  };
}

/**
 * Determine the first command the user should run after setup.
 *
 * @param {object} config - Config from buildQuickstartConfig.
 * @returns {{ command: string, message: string }}
 */
export function getFirstCommand(config) {
  if (config.projectType === 'brownfield') {
    return {
      command: '/jumpstart.scout',
      message: 'Brownfield project detected. The Scout will analyze your existing codebase first.'
    };
  }
  return {
    command: '/jumpstart.challenge',
    message: 'Ready to begin! The Challenger will interrogate your problem space and sharpen the project vision.'
  };
}

/**
 * Generate a formatted summary of the quickstart configuration.
 * Returns plain text (chalk formatting applied by caller in cli.js).
 *
 * @param {object} config - Config from buildQuickstartConfig.
 * @returns {{ lines: string[], firstCommand: string, firstMessage: string }}
 */
export function generateQuickstartSummary(config) {
  const next = getFirstCommand(config);
  const lines = [
    `Project:  ${config.projectName || path.basename(path.resolve(config.targetDir))}`,
    `Type:     ${config.projectType}`,
    `Domain:   ${config.domain}`,
    `Ceremony: ${config.ceremony}`,
    `Copilot:  ${config.copilot ? 'enabled' : 'disabled'}`
  ];

  return {
    lines,
    firstCommand: next.command,
    firstMessage: next.message
  };
}

/**
 * Build the YAML patch lines to add domain and ceremony to config.yaml.
 * Returns { domain_line, ceremony_line } for targeted patching.
 *
 * @param {object} config - Config from buildQuickstartConfig.
 * @returns {{ patches: Array<{pattern: RegExp, replacement: string}> }}
 */
export function getConfigPatches(config) {
  const patches = [];

  // Patch project.domain — add after project.type line
  if (config.domain && config.domain !== 'general') {
    patches.push({
      section: 'project',
      key: 'domain',
      value: config.domain,
      // Insert domain: <value> after the type: line in the project section
      pattern: /^(\s*type:\s*\S+)$/m,
      replacement: `$1\n  domain: ${config.domain}`
    });
  }

  // Patch ceremony.profile
  if (config.ceremony && config.ceremony !== 'standard') {
    patches.push({
      section: 'ceremony',
      key: 'profile',
      value: config.ceremony,
      pattern: /^(\s*profile:\s*)\S+/m,
      replacement: `$1${config.ceremony}`
    });
  }

  return { patches };
}

/**
 * Apply patches to a config.yaml content string.
 *
 * @param {string} content - Raw config.yaml content.
 * @param {object} config - Config from buildQuickstartConfig.
 * @returns {string} Patched content.
 */
export function applyConfigPatches(content, config) {
  let result = content;
  const { patches } = getConfigPatches(config);
  for (const patch of patches) {
    result = result.replace(patch.pattern, patch.replacement);
  }
  return result;
}
