/**
 * plan-executor.js — Rich Plan Execution Engine
 *
 * Turn implementation-plan tasks into executable, resumable,
 * verifiable agent jobs.
 *
 * State file: .jumpstart/state/plan-execution.json
 *
 * Usage:
 *   node bin/lib/plan-executor.js start|status|resume|verify|reset [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_EXECUTION_FILE = path.join('.jumpstart', 'state', 'plan-execution.json');

const TASK_STATUSES = ['pending', 'in_progress', 'completed', 'failed', 'skipped', 'blocked'];

/**
 * Default execution state.
 * @returns {object}
 */
function defaultExecutionState() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    plan_source: null,
    jobs: [],
    execution_log: []
  };
}

/**
 * Load execution state from disk.
 * @param {string} [stateFile]
 * @returns {object}
 */
function loadExecutionState(stateFile) {
  const filePath = stateFile || DEFAULT_EXECUTION_FILE;
  if (!fs.existsSync(filePath)) {
    return defaultExecutionState();
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return defaultExecutionState();
  }
}

/**
 * Save execution state to disk.
 * @param {object} state
 * @param {string} [stateFile]
 */
function saveExecutionState(state, stateFile) {
  const filePath = stateFile || DEFAULT_EXECUTION_FILE;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  state.last_updated = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/**
 * Parse implementation plan into executable jobs.
 *
 * @param {string} planContent - Implementation plan markdown content.
 * @returns {object[]}
 */
function parsePlanToJobs(planContent) {
  const jobs = [];
  const lines = planContent.split('\n');
  let currentMilestone = null;

  for (const line of lines) {
    // Detect milestones like "## Milestone 1: ...", "## M01: ..."
    const milestoneMatch = line.match(/^#{2,3}\s+(?:Milestone\s+)?(\d+|M\d+)[:\s—–-]+\s*(.+)$/i);
    if (milestoneMatch) {
      currentMilestone = milestoneMatch[1].startsWith('M') ? milestoneMatch[1] : `M${milestoneMatch[1].padStart(2, '0')}`;
      continue;
    }

    // Detect tasks like "- M01-T01: ...", "### M01-T01 — ..."
    const taskMatch = line.match(/(?:^#{2,4}\s+|^[-*]\s+\*{0,2})(M\d+-T\d+)(?:\*{0,2})[:\s—–-]+\s*(.+)/i);
    if (taskMatch) {
      const taskId = taskMatch[1];
      const title = taskMatch[2].trim().replace(/\*{1,2}/g, '');

      // Extract story refs
      const storyRefs = line.match(/E\d+-S\d+/g) || [];

      // Extract dependency refs (depends on: M01-T02)
      const depMatch = line.match(/depends?\s+on[:\s]+([^.]+)/i);
      const dependencies = depMatch
        ? (depMatch[1].match(/M\d+-T\d+/g) || [])
        : [];

      jobs.push({
        id: taskId,
        title,
        milestone: currentMilestone || taskId.split('-')[0],
        status: 'pending',
        story_refs: [...new Set(storyRefs)],
        dependencies,
        started_at: null,
        completed_at: null,
        verification: null,
        output_files: [],
        error: null
      });
    }
  }

  return jobs;
}

/**
 * Initialize execution from implementation plan.
 *
 * @param {string} root - Project root.
 * @param {object} [options]
 * @returns {object}
 */
function initializeExecution(root, options = {}) {
  const planPath = options.planPath || path.join(root, 'specs', 'implementation-plan.md');
  const stateFile = options.stateFile || path.join(root, DEFAULT_EXECUTION_FILE);

  if (!fs.existsSync(planPath)) {
    return { success: false, error: `Implementation plan not found: ${planPath}` };
  }

  const planContent = fs.readFileSync(planPath, 'utf8');
  const jobs = parsePlanToJobs(planContent);

  if (jobs.length === 0) {
    return { success: false, error: 'No tasks found in implementation plan' };
  }

  const state = defaultExecutionState();
  state.plan_source = path.relative(root, planPath);
  state.jobs = jobs;
  state.execution_log.push({
    event: 'initialized',
    timestamp: new Date().toISOString(),
    total_jobs: jobs.length
  });

  saveExecutionState(state, stateFile);

  return {
    success: true,
    total_jobs: jobs.length,
    milestones: [...new Set(jobs.map(j => j.milestone))],
    jobs: jobs.map(j => ({ id: j.id, title: j.title, milestone: j.milestone, dependencies: j.dependencies }))
  };
}

/**
 * Get execution status.
 *
 * @param {object} [options]
 * @returns {object}
 */
function getExecutionStatus(options = {}) {
  const stateFile = options.stateFile || DEFAULT_EXECUTION_FILE;
  const state = loadExecutionState(stateFile);

  if (state.jobs.length === 0) {
    return { success: true, initialized: false, message: 'No execution plan loaded' };
  }

  const statusCounts = {};
  for (const status of TASK_STATUSES) {
    statusCounts[status] = state.jobs.filter(j => j.status === status).length;
  }

  const completedPct = state.jobs.length > 0
    ? Math.round((statusCounts.completed / state.jobs.length) * 100)
    : 0;

  // Find next actionable tasks (pending with all dependencies completed)
  const completedIds = new Set(state.jobs.filter(j => j.status === 'completed').map(j => j.id));
  const nextTasks = state.jobs.filter(j =>
    j.status === 'pending' &&
    j.dependencies.every(dep => completedIds.has(dep))
  );

  return {
    success: true,
    initialized: true,
    plan_source: state.plan_source,
    total_jobs: state.jobs.length,
    progress: completedPct,
    status_counts: statusCounts,
    next_tasks: nextTasks.map(j => ({ id: j.id, title: j.title, milestone: j.milestone })),
    jobs: state.jobs.map(j => ({
      id: j.id,
      title: j.title,
      status: j.status,
      milestone: j.milestone
    }))
  };
}

/**
 * Update a job's status.
 *
 * @param {string} jobId - Task ID (e.g., M01-T01).
 * @param {string} status - New status.
 * @param {object} [options]
 * @returns {object}
 */
function updateJobStatus(jobId, status, options = {}) {
  if (!TASK_STATUSES.includes(status)) {
    return { success: false, error: `Invalid status: ${status}. Must be one of: ${TASK_STATUSES.join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_EXECUTION_FILE;
  const state = loadExecutionState(stateFile);
  const job = state.jobs.find(j => j.id === jobId);

  if (!job) {
    return { success: false, error: `Job not found: ${jobId}` };
  }

  const previousStatus = job.status;
  job.status = status;

  if (status === 'in_progress' && !job.started_at) {
    job.started_at = new Date().toISOString();
  }
  if (status === 'completed') {
    job.completed_at = new Date().toISOString();
  }
  if (status === 'failed' && options.error) {
    job.error = options.error;
  }
  if (options.output_files) {
    job.output_files = options.output_files;
  }

  state.execution_log.push({
    event: 'status_change',
    job_id: jobId,
    from: previousStatus,
    to: status,
    timestamp: new Date().toISOString()
  });

  saveExecutionState(state, stateFile);

  return {
    success: true,
    job_id: jobId,
    previous_status: previousStatus,
    new_status: status,
    started_at: job.started_at,
    completed_at: job.completed_at
  };
}

/**
 * Verify a completed job.
 *
 * @param {string} jobId - Task ID.
 * @param {string} root - Project root.
 * @param {object} [options]
 * @returns {object}
 */
function verifyJob(jobId, root, options = {}) {
  const stateFile = options.stateFile || path.join(root, DEFAULT_EXECUTION_FILE);
  const state = loadExecutionState(stateFile);
  const job = state.jobs.find(j => j.id === jobId);

  if (!job) {
    return { success: false, error: `Job not found: ${jobId}` };
  }

  const checks = [];

  // Check if job has output files
  if (job.output_files && job.output_files.length > 0) {
    for (const file of job.output_files) {
      const exists = fs.existsSync(path.join(root, file));
      checks.push({ check: `file_exists: ${file}`, passed: exists });
    }
  }

  // Check status
  checks.push({ check: 'status_completed', passed: job.status === 'completed' });
  checks.push({ check: 'has_completion_time', passed: !!job.completed_at });
  checks.push({ check: 'no_errors', passed: !job.error });

  const allPassed = checks.every(c => c.passed);

  job.verification = {
    verified_at: new Date().toISOString(),
    passed: allPassed,
    checks
  };

  saveExecutionState(state, stateFile);

  return {
    success: true,
    job_id: jobId,
    verified: allPassed,
    checks,
    summary: {
      total_checks: checks.length,
      passed: checks.filter(c => c.passed).length,
      failed: checks.filter(c => !c.passed).length
    }
  };
}

/**
 * Reset execution state.
 *
 * @param {object} [options]
 * @returns {object}
 */
function resetExecution(options = {}) {
  const stateFile = options.stateFile || DEFAULT_EXECUTION_FILE;
  const state = loadExecutionState(stateFile);
  const previousCount = state.jobs.length;

  for (const job of state.jobs) {
    job.status = 'pending';
    job.started_at = null;
    job.completed_at = null;
    job.verification = null;
    job.error = null;
  }

  state.execution_log.push({
    event: 'reset',
    timestamp: new Date().toISOString(),
    jobs_reset: previousCount
  });

  saveExecutionState(state, stateFile);

  return {
    success: true,
    jobs_reset: previousCount
  };
}

module.exports = {
  defaultExecutionState,
  loadExecutionState,
  saveExecutionState,
  parsePlanToJobs,
  initializeExecution,
  getExecutionStatus,
  updateJobStatus,
  verifyJob,
  resetExecution,
  TASK_STATUSES
};
