/**
 * role-approval.ts — human approval workflows with roles port (T4.4.2, cluster I).
 *
 * Pure-library port of `bin/lib/role-approval.js`. Public surface
 * preserved verbatim:
 *
 *   - `loadRoleApprovalStore(stateFile?)` => RoleApprovalStore
 *   - `saveRoleApprovalStore(store, stateFile?)` => void
 *   - `defaultRoleApprovalStore()` => RoleApprovalStore
 *   - `assignApprovers(artifactPath, approvers, options?)` => AssignResult
 *   - `recordRoleAction(artifactPath, role, action, options?)` => RecordResult
 *   - `getApprovalStatus(artifactPath, options?)` => StatusResult
 *   - `listApprovalWorkflows(filter?, options?)` => ListResult
 *   - `APPROVER_ROLES`
 *
 * Behavior parity:
 *   - Default state path: `.jumpstart/state/role-approvals.json`.
 *   - 7 approver roles preserved verbatim.
 *   - Multi-role approval chain logic preserved.
 *   - M3 hardening: shape-validated JSON; rejects __proto__.
 *
 * @see bin/lib/role-approval.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.2
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DEFAULT_STATE_FILE = join('.jumpstart', 'state', 'role-approvals.json');

export const APPROVER_ROLES = [
  'product',
  'architect',
  'security',
  'legal',
  'platform',
  'qa',
  'custom',
] as const;

export interface ApproverEntry {
  role: string;
  name: string | null;
  required: boolean;
  status: string;
  approved_at: string | null;
  comment: string | null;
}

export interface ApprovalWorkflow {
  artifact: string;
  created_at: string;
  last_updated: string;
  status: string;
  approvers: ApproverEntry[];
}

export interface RoleApprovalStore {
  version: string;
  created_at: string;
  last_updated: string | null;
  workflows: Record<string, ApprovalWorkflow>;
}

export interface ApproverInput {
  role: string;
  name?: string;
  required?: boolean;
}

export interface ApprovalFilter {
  status?: string;
}

export interface StateOptions {
  stateFile?: string;
  approverName?: string;
  comment?: string;
}

export interface AssignResult {
  success: boolean;
  artifact?: string;
  approvers?: ApproverEntry[];
  total_required?: number;
  error?: string;
}

export interface RecordResult {
  success: boolean;
  artifact?: string;
  role?: string;
  action?: string;
  workflow_status?: string;
  pending_roles?: string[];
  error?: string;
}

export interface StatusResult {
  success: true;
  artifact: string;
  has_workflow: boolean;
  message?: string;
  status?: string;
  pending_roles?: string[];
  approved_roles?: string[];
  rejected_roles?: string[];
  approvers?: ApproverEntry[];
  fully_approved?: boolean;
}

export interface ListResult {
  success: true;
  workflows: ApprovalWorkflow[];
  total: number;
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function safeParseStore(raw: string): RoleApprovalStore | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  for (const key of Object.keys(parsed)) {
    if (FORBIDDEN_KEYS.has(key)) return null;
  }
  const data = parsed as Partial<RoleApprovalStore>;
  let workflows: Record<string, ApprovalWorkflow> = {};
  if (isPlainObject(data.workflows)) {
    for (const [k, v] of Object.entries(data.workflows)) {
      if (FORBIDDEN_KEYS.has(k)) continue;
      workflows[k] = v as ApprovalWorkflow;
    }
  } else {
    workflows = {};
  }
  return {
    version: typeof data.version === 'string' ? data.version : '1.0.0',
    created_at: typeof data.created_at === 'string' ? data.created_at : new Date().toISOString(),
    last_updated: typeof data.last_updated === 'string' ? data.last_updated : null,
    workflows,
  };
}

export function defaultRoleApprovalStore(): RoleApprovalStore {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    workflows: {},
  };
}

export function loadRoleApprovalStore(stateFile?: string): RoleApprovalStore {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  if (!existsSync(filePath)) return defaultRoleApprovalStore();
  const parsed = safeParseStore(readFileSync(filePath, 'utf8'));
  return parsed ?? defaultRoleApprovalStore();
}

export function saveRoleApprovalStore(store: RoleApprovalStore, stateFile?: string): void {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  store.last_updated = new Date().toISOString();
  writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

export function assignApprovers(
  artifactPath: string,
  approvers: ApproverInput[],
  options: StateOptions = {}
): AssignResult {
  if (!artifactPath) {
    return { success: false, error: 'artifactPath is required' };
  }
  if (!Array.isArray(approvers) || approvers.length === 0) {
    return {
      success: false,
      error: 'approvers array is required and must not be empty',
    };
  }

  for (const a of approvers) {
    const role = (a.role || '').toLowerCase();
    if (!(APPROVER_ROLES as readonly string[]).includes(role)) {
      return {
        success: false,
        error: `Invalid role "${a.role}". Must be one of: ${APPROVER_ROLES.join(', ')}`,
      };
    }
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const store = loadRoleApprovalStore(stateFile);

  const workflow: ApprovalWorkflow = {
    artifact: artifactPath,
    created_at: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    status: 'pending',
    approvers: approvers.map((a) => ({
      role: a.role.toLowerCase(),
      name: a.name || null,
      required: a.required !== false,
      status: 'pending',
      approved_at: null,
      comment: null,
    })),
  };

  store.workflows[artifactPath] = workflow;
  saveRoleApprovalStore(store, stateFile);

  return {
    success: true,
    artifact: artifactPath,
    approvers: workflow.approvers,
    total_required: workflow.approvers.filter((a) => a.required).length,
  };
}

export function recordRoleAction(
  artifactPath: string,
  role: string,
  action: string,
  options: StateOptions = {}
): RecordResult {
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
  const approver = workflow.approvers.find((a) => a.role === normalizedRole);
  if (!approver) {
    return { success: false, error: `Role "${role}" not assigned to this artifact` };
  }

  approver.status = action === 'approve' ? 'approved' : 'rejected';
  approver.approved_at = new Date().toISOString();
  if (options.approverName) approver.name = options.approverName;
  if (options.comment) approver.comment = options.comment;
  workflow.last_updated = new Date().toISOString();

  const required = workflow.approvers.filter((a) => a.required);
  const allApproved = required.every((a) => a.status === 'approved');
  const anyRejected = required.some((a) => a.status === 'rejected');

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
    pending_roles: workflow.approvers
      .filter((a) => a.required && a.status === 'pending')
      .map((a) => a.role),
  };
}

export function getApprovalStatus(artifactPath: string, options: StateOptions = {}): StatusResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const store = loadRoleApprovalStore(stateFile);

  const workflow = store.workflows[artifactPath];
  if (!workflow) {
    return {
      success: true,
      artifact: artifactPath,
      has_workflow: false,
      message: 'No approval workflow assigned',
    };
  }

  const pending = workflow.approvers
    .filter((a) => a.required && a.status === 'pending')
    .map((a) => a.role);
  const approved = workflow.approvers.filter((a) => a.status === 'approved').map((a) => a.role);
  const rejected = workflow.approvers.filter((a) => a.status === 'rejected').map((a) => a.role);

  return {
    success: true,
    artifact: artifactPath,
    has_workflow: true,
    status: workflow.status,
    pending_roles: pending,
    approved_roles: approved,
    rejected_roles: rejected,
    approvers: workflow.approvers,
    fully_approved: workflow.status === 'approved',
  };
}

export function listApprovalWorkflows(
  filter: ApprovalFilter = {},
  options: StateOptions = {}
): ListResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const store = loadRoleApprovalStore(stateFile);

  let workflows = Object.values(store.workflows);

  if (filter.status) {
    workflows = workflows.filter((w) => w.status === filter.status);
  }

  return { success: true, workflows, total: workflows.length };
}
