/**
 * role-approval.js — Human Approval Workflows with Roles
 *
 * Supports named approvers by role: product, architect, security, legal,
 * platform owner. Tracks multi-role approval chains for artifacts.
 *
 * Usage:
 *   node bin/lib/role-approval.js assign|approve|status [options]
 *
 * State file: .jumpstart/state/role-approvals.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'role-approvals.json');

const APPROVER_ROLES = ['product', 'architect', 'security', 'legal', 'platform', 'qa', 'custom'];

/**
 * Default role approval store.
 * @returns {object}
 */
function defaultRoleApprovalStore() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    workflows: {}  // artifact_path → workflow
  };
}

/**
 * Load the role approval store from disk.
 * @param {string} [stateFile]
 * @returns {object}
 */
function loadRoleApprovalStore(stateFile) {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  if (!fs.existsSync(filePath)) {
    return defaultRoleApprovalStore();
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return defaultRoleApprovalStore();
  }
}

/**
 * Save the role approval store to disk.
 * @param {object} store
 * @param {string} [stateFile]
 */
function saveRoleApprovalStore(store, stateFile) {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  store.last_updated = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2) + '\n', 'utf8');
}

/**
 * Assign approvers to an artifact.
 *
 * @param {string} artifactPath - Relative path to the artifact.
 * @param {object[]} approvers - Array of { role, name, required? }.
 * @param {object} [options]
 * @returns {object}
 */
function assignApprovers(artifactPath, approvers, options = {}) {
  if (!artifactPath) {
    return { success: false, error: 'artifactPath is required' };
  }
  if (!Array.isArray(approvers) || approvers.length === 0) {
    return { success: false, error: 'approvers array is required and must not be empty' };
  }

  for (const a of approvers) {
    const role = (a.role || '').toLowerCase();
    if (!APPROVER_ROLES.includes(role)) {
      return { success: false, error: `Invalid role "${a.role}". Must be one of: ${APPROVER_ROLES.join(', ')}` };
    }
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const store = loadRoleApprovalStore(stateFile);

  const workflow = {
    artifact: artifactPath,
    created_at: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    status: 'pending',
    approvers: approvers.map(a => ({
      role: a.role.toLowerCase(),
      name: a.name || null,
      required: a.required !== false,
      status: 'pending',  // pending | approved | rejected | skipped
      approved_at: null,
      comment: null
    }))
  };

  store.workflows[artifactPath] = workflow;
  saveRoleApprovalStore(store, stateFile);

  return {
    success: true,
    artifact: artifactPath,
    approvers: workflow.approvers,
    total_required: workflow.approvers.filter(a => a.required).length
  };
}

/**
 * Record an approval (or rejection) by a specific role.
 *
 * @param {string} artifactPath
 * @param {string} role
 * @param {string} action - 'approve' | 'reject'
 * @param {object} [options] - { approverName?, comment?, stateFile? }
 * @returns {object}
 */
function recordRoleAction(artifactPath, role, action, options = {}) {
  if (!artifactPath || !role || !action) {
    return { success: false, error: 'artifactPath, role, and action are required' };
  }

  if (!['approve', 'reject'].includes(action)) {
    return { success: false, error: 'action must be "approve" or "reject"' };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const store = loadRoleApprovalStore(stateFile);

  const workflow = store.workflows[artifactPath];
  if (!workflow) {
    return { success: false, error: `No approval workflow found for: ${artifactPath}` };
  }

  const normalizedRole = role.toLowerCase();
  const approver = workflow.approvers.find(a => a.role === normalizedRole);
  if (!approver) {
    return { success: false, error: `Role "${role}" not assigned to this artifact` };
  }

  approver.status = action === 'approve' ? 'approved' : 'rejected';
  approver.approved_at = new Date().toISOString();
  if (options.approverName) approver.name = options.approverName;
  if (options.comment) approver.comment = options.comment;
  workflow.last_updated = new Date().toISOString();

  // Update overall workflow status
  const required = workflow.approvers.filter(a => a.required);
  const allApproved = required.every(a => a.status === 'approved');
  const anyRejected = required.some(a => a.status === 'rejected');

  if (anyRejected) {
    workflow.status = 'rejected';
  } else if (allApproved) {
    workflow.status = 'approved';
  } else {
    workflow.status = 'pending';
  }

  saveRoleApprovalStore(store, stateFile);

  return {
    success: true,
    artifact: artifactPath,
    role: normalizedRole,
    action,
    workflow_status: workflow.status,
    pending_roles: workflow.approvers.filter(a => a.required && a.status === 'pending').map(a => a.role)
  };
}

/**
 * Get the approval status of an artifact.
 *
 * @param {string} artifactPath
 * @param {object} [options]
 * @returns {object}
 */
function getApprovalStatus(artifactPath, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const store = loadRoleApprovalStore(stateFile);

  const workflow = store.workflows[artifactPath];
  if (!workflow) {
    return {
      success: true,
      artifact: artifactPath,
      has_workflow: false,
      message: 'No approval workflow assigned'
    };
  }

  const pending = workflow.approvers.filter(a => a.required && a.status === 'pending').map(a => a.role);
  const approved = workflow.approvers.filter(a => a.status === 'approved').map(a => a.role);
  const rejected = workflow.approvers.filter(a => a.status === 'rejected').map(a => a.role);

  return {
    success: true,
    artifact: artifactPath,
    has_workflow: true,
    status: workflow.status,
    pending_roles: pending,
    approved_roles: approved,
    rejected_roles: rejected,
    approvers: workflow.approvers,
    fully_approved: workflow.status === 'approved'
  };
}

/**
 * List all approval workflows.
 *
 * @param {object} [filter] - { status? }
 * @param {object} [options]
 * @returns {object}
 */
function listApprovalWorkflows(filter = {}, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const store = loadRoleApprovalStore(stateFile);

  let workflows = Object.values(store.workflows);

  if (filter.status) {
    workflows = workflows.filter(w => w.status === filter.status);
  }

  return { success: true, workflows, total: workflows.length };
}

module.exports = {
  APPROVER_ROLES,
  loadRoleApprovalStore,
  saveRoleApprovalStore,
  defaultRoleApprovalStore,
  assignApprovers,
  recordRoleAction,
  getApprovalStatus,
  listApprovalWorkflows
};
