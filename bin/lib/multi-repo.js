/**
 * multi-repo.js — Multi-Repo Program Orchestration
 *
 * Lets one initiative span frontend, backend, infra, data, and docs
 * repos with shared specs, dependencies, and release plans.
 *
 * Usage:
 *   node bin/lib/multi-repo.js init|status|link|plan [options]
 *
 * State file: .jumpstart/state/multi-repo.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'multi-repo.json');

/**
 * Load the multi-repo state from disk.
 * @param {string} [stateFile]
 * @returns {object}
 */
function loadMultiRepoState(stateFile) {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  if (!fs.existsSync(filePath)) {
    return defaultMultiRepoState();
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return defaultMultiRepoState();
  }
}

/**
 * Default multi-repo state structure.
 * @returns {object}
 */
function defaultMultiRepoState() {
  return {
    version: '1.0.0',
    program_name: null,
    created_at: new Date().toISOString(),
    last_updated: null,
    repos: [],
    shared_specs: [],
    dependencies: [],
    release_plan: {
      milestones: [],
      current_milestone: null
    }
  };
}

/**
 * Save the multi-repo state to disk.
 * @param {object} state
 * @param {string} [stateFile]
 */
function saveMultiRepoState(state, stateFile) {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  state.last_updated = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/**
 * Initialize a multi-repo program.
 * @param {string} programName
 * @param {object} [options]
 * @returns {object}
 */
function initProgram(programName, options = {}) {
  if (!programName || typeof programName !== 'string' || !programName.trim()) {
    return { success: false, error: 'Program name is required' };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = defaultMultiRepoState();
  state.program_name = programName.trim();

  saveMultiRepoState(state, stateFile);

  return {
    success: true,
    program_name: state.program_name,
    state_file: stateFile,
    message: `Program "${state.program_name}" initialized`
  };
}

/**
 * Link a repo to the current program.
 * @param {string} repoUrl - Git URL or local path of the repo.
 * @param {string} role - Role of this repo: frontend|backend|infra|data|docs|other.
 * @param {object} [options]
 * @returns {object}
 */
function linkRepo(repoUrl, role, options = {}) {
  if (!repoUrl) return { success: false, error: 'repoUrl is required' };

  const validRoles = ['frontend', 'backend', 'infra', 'data', 'docs', 'other'];
  const normalizedRole = (role || 'other').toLowerCase();
  if (!validRoles.includes(normalizedRole)) {
    return { success: false, error: `role must be one of: ${validRoles.join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadMultiRepoState(stateFile);

  const existing = state.repos.find(r => r.url === repoUrl);
  if (existing) {
    return { success: false, error: `Repo already linked: ${repoUrl}` };
  }

  const entry = {
    id: `repo-${Date.now()}`,
    url: repoUrl,
    role: normalizedRole,
    linked_at: new Date().toISOString(),
    specs: [],
    status: 'active'
  };

  state.repos.push(entry);
  saveMultiRepoState(state, stateFile);

  return {
    success: true,
    repo: entry,
    total_repos: state.repos.length
  };
}

/**
 * Add a shared spec reference across repos.
 * @param {string} specPath - Relative path to shared spec file.
 * @param {string[]} repoIds - IDs of repos this spec applies to.
 * @param {object} [options]
 * @returns {object}
 */
function addSharedSpec(specPath, repoIds, options = {}) {
  if (!specPath) return { success: false, error: 'specPath is required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadMultiRepoState(stateFile);

  const entry = {
    id: `spec-${Date.now()}`,
    path: specPath,
    repos: Array.isArray(repoIds) ? repoIds : [],
    added_at: new Date().toISOString()
  };

  state.shared_specs.push(entry);
  saveMultiRepoState(state, stateFile);

  return {
    success: true,
    spec: entry,
    total_shared_specs: state.shared_specs.length
  };
}

/**
 * Record a cross-repo dependency.
 * @param {string} fromRepoId - Source repo ID.
 * @param {string} toRepoId - Target repo ID.
 * @param {string} dependencyType - Type: api|data|event|deploy|other.
 * @param {object} [options]
 * @returns {object}
 */
function addDependency(fromRepoId, toRepoId, dependencyType, options = {}) {
  if (!fromRepoId || !toRepoId) {
    return { success: false, error: 'fromRepoId and toRepoId are required' };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadMultiRepoState(stateFile);

  const dep = {
    id: `dep-${Date.now()}`,
    from: fromRepoId,
    to: toRepoId,
    type: dependencyType || 'other',
    created_at: new Date().toISOString()
  };

  state.dependencies.push(dep);
  saveMultiRepoState(state, stateFile);

  return { success: true, dependency: dep };
}

/**
 * Get the current status of the multi-repo program.
 * @param {object} [options]
 * @returns {object}
 */
function getProgramStatus(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadMultiRepoState(stateFile);

  const roleBreakdown = {};
  for (const repo of state.repos) {
    roleBreakdown[repo.role] = (roleBreakdown[repo.role] || 0) + 1;
  }

  return {
    program_name: state.program_name,
    initialized: !!state.program_name,
    repo_count: state.repos.length,
    shared_spec_count: state.shared_specs.length,
    dependency_count: state.dependencies.length,
    role_breakdown: roleBreakdown,
    repos: state.repos,
    release_plan: state.release_plan,
    last_updated: state.last_updated
  };
}

/**
 * Generate a release plan across all linked repos.
 * @param {object[]} milestones - Array of { name, target_date, repos[] }.
 * @param {object} [options]
 * @returns {object}
 */
function setReleasePlan(milestones, options = {}) {
  if (!Array.isArray(milestones)) {
    return { success: false, error: 'milestones must be an array' };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadMultiRepoState(stateFile);

  state.release_plan.milestones = milestones.map((m, i) => ({
    id: `milestone-${i + 1}`,
    name: m.name || `Milestone ${i + 1}`,
    target_date: m.target_date || null,
    repos: m.repos || [],
    status: m.status || 'planned'
  }));

  if (state.release_plan.milestones.length > 0) {
    state.release_plan.current_milestone = state.release_plan.milestones[0].id;
  }

  saveMultiRepoState(state, stateFile);

  return {
    success: true,
    milestone_count: state.release_plan.milestones.length,
    release_plan: state.release_plan
  };
}

module.exports = {
  loadMultiRepoState,
  saveMultiRepoState,
  defaultMultiRepoState,
  initProgram,
  linkRepo,
  addSharedSpec,
  addDependency,
  getProgramStatus,
  setReleasePlan
};
