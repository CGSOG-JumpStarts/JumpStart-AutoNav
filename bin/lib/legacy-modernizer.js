/**
 * legacy-modernizer.js — Legacy Code Modernization Mode (Item 48)
 *
 * COBOL, .NET Framework, Java monolith, SSIS, old Angular,
 * old React, etc.
 *
 * Usage:
 *   node bin/lib/legacy-modernizer.js assess|plan|report [options]
 *
 * State file: .jumpstart/state/legacy-modernization.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'legacy-modernization.json');

const LEGACY_PLATFORMS = {
  'cobol': { risk: 'high', strategy: 'strangler-fig', estimated_effort: 'very-high' },
  'dotnet-framework': { risk: 'medium', strategy: 'phased-cutover', estimated_effort: 'high' },
  'java-monolith': { risk: 'medium', strategy: 'strangler-fig', estimated_effort: 'high' },
  'ssis': { risk: 'medium', strategy: 'phased-cutover', estimated_effort: 'medium' },
  'angular-legacy': { risk: 'low', strategy: 'phased-cutover', estimated_effort: 'medium' },
  'react-legacy': { risk: 'low', strategy: 'in-place', estimated_effort: 'low' },
  'jquery': { risk: 'low', strategy: 'phased-cutover', estimated_effort: 'medium' },
  'php-legacy': { risk: 'medium', strategy: 'strangler-fig', estimated_effort: 'high' }
};

const MODERNIZATION_PATTERNS = ['strangler-fig', 'phased-cutover', 'big-bang', 'in-place', 'rewrite'];

function defaultState() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    assessments: [],
    modernization_plans: []
  };
}

function loadState(stateFile) {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  if (!fs.existsSync(filePath)) return defaultState();
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return defaultState(); }
}

function saveState(state, stateFile) {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/**
 * Assess a legacy system for modernization.
 *
 * @param {object} system - { name, platform, age_years?, loc?, dependencies? }
 * @param {object} [options]
 * @returns {object}
 */
function assessSystem(system, options = {}) {
  if (!system || !system.name || !system.platform) {
    return { success: false, error: 'name and platform are required' };
  }

  const platform = system.platform.toLowerCase();
  const platformInfo = LEGACY_PLATFORMS[platform] || { risk: 'medium', strategy: 'phased-cutover', estimated_effort: 'medium' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const assessment = {
    id: `LEG-${(state.assessments.length + 1).toString().padStart(3, '0')}`,
    name: system.name,
    platform,
    age_years: system.age_years || null,
    loc: system.loc || null,
    risk_level: platformInfo.risk,
    recommended_strategy: platformInfo.strategy,
    estimated_effort: platformInfo.estimated_effort,
    modernization_targets: system.modernization_targets || [],
    assessed_at: new Date().toISOString()
  };

  state.assessments.push(assessment);
  saveState(state, stateFile);

  return { success: true, assessment };
}

/**
 * Create a modernization plan.
 *
 * @param {string} assessmentId
 * @param {object} plan - { target_platform, phases[], timeline? }
 * @param {object} [options]
 * @returns {object}
 */
function createPlan(assessmentId, plan, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const assessment = state.assessments.find(a => a.id === assessmentId);
  if (!assessment) return { success: false, error: `Assessment not found: ${assessmentId}` };

  const modPlan = {
    id: `MOD-${(state.modernization_plans.length + 1).toString().padStart(3, '0')}`,
    assessment_id: assessmentId,
    source_platform: assessment.platform,
    target_platform: plan.target_platform || 'modern-stack',
    strategy: assessment.recommended_strategy,
    phases: (plan.phases || ['assess', 'plan', 'implement', 'validate', 'cutover']).map((p, i) => ({
      order: i + 1,
      name: typeof p === 'string' ? p : p.name,
      status: 'pending'
    })),
    timeline: plan.timeline || null,
    created_at: new Date().toISOString()
  };

  state.modernization_plans.push(modPlan);
  saveState(state, stateFile);

  return { success: true, plan: modPlan };
}

/**
 * Generate modernization report.
 *
 * @param {object} [options]
 * @returns {object}
 */
function generateReport(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    total_assessments: state.assessments.length,
    total_plans: state.modernization_plans.length,
    by_platform: state.assessments.reduce((acc, a) => { acc[a.platform] = (acc[a.platform] || 0) + 1; return acc; }, {}),
    by_risk: state.assessments.reduce((acc, a) => { acc[a.risk_level] = (acc[a.risk_level] || 0) + 1; return acc; }, {}),
    assessments: state.assessments
  };
}

module.exports = {
  defaultState,
  loadState,
  saveState,
  assessSystem,
  createPlan,
  generateReport,
  LEGACY_PLATFORMS,
  MODERNIZATION_PATTERNS
};
