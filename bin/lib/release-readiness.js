/**
 * release-readiness.js — Release Readiness Reviews (Item 26)
 *
 * Generate go/no-go packets covering quality, incidents, NFRs,
 * dependencies, and rollback plans.
 *
 * Usage:
 *   node bin/lib/release-readiness.js assess|report|status [options]
 *
 * State file: .jumpstart/state/release-readiness.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'release-readiness.json');

const READINESS_CATEGORIES = ['quality', 'security', 'performance', 'dependencies', 'documentation',
  'rollback', 'monitoring', 'compliance'];

const READINESS_LEVELS = [
  { min: 90, label: 'Ready', emoji: '🟢', recommendation: 'go' },
  { min: 70, label: 'Conditionally Ready', emoji: '🟡', recommendation: 'conditional-go' },
  { min: 50, label: 'Not Ready', emoji: '🟠', recommendation: 'no-go' },
  { min: 0, label: 'Blocked', emoji: '🔴', recommendation: 'blocked' }
];

function defaultState() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    assessments: [],
    current_readiness: null
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
 * Assess release readiness across all categories.
 *
 * @param {string} root - Project root.
 * @param {object} [options]
 * @returns {object}
 */
function assessReadiness(root, options = {}) {
  const scores = {};

  // Quality: check if tests exist and specs are approved
  const hasTests = fs.existsSync(path.join(root, 'tests')) || fs.existsSync(path.join(root, 'test'));
  const hasSpecs = fs.existsSync(path.join(root, 'specs'));
  scores.quality = hasTests && hasSpecs ? 80 : hasTests ? 60 : 30;

  // Security: check for secret scanner results, policy engine
  const hasSecurityScan = fs.existsSync(path.join(root, '.jumpstart', 'state', 'secret-scan-results.json'));
  const hasPolicies = fs.existsSync(path.join(root, '.jumpstart', 'policies.json'));
  scores.security = hasSecurityScan && hasPolicies ? 85 : hasPolicies ? 60 : 40;

  // Performance: check for NFR documentation
  const archFile = path.join(root, 'specs', 'architecture.md');
  let hasNFRs = false;
  if (fs.existsSync(archFile)) {
    try {
      const content = fs.readFileSync(archFile, 'utf8');
      hasNFRs = /\bNFR\b|non-functional|performance/i.test(content);
    } catch { /* ignore */ }
  }
  scores.performance = hasNFRs ? 75 : 40;

  // Dependencies: check for lock file
  const hasLockFile = fs.existsSync(path.join(root, 'package-lock.json')) ||
                      fs.existsSync(path.join(root, 'yarn.lock'));
  scores.dependencies = hasLockFile ? 80 : 50;

  // Documentation
  const hasReadme = fs.existsSync(path.join(root, 'README.md'));
  scores.documentation = hasReadme && hasSpecs ? 85 : hasReadme ? 60 : 30;

  // Rollback: check for rollback plan in specs
  scores.rollback = 50; // Default: needs manual assessment

  // Monitoring: check for ops ownership
  scores.monitoring = 50; // Default: needs manual assessment

  // Compliance: check for compliance state
  const hasCompliance = fs.existsSync(path.join(root, '.jumpstart', 'state', 'compliance.json'));
  scores.compliance = hasCompliance ? 70 : 40;

  const totalScore = Math.round(
    Object.values(scores).reduce((sum, s) => sum + s, 0) / READINESS_CATEGORIES.length
  );

  const level = READINESS_LEVELS.find(l => totalScore >= l.min) || READINESS_LEVELS[READINESS_LEVELS.length - 1];

  const assessment = {
    id: `rr-${Date.now()}`,
    assessed_at: new Date().toISOString(),
    scores,
    total_score: totalScore,
    level: level.label,
    recommendation: level.recommendation,
    blockers: Object.entries(scores).filter(([, v]) => v < 50).map(([k]) => k),
    risks: Object.entries(scores).filter(([, v]) => v >= 50 && v < 70).map(([k]) => k)
  };

  const stateFile = options.stateFile || path.join(root, DEFAULT_STATE_FILE);
  const state = loadState(stateFile);
  state.assessments.push(assessment);
  state.current_readiness = assessment;
  saveState(state, stateFile);

  return { success: true, ...assessment };
}

/**
 * Generate a go/no-go report.
 *
 * @param {object} [options]
 * @returns {object}
 */
function generateReport(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  if (!state.current_readiness) {
    return { success: false, error: 'No readiness assessment found. Run assess first.' };
  }

  const r = state.current_readiness;

  return {
    success: true,
    recommendation: r.recommendation,
    total_score: r.total_score,
    level: r.level,
    categories: Object.entries(r.scores).map(([name, score]) => ({
      name,
      score,
      status: score >= 70 ? 'pass' : score >= 50 ? 'warning' : 'fail'
    })),
    blockers: r.blockers,
    risks: r.risks,
    assessed_at: r.assessed_at
  };
}

module.exports = {
  defaultState,
  loadState,
  saveState,
  assessReadiness,
  generateReport,
  READINESS_CATEGORIES,
  READINESS_LEVELS
};
