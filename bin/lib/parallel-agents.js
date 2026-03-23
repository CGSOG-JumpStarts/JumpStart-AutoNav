/**
 * parallel-agents.js — Multi-Agent Concurrent Execution
 *
 * Orchestrates architect, security, QA, docs, and performance sidecars
 * running in parallel against the same spec set, then reconciles conflicts.
 *
 * Usage:
 *   node bin/lib/parallel-agents.js run|status|reconcile [options]
 *
 * State file: .jumpstart/state/parallel-agents.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'parallel-agents.json');

const SIDECAR_AGENTS = ['architect', 'security', 'qa', 'docs', 'performance'];

/**
 * Default parallel agents run state.
 * @returns {object}
 */
function defaultParallelState() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    runs: []
  };
}

/**
 * Load parallel agents state from disk.
 * @param {string} [stateFile]
 * @returns {object}
 */
function loadParallelState(stateFile) {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  if (!fs.existsSync(filePath)) {
    return defaultParallelState();
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return defaultParallelState();
  }
}

/**
 * Save parallel agents state to disk.
 * @param {object} state
 * @param {string} [stateFile]
 */
function saveParallelState(state, stateFile) {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  state.last_updated = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/**
 * Schedule a new parallel agent run.
 *
 * @param {string[]} agents - Subset of SIDECAR_AGENTS to run. Defaults to all.
 * @param {object} context - Shared context (phase, specFiles, root).
 * @param {object} [options]
 * @returns {object}
 */
function scheduleRun(agents, context, options = {}) {
  const agentList = (agents && agents.length > 0)
    ? agents.filter(a => SIDECAR_AGENTS.includes(a))
    : [...SIDECAR_AGENTS];

  if (agentList.length === 0) {
    return { success: false, error: `No valid agents specified. Valid: ${SIDECAR_AGENTS.join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadParallelState(stateFile);

  const runId = `run-${Date.now()}`;
  const run = {
    id: runId,
    scheduled_at: new Date().toISOString(),
    context: context || {},
    agents: agentList.map(name => ({
      name,
      status: 'pending',    // pending | running | completed | failed
      started_at: null,
      completed_at: null,
      findings: [],
      errors: []
    })),
    reconciliation: null,
    status: 'pending'
  };

  state.runs.push(run);
  saveParallelState(state, stateFile);

  return { success: true, run_id: runId, agents: agentList };
}

/**
 * Record findings from a sidecar agent.
 *
 * @param {string} runId
 * @param {string} agentName
 * @param {object[]} findings - Array of { type, message, severity, file? }.
 * @param {object} [options]
 * @returns {object}
 */
function recordAgentFindings(runId, agentName, findings, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadParallelState(stateFile);

  const run = state.runs.find(r => r.id === runId);
  if (!run) {
    return { success: false, error: `Run not found: ${runId}` };
  }

  const agent = run.agents.find(a => a.name === agentName);
  if (!agent) {
    return { success: false, error: `Agent not found: ${agentName}` };
  }

  agent.findings = findings || [];
  agent.status = 'completed';
  agent.completed_at = new Date().toISOString();

  // Update overall run status
  const allDone = run.agents.every(a => a.status === 'completed' || a.status === 'failed');
  if (allDone) {
    run.status = 'completed';
  }

  saveParallelState(state, stateFile);

  return { success: true, run_id: runId, agent: agentName, findings_count: findings.length };
}

/**
 * Reconcile findings from all agents in a run — merge and de-duplicate conflicts.
 *
 * @param {string} runId
 * @param {object} [options]
 * @returns {object} Reconciliation result with merged findings and conflicts.
 */
function reconcileRun(runId, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadParallelState(stateFile);

  const run = state.runs.find(r => r.id === runId);
  if (!run) {
    return { success: false, error: `Run not found: ${runId}` };
  }

  const allFindings = [];
  for (const agent of run.agents) {
    for (const finding of agent.findings || []) {
      allFindings.push({ ...finding, agent: agent.name });
    }
  }

  // Detect conflicts: same file+type from different agents with different severities
  const conflicts = [];
  const seen = {};
  for (const f of allFindings) {
    const key = `${f.file || ''}:${f.type || ''}`;
    if (seen[key] && seen[key].severity !== f.severity) {
      conflicts.push({
        key,
        agents: [seen[key].agent, f.agent],
        severities: [seen[key].severity, f.severity],
        message: `Conflict: ${f.type} severity disagrees between ${seen[key].agent} and ${f.agent}`
      });
    } else {
      seen[key] = f;
    }
  }

  const reconciliation = {
    reconciled_at: new Date().toISOString(),
    total_findings: allFindings.length,
    conflicts: conflicts.length,
    conflict_list: conflicts,
    merged_findings: allFindings
  };

  run.reconciliation = reconciliation;
  saveParallelState(state, stateFile);

  return { success: true, run_id: runId, reconciliation };
}

/**
 * Get the status of a run.
 *
 * @param {string} runId
 * @param {object} [options]
 * @returns {object}
 */
function getRunStatus(runId, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadParallelState(stateFile);

  const run = state.runs.find(r => r.id === runId);
  if (!run) {
    return { success: false, error: `Run not found: ${runId}` };
  }

  return {
    success: true,
    run_id: runId,
    status: run.status,
    agents: run.agents.map(a => ({ name: a.name, status: a.status, findings: a.findings.length })),
    reconciliation: run.reconciliation
  };
}

/**
 * List all runs.
 *
 * @param {object} [options]
 * @returns {object}
 */
function listRuns(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadParallelState(stateFile);

  const runs = state.runs.map(r => ({
    id: r.id,
    status: r.status,
    scheduled_at: r.scheduled_at,
    agent_count: r.agents.length
  }));

  return { success: true, runs, total: runs.length };
}

module.exports = {
  SIDECAR_AGENTS,
  loadParallelState,
  saveParallelState,
  defaultParallelState,
  scheduleRun,
  recordAgentFindings,
  reconcileRun,
  getRunStatus,
  listRuns
};
