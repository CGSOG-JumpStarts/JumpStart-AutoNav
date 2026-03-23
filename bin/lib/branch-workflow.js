/**
 * branch-workflow.js — Branch-Aware Workflow Engine
 *
 * Specs, approvals, and implementation plans track by git branch and PR,
 * not just by repo folder state. Each branch gets its own workflow snapshot.
 *
 * Usage:
 *   node bin/lib/branch-workflow.js track|status|sync [options]
 *
 * State file: .jumpstart/state/branch-workflows.json
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DEFAULT_BRANCH_STATE_FILE = path.join('.jumpstart', 'state', 'branch-workflows.json');

/**
 * Safely get the current git branch name.
 * @param {string} [cwd]
 * @returns {string} Branch name or 'unknown'.
 */
function getCurrentBranch(cwd) {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: cwd || process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore']
    }).toString().trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Safely get the current git commit SHA.
 * @param {string} [cwd]
 * @returns {string} Commit SHA or 'unknown'.
 */
function getCurrentCommit(cwd) {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: cwd || process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore']
    }).toString().trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Default branch workflow store.
 * @returns {object}
 */
function defaultBranchStore() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    branches: {}
  };
}

/**
 * Load the branch workflow store from disk.
 * @param {string} [stateFile]
 * @returns {object}
 */
function loadBranchStore(stateFile) {
  const filePath = stateFile || DEFAULT_BRANCH_STATE_FILE;
  if (!fs.existsSync(filePath)) {
    return defaultBranchStore();
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return defaultBranchStore();
  }
}

/**
 * Save the branch workflow store to disk.
 * @param {object} store
 * @param {string} [stateFile]
 */
function saveBranchStore(store, stateFile) {
  const filePath = stateFile || DEFAULT_BRANCH_STATE_FILE;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  store.last_updated = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2) + '\n', 'utf8');
}

/**
 * Start tracking a branch. Creates or updates the branch workflow entry.
 *
 * @param {string} root - Project root.
 * @param {object} [options] - { branch?, pr_number?, pr_url?, stateFile? }
 * @returns {object}
 */
function trackBranch(root, options = {}) {
  const branch = options.branch || getCurrentBranch(root);
  const commit = getCurrentCommit(root);
  const stateFile = options.stateFile || path.join(root, DEFAULT_BRANCH_STATE_FILE);
  const store = loadBranchStore(stateFile);

  const existing = store.branches[branch] || {
    branch,
    created_at: new Date().toISOString(),
    phase_snapshots: [],
    approved_artifacts: [],
    pr_number: null,
    pr_url: null
  };

  existing.branch = branch;
  existing.last_commit = commit;
  existing.last_seen = new Date().toISOString();

  if (options.pr_number !== undefined) existing.pr_number = options.pr_number;
  if (options.pr_url !== undefined) existing.pr_url = options.pr_url;

  store.branches[branch] = existing;
  saveBranchStore(store, stateFile);

  return { success: true, branch: existing };
}

/**
 * Record a phase snapshot for a specific branch.
 *
 * @param {string} root - Project root.
 * @param {number} phase - Phase number.
 * @param {object} snapshot - Additional snapshot data.
 * @param {object} [options]
 * @returns {object}
 */
function recordPhaseSnapshot(root, phase, snapshot = {}, options = {}) {
  const branch = options.branch || getCurrentBranch(root);
  const stateFile = options.stateFile || path.join(root, DEFAULT_BRANCH_STATE_FILE);
  const store = loadBranchStore(stateFile);

  if (!store.branches[branch]) {
    store.branches[branch] = {
      branch,
      created_at: new Date().toISOString(),
      phase_snapshots: [],
      approved_artifacts: [],
      pr_number: null,
      pr_url: null
    };
  }

  const entry = {
    phase,
    recorded_at: new Date().toISOString(),
    commit: getCurrentCommit(root),
    ...snapshot
  };

  store.branches[branch].phase_snapshots.push(entry);
  saveBranchStore(store, stateFile);

  return { success: true, branch, snapshot: entry };
}

/**
 * Record an artifact approval for a specific branch.
 *
 * @param {string} root
 * @param {string} artifactPath
 * @param {string} approver
 * @param {object} [options]
 * @returns {object}
 */
function recordBranchApproval(root, artifactPath, approver, options = {}) {
  const branch = options.branch || getCurrentBranch(root);
  const stateFile = options.stateFile || path.join(root, DEFAULT_BRANCH_STATE_FILE);
  const store = loadBranchStore(stateFile);

  if (!store.branches[branch]) {
    store.branches[branch] = {
      branch,
      created_at: new Date().toISOString(),
      phase_snapshots: [],
      approved_artifacts: [],
      pr_number: null,
      pr_url: null
    };
  }

  const entry = {
    artifact: artifactPath,
    approver,
    approved_at: new Date().toISOString(),
    commit: getCurrentCommit(root)
  };

  store.branches[branch].approved_artifacts.push(entry);
  saveBranchStore(store, stateFile);

  return { success: true, branch, approval: entry };
}

/**
 * Get the workflow status of a branch.
 *
 * @param {string} root
 * @param {object} [options]
 * @returns {object}
 */
function getBranchStatus(root, options = {}) {
  const branch = options.branch || getCurrentBranch(root);
  const stateFile = options.stateFile || path.join(root, DEFAULT_BRANCH_STATE_FILE);
  const store = loadBranchStore(stateFile);

  const branchData = store.branches[branch];
  if (!branchData) {
    return {
      success: true,
      branch,
      tracked: false,
      message: `Branch "${branch}" is not yet tracked. Run: jumpstart-mode branch-workflow track`
    };
  }

  return {
    success: true,
    branch,
    tracked: true,
    data: branchData,
    phase_count: (branchData.phase_snapshots || []).length,
    approved_count: (branchData.approved_artifacts || []).length
  };
}

/**
 * List all tracked branches.
 *
 * @param {object} [options]
 * @returns {object}
 */
function listTrackedBranches(options = {}) {
  const stateFile = options.stateFile || DEFAULT_BRANCH_STATE_FILE;
  const store = loadBranchStore(stateFile);

  const branches = Object.values(store.branches);
  return { success: true, branches, total: branches.length };
}

module.exports = {
  getCurrentBranch,
  getCurrentCommit,
  loadBranchStore,
  saveBranchStore,
  defaultBranchStore,
  trackBranch,
  recordPhaseSnapshot,
  recordBranchApproval,
  getBranchStatus,
  listTrackedBranches
};
