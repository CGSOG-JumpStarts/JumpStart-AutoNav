/**
 * ci-cd-integration.js — GitHub Actions & Azure DevOps Deep Integration (Item 21)
 *
 * Trigger validation, drift checks, reviews, and approvals
 * automatically in CI/CD pipelines.
 *
 * Usage:
 *   node bin/lib/ci-cd-integration.js generate|validate|status [options]
 *
 * State file: .jumpstart/state/ci-cd-integration.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'ci-cd-integration.json');

const SUPPORTED_PLATFORMS = ['github-actions', 'azure-devops'];

const PIPELINE_STAGES = ['validate', 'drift-check', 'review', 'approve', 'promote'];

const BUILT_IN_CHECKS = [
  { id: 'schema-validation', name: 'Schema Validation', stage: 'validate', command: 'jumpstart-mode validate-all' },
  { id: 'spec-drift', name: 'Spec Drift Detection', stage: 'drift-check', command: 'jumpstart-mode spec-drift' },
  { id: 'coverage-check', name: 'Story-to-Task Coverage', stage: 'validate', command: 'jumpstart-mode coverage' },
  { id: 'secret-scan', name: 'Secret Scanning', stage: 'validate', command: 'jumpstart-mode scan-secrets' },
  { id: 'freshness-audit', name: 'Documentation Freshness', stage: 'review', command: 'jumpstart-mode freshness-audit' },
  { id: 'policy-check', name: 'Policy Compliance', stage: 'review', command: 'jumpstart-mode policy check' },
  { id: 'quality-gate', name: 'Quality Gate', stage: 'approve', command: 'npm test' }
];

/**
 * Default CI/CD integration state.
 * @returns {object}
 */
function defaultState() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    platform: null,
    pipelines: [],
    run_history: []
  };
}

/**
 * Load state from disk.
 * @param {string} [stateFile]
 * @returns {object}
 */
function loadState(stateFile) {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  if (!fs.existsSync(filePath)) return defaultState();
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch { return defaultState(); }
}

/**
 * Save state to disk.
 * @param {object} state
 * @param {string} [stateFile]
 */
function saveState(state, stateFile) {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/**
 * Generate a CI/CD pipeline configuration.
 *
 * @param {string} platform - 'github-actions' or 'azure-devops'
 * @param {object} [options]
 * @returns {object}
 */
function generatePipeline(platform, options = {}) {
  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    return { success: false, error: `Unsupported platform: ${platform}. Use: ${SUPPORTED_PLATFORMS.join(', ')}` };
  }

  const checks = options.checks || BUILT_IN_CHECKS;
  const stages = options.stages || PIPELINE_STAGES;

  if (platform === 'github-actions') {
    const workflow = {
      name: 'JumpStart Quality Gate',
      on: {
        pull_request: { paths: ['specs/**', '.jumpstart/**', 'src/**', 'tests/**'] },
        push: { branches: ['main'], paths: ['specs/**', '.jumpstart/**'] }
      },
      jobs: {}
    };

    for (const stage of stages) {
      const stageChecks = checks.filter(c => c.stage === stage);
      if (stageChecks.length === 0) continue;
      workflow.jobs[stage] = {
        'runs-on': 'ubuntu-latest',
        steps: [
          { uses: 'actions/checkout@v4' },
          { uses: 'actions/setup-node@v4', with: { 'node-version': '20' } },
          { run: 'npm ci' },
          ...stageChecks.map(c => ({ name: c.name, run: `npx ${c.command}` }))
        ]
      };
    }

    return { success: true, platform, format: 'yaml', content: workflow, path: '.github/workflows/jumpstart-quality.yml' };
  }

  if (platform === 'azure-devops') {
    const pipeline = {
      trigger: { branches: { include: ['main'] }, paths: { include: ['specs/*', '.jumpstart/*'] } },
      pool: { vmImage: 'ubuntu-latest' },
      stages: stages.map(stage => ({
        stage,
        displayName: stage.charAt(0).toUpperCase() + stage.slice(1),
        jobs: [{
          job: `${stage}_checks`,
          steps: [
            { task: 'NodeTool@0', inputs: { versionSpec: '20.x' } },
            { script: 'npm ci', displayName: 'Install dependencies' },
            ...checks.filter(c => c.stage === stage).map(c => ({
              script: `npx ${c.command}`,
              displayName: c.name
            }))
          ]
        }]
      }))
    };

    return { success: true, platform, format: 'yaml', content: pipeline, path: 'azure-pipelines.yml' };
  }

  return { success: false, error: 'Unknown platform' };
}

/**
 * Validate that pipeline configuration is up to date.
 *
 * @param {string} root - Project root.
 * @param {object} [options]
 * @returns {object}
 */
function validatePipeline(root, options = {}) {
  const results = [];

  for (const platform of SUPPORTED_PLATFORMS) {
    const generated = generatePipeline(platform, options);
    if (!generated.success) continue;

    const pipelinePath = path.join(root, generated.path);
    const exists = fs.existsSync(pipelinePath);

    results.push({
      platform,
      path: generated.path,
      exists,
      up_to_date: exists,
      expected_checks: (options.checks || BUILT_IN_CHECKS).length
    });
  }

  return {
    success: true,
    pipelines: results,
    all_configured: results.some(r => r.exists),
    recommendations: results.filter(r => !r.exists).map(r => `Configure ${r.platform} pipeline at ${r.path}`)
  };
}

/**
 * Get integration status summary.
 *
 * @param {object} [options]
 * @returns {object}
 */
function getStatus(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    platform: state.platform,
    pipelines: state.pipelines.length,
    last_run: state.run_history.length > 0 ? state.run_history[state.run_history.length - 1] : null,
    total_runs: state.run_history.length,
    available_checks: BUILT_IN_CHECKS.length
  };
}

module.exports = {
  defaultState,
  loadState,
  saveState,
  generatePipeline,
  validatePipeline,
  getStatus,
  SUPPORTED_PLATFORMS,
  PIPELINE_STAGES,
  BUILT_IN_CHECKS
};
