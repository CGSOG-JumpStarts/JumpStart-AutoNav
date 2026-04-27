/**
 * branch-workflow.ts — Branch-Aware Workflow Engine port (T4.4.3, cluster L).
 *
 * Pure-library port of `bin/lib/branch-workflow.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `getCurrentBranch(cwd?)` => string
 *   - `getCurrentCommit(cwd?)` => string
 *   - `defaultBranchStore()` => BranchStore
 *   - `loadBranchStore(stateFile?)` => BranchStore
 *   - `saveBranchStore(store, stateFile?)` => void
 *   - `trackBranch(root, options?)` => TrackResult
 *   - `recordPhaseSnapshot(root, phase, snapshot?, options?)` => SnapshotResult
 *   - `recordBranchApproval(root, artifactPath, approver, options?)` => ApprovalResult
 *   - `getBranchStatus(root, options?)` => StatusResult
 *   - `listTrackedBranches(options?)` => ListResult
 *
 * Behavior parity:
 *   - Default state path: `.jumpstart/state/branch-workflows.json`.
 *   - Shells out to git via `execFileSync` (no shell, hardcoded args).
 *     Failures fall back to the literal string `'unknown'`.
 *   - JSON parse failures load defaults silently.
 *   - JSON shape validation rejects `__proto__` / `constructor` / `prototype`.
 *
 * @see bin/lib/branch-workflow.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.3
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface PhaseSnapshot {
  phase: number;
  recorded_at: string;
  commit: string;
  [key: string]: unknown;
}

export interface BranchApproval {
  artifact: string;
  approver: string;
  approved_at: string;
  commit: string;
}

export interface BranchEntry {
  branch: string;
  created_at: string;
  last_commit?: string;
  last_seen?: string;
  phase_snapshots: PhaseSnapshot[];
  approved_artifacts: BranchApproval[];
  pr_number: number | null;
  pr_url: string | null;
}

export interface BranchStore {
  version: string;
  created_at: string;
  last_updated: string | null;
  branches: Record<string, BranchEntry>;
}

export interface TrackBranchOptions {
  branch?: string;
  pr_number?: number;
  pr_url?: string;
  stateFile?: string;
}

export interface TrackResult {
  success: boolean;
  branch: BranchEntry;
}

export interface SnapshotResult {
  success: boolean;
  branch: string;
  snapshot: PhaseSnapshot;
}

export interface ApprovalResult {
  success: boolean;
  branch: string;
  approval: BranchApproval;
}

export interface StatusResult {
  success: boolean;
  branch: string;
  tracked: boolean;
  message?: string;
  data?: BranchEntry;
  phase_count?: number;
  approved_count?: number;
}

export interface ListResult {
  success: boolean;
  branches: BranchEntry[];
  total: number;
}

export interface StateOptions {
  branch?: string;
  stateFile?: string;
}

const DEFAULT_BRANCH_STATE_FILE = join('.jumpstart', 'state', 'branch-workflows.json');

/**
 * Safely get the current git branch name. Uses execFileSync (no shell)
 * with a hardcoded argument list — no injection surface.
 */
export function getCurrentBranch(cwd?: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: cwd || process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Safely get the current git commit SHA. Uses execFileSync (no shell)
 * with a hardcoded argument list — no injection surface.
 */
export function getCurrentCommit(cwd?: string): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: cwd || process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

export function defaultBranchStore(): BranchStore {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    branches: {},
  };
}

function _safeParseStore(content: string): BranchStore | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') return null;
  }
  const base = defaultBranchStore();
  const branches =
    obj.branches && typeof obj.branches === 'object' && !Array.isArray(obj.branches)
      ? (obj.branches as Record<string, BranchEntry>)
      : {};
  for (const k of Object.keys(branches)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') return null;
  }
  return {
    ...base,
    ...obj,
    branches,
  };
}

export function loadBranchStore(stateFile?: string): BranchStore {
  const filePath = stateFile || DEFAULT_BRANCH_STATE_FILE;
  if (!existsSync(filePath)) return defaultBranchStore();
  const parsed = _safeParseStore(readFileSync(filePath, 'utf8'));
  return parsed || defaultBranchStore();
}

export function saveBranchStore(store: BranchStore, stateFile?: string): void {
  const filePath = stateFile || DEFAULT_BRANCH_STATE_FILE;
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  store.last_updated = new Date().toISOString();
  writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

function _newBranchEntry(branch: string): BranchEntry {
  return {
    branch,
    created_at: new Date().toISOString(),
    phase_snapshots: [],
    approved_artifacts: [],
    pr_number: null,
    pr_url: null,
  };
}

/**
 * Start tracking a branch.
 */
export function trackBranch(root: string, options: TrackBranchOptions = {}): TrackResult {
  const branch = options.branch || getCurrentBranch(root);
  const commit = getCurrentCommit(root);
  const stateFile = options.stateFile || join(root, DEFAULT_BRANCH_STATE_FILE);
  const store = loadBranchStore(stateFile);

  const existing = store.branches[branch] || _newBranchEntry(branch);
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
 */
export function recordPhaseSnapshot(
  root: string,
  phase: number,
  snapshot: Record<string, unknown> = {},
  options: StateOptions = {}
): SnapshotResult {
  const branch = options.branch || getCurrentBranch(root);
  const stateFile = options.stateFile || join(root, DEFAULT_BRANCH_STATE_FILE);
  const store = loadBranchStore(stateFile);

  if (!store.branches[branch]) {
    store.branches[branch] = _newBranchEntry(branch);
  }

  const entry: PhaseSnapshot = {
    phase,
    recorded_at: new Date().toISOString(),
    commit: getCurrentCommit(root),
    ...snapshot,
  };

  store.branches[branch].phase_snapshots.push(entry);
  saveBranchStore(store, stateFile);

  return { success: true, branch, snapshot: entry };
}

/**
 * Record an artifact approval for a specific branch.
 */
export function recordBranchApproval(
  root: string,
  artifactPath: string,
  approver: string,
  options: StateOptions = {}
): ApprovalResult {
  const branch = options.branch || getCurrentBranch(root);
  const stateFile = options.stateFile || join(root, DEFAULT_BRANCH_STATE_FILE);
  const store = loadBranchStore(stateFile);

  if (!store.branches[branch]) {
    store.branches[branch] = _newBranchEntry(branch);
  }

  const entry: BranchApproval = {
    artifact: artifactPath,
    approver,
    approved_at: new Date().toISOString(),
    commit: getCurrentCommit(root),
  };

  store.branches[branch].approved_artifacts.push(entry);
  saveBranchStore(store, stateFile);

  return { success: true, branch, approval: entry };
}

/**
 * Get the workflow status of a branch.
 */
export function getBranchStatus(root: string, options: StateOptions = {}): StatusResult {
  const branch = options.branch || getCurrentBranch(root);
  const stateFile = options.stateFile || join(root, DEFAULT_BRANCH_STATE_FILE);
  const store = loadBranchStore(stateFile);

  const branchData = store.branches[branch];
  if (!branchData) {
    return {
      success: true,
      branch,
      tracked: false,
      message: `Branch "${branch}" is not yet tracked. Run: jumpstart-mode branch-workflow track`,
    };
  }

  return {
    success: true,
    branch,
    tracked: true,
    data: branchData,
    phase_count: (branchData.phase_snapshots || []).length,
    approved_count: (branchData.approved_artifacts || []).length,
  };
}

/**
 * List all tracked branches.
 */
export function listTrackedBranches(options: StateOptions = {}): ListResult {
  const stateFile = options.stateFile || DEFAULT_BRANCH_STATE_FILE;
  const store = loadBranchStore(stateFile);

  const branches = Object.values(store.branches);
  return { success: true, branches, total: branches.length };
}
