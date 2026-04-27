/**
 * raci-matrix.ts — RACI-aware approvals port (T4.4.2, cluster I).
 *
 * Pure-library port of `bin/lib/raci-matrix.js`. Public surface
 * preserved verbatim:
 *
 *   - `defaultState()`, `loadState(stateFile?)`, `saveState(state, stateFile?)`
 *   - `defineAssignment(artifact, assignment, options?)` => DefineResult
 *   - `checkPermission(artifact, actor, action, options?)` => CheckResult
 *   - `generateReport(options?)` => RaciReport
 *   - `RACI_ROLES`, `DEFAULT_PHASES`, `DEFAULT_ARTIFACTS`
 *
 * Behavior parity:
 *   - Default state path: `.jumpstart/state/raci-matrix.json`.
 *   - 6 default phases, 6 default artifacts preserved verbatim.
 *   - M3 hardening: shape-validated JSON; rejects __proto__.
 *
 * @see bin/lib/raci-matrix.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.2
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DEFAULT_STATE_FILE = join('.jumpstart', 'state', 'raci-matrix.json');

export const RACI_ROLES = ['responsible', 'accountable', 'consulted', 'informed'] as const;

export const DEFAULT_PHASES = [
  'scout',
  'challenger',
  'analyst',
  'pm',
  'architect',
  'developer',
] as const;

export const DEFAULT_ARTIFACTS = [
  'specs/codebase-context.md',
  'specs/challenger-brief.md',
  'specs/product-brief.md',
  'specs/prd.md',
  'specs/architecture.md',
  'specs/implementation-plan.md',
] as const;

export interface RaciAssignment {
  artifact: string;
  responsible: string;
  accountable: string;
  consulted: string[];
  informed: string[];
  defined_at: string;
}

export interface RaciState {
  version: string;
  created_at: string;
  last_updated: string | null;
  assignments: Record<string, RaciAssignment>;
  stakeholders: string[];
}

export interface AssignmentInput {
  responsible?: string;
  accountable?: string;
  consulted?: string[];
  informed?: string[];
}

export interface StateOptions {
  stateFile?: string;
}

export interface DefineResult {
  success: boolean;
  artifact?: string;
  assignment?: RaciAssignment;
  error?: string;
}

export interface CheckResult {
  success: true;
  allowed: boolean;
  reason: string;
}

export interface MatrixRow {
  artifact: string;
  R: string;
  A: string;
  C: string;
  I: string;
}

export interface RaciReport {
  success: true;
  matrix: MatrixRow[];
  stakeholders: string[];
  total_assignments: number;
  gaps: string[];
  coverage: number;
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function safeParseState(raw: string): RaciState | null {
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
  const data = parsed as Partial<RaciState>;
  let assignments: Record<string, RaciAssignment> = {};
  if (isPlainObject(data.assignments)) {
    for (const [k, v] of Object.entries(data.assignments)) {
      if (FORBIDDEN_KEYS.has(k)) continue;
      assignments[k] = v as RaciAssignment;
    }
  } else {
    assignments = {};
  }
  return {
    version: typeof data.version === 'string' ? data.version : '1.0.0',
    created_at: typeof data.created_at === 'string' ? data.created_at : new Date().toISOString(),
    last_updated: typeof data.last_updated === 'string' ? data.last_updated : null,
    assignments,
    stakeholders: Array.isArray(data.stakeholders)
      ? data.stakeholders.filter((s): s is string => typeof s === 'string')
      : [],
  };
}

export function defaultState(): RaciState {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    assignments: {},
    stakeholders: [],
  };
}

export function loadState(stateFile?: string): RaciState {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  if (!existsSync(filePath)) return defaultState();
  const parsed = safeParseState(readFileSync(filePath, 'utf8'));
  return parsed ?? defaultState();
}

export function saveState(state: RaciState, stateFile?: string): void {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function defineAssignment(
  artifact: string,
  assignment: AssignmentInput,
  options: StateOptions = {}
): DefineResult {
  if (!artifact) return { success: false, error: 'artifact is required' };
  if (!assignment?.accountable) {
    return { success: false, error: 'assignment.accountable is required' };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const stored: RaciAssignment = {
    artifact,
    responsible: assignment.responsible || assignment.accountable,
    accountable: assignment.accountable,
    consulted: Array.isArray(assignment.consulted) ? assignment.consulted : [],
    informed: Array.isArray(assignment.informed) ? assignment.informed : [],
    defined_at: new Date().toISOString(),
  };

  state.assignments[artifact] = stored;

  const allPeople = [
    assignment.responsible,
    assignment.accountable,
    ...(assignment.consulted || []),
    ...(assignment.informed || []),
  ].filter((p): p is string => Boolean(p));

  for (const person of allPeople) {
    if (!state.stakeholders.includes(person)) {
      state.stakeholders.push(person);
    }
  }

  saveState(state, stateFile);

  return { success: true, artifact, assignment: stored };
}

export function checkPermission(
  artifact: string,
  actor: string,
  action: string,
  options: StateOptions = {}
): CheckResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const assignment = state.assignments[artifact];
  if (!assignment) {
    return {
      success: true,
      allowed: true,
      reason: 'No RACI assignment defined — unrestricted',
    };
  }

  if (action === 'approve') {
    const allowed = assignment.accountable === actor || assignment.responsible === actor;
    return {
      success: true,
      allowed,
      reason: allowed
        ? `${actor} is ${assignment.accountable === actor ? 'Accountable' : 'Responsible'}`
        : `${actor} is not Responsible or Accountable. Need: ${assignment.accountable}`,
    };
  }

  if (action === 'review') {
    const allowed =
      assignment.consulted.includes(actor) ||
      assignment.responsible === actor ||
      assignment.accountable === actor;
    return {
      success: true,
      allowed,
      reason: allowed ? 'Actor has review rights' : 'Actor is not in C/R/A',
    };
  }

  return { success: true, allowed: true, reason: 'Action permitted' };
}

export function generateReport(options: StateOptions = {}): RaciReport {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const matrix: MatrixRow[] = Object.entries(state.assignments).map(([artifact, a]) => ({
    artifact,
    R: a.responsible,
    A: a.accountable,
    C: a.consulted.join(', '),
    I: a.informed.join(', '),
  }));

  const gaps = DEFAULT_ARTIFACTS.filter((a) => !state.assignments[a]);

  return {
    success: true,
    matrix,
    stakeholders: state.stakeholders,
    total_assignments: matrix.length,
    gaps: [...gaps],
    coverage:
      DEFAULT_ARTIFACTS.length > 0
        ? Math.round(((DEFAULT_ARTIFACTS.length - gaps.length) / DEFAULT_ARTIFACTS.length) * 100)
        : 100,
  };
}
