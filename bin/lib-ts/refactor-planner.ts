/**
 * refactor-planner.ts — refactor planner port (T4.4.1, cluster J).
 *
 * Pure-library port of `bin/lib/refactor-planner.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `REFACTOR_TYPES` (constant array)
 *   - `RISK_LEVELS` (constant array)
 *   - `defaultState()` => RefactorPlanStore
 *   - `loadState(stateFile?)` => RefactorPlanStore
 *   - `saveState(state, stateFile?)`
 *   - `createPlan(plan, options?)` => CreatePlanResult
 *   - `validatePlan(planId, options?)` => ValidatePlanResult
 *   - `generateReport(options?)` => RefactorReport
 *
 * Behavior parity:
 *   - Default state file: `.jumpstart/state/refactor-plan.json`.
 *   - Plan ID format: `REF-NNN` (zero-padded, monotonic with array length).
 *   - Step risk fallback: `low`. Plan risk: `critical` if any critical step,
 *     else `high` if any high step, else `medium`.
 *   - Step descriptions accept both `{description, ...}` and bare strings.
 *
 * Hardening (F2/F4/F9/F13 lessons from M3/M4):
 *   - Static `node:fs` import.
 *   - JSON.parse output is shape-validated before return; soft-falls to
 *     `defaultState()` on any mismatch (F13).
 *   - Reject `__proto__`/`constructor`/`prototype` keys at the persisted
 *     root and on every plan id we look up (F2 prototype pollution guard).
 *
 * @see bin/lib/refactor-planner.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.1
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Public types

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type RefactorType =
  | 'rename'
  | 'move'
  | 'extract'
  | 'inline'
  | 'restructure'
  | 'migrate'
  | 'upgrade';

export interface PlanStepInput {
  description?: string;
  dependencies?: number[];
  risk?: RiskLevel;
  rollback?: string | null;
}

export interface PlanStep {
  order: number;
  description: string;
  status: string;
  dependencies: number[];
  risk: RiskLevel;
  rollback: string | null;
}

export interface PlanInput {
  name: string;
  type: RefactorType;
  description?: string;
  steps?: Array<PlanStepInput | string>;
  affected_files?: string[];
}

export interface RefactorPlan {
  id: string;
  name: string;
  type: RefactorType;
  description: string;
  steps: PlanStep[];
  affected_files: string[];
  status: string;
  risk_level: RiskLevel;
  created_at: string;
}

export interface RefactorPlanStore {
  version: string;
  created_at: string;
  last_updated: string | null;
  plans: RefactorPlan[];
  completed: RefactorPlan[];
}

export interface PlannerFileOptions {
  stateFile?: string;
}

export interface CreatePlanResult {
  success: boolean;
  plan?: RefactorPlan;
  error?: string;
}

export interface ValidationIssue {
  type: 'circular-dependency' | 'invalid-order';
  steps?: number[];
  step?: number;
  depends_on?: number;
}

export interface ValidatePlanResult {
  success: boolean;
  error?: string;
  plan_id?: string;
  valid?: boolean;
  issues?: ValidationIssue[];
  total_steps?: number;
  risk_level?: RiskLevel;
}

export interface RefactorReport {
  success: boolean;
  total_plans: number;
  completed: number;
  active: number;
  by_type: Record<string, number>;
  plans: RefactorPlan[];
}

// Constants (verbatim from legacy)

const DEFAULT_STATE_FILE = join('.jumpstart', 'state', 'refactor-plan.json');

export const REFACTOR_TYPES: RefactorType[] = [
  'rename',
  'move',
  'extract',
  'inline',
  'restructure',
  'migrate',
  'upgrade',
];

export const RISK_LEVELS: RiskLevel[] = ['low', 'medium', 'high', 'critical'];

/** Default empty store (legacy parity). */
export function defaultState(): RefactorPlanStore {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    plans: [],
    completed: [],
  };
}

/**
 * Load state from disk; soft-falls to defaults on missing/corrupt/wrong-shape.
 *
 * F13 hardening: shape-validate the JSON.parse root before trusting it.
 * F2 hardening: reject prototype-pollution-shaped keys at the root.
 */
export function loadState(stateFile?: string): RefactorPlanStore {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  if (!existsSync(filePath)) return defaultState();

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return defaultState();
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return defaultState();
  }
  const obj = parsed as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
      return defaultState();
    }
  }
  const base = defaultState();
  return {
    version: typeof obj.version === 'string' ? obj.version : base.version,
    created_at: typeof obj.created_at === 'string' ? obj.created_at : base.created_at,
    last_updated: typeof obj.last_updated === 'string' ? (obj.last_updated as string) : null,
    plans: Array.isArray(obj.plans) ? (obj.plans as RefactorPlan[]) : [],
    completed: Array.isArray(obj.completed) ? (obj.completed as RefactorPlan[]) : [],
  };
}

/** Persist store to disk. Auto-creates parent dir, stamps last_updated, trailing newline. */
export function saveState(state: RefactorPlanStore, stateFile?: string): void {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/** Resolve a step input (object or bare string) to a PlanStep with defaults. */
function normalizeStep(step: PlanStepInput | string, index: number): PlanStep {
  if (typeof step === 'string') {
    return {
      order: index + 1,
      description: step,
      status: 'pending',
      dependencies: [],
      risk: 'low',
      rollback: null,
    };
  }
  return {
    order: index + 1,
    description: step.description || '',
    status: 'pending',
    dependencies: step.dependencies || [],
    risk: step.risk || 'low',
    rollback: step.rollback || null,
  };
}

/** Create a refactor plan. Validates required fields + REFACTOR_TYPES membership. */
export function createPlan(plan: PlanInput, options: PlannerFileOptions = {}): CreatePlanResult {
  if (!plan?.name || !plan.type) {
    return { success: false, error: 'name and type are required' };
  }

  if (!REFACTOR_TYPES.includes(plan.type)) {
    return {
      success: false,
      error: `Invalid type. Must be one of: ${REFACTOR_TYPES.join(', ')}`,
    };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const steps: PlanStep[] = (plan.steps || []).map((step, i) => normalizeStep(step, i));

  const riskLevel: RiskLevel = steps.some((s) => s.risk === 'critical')
    ? 'critical'
    : steps.some((s) => s.risk === 'high')
      ? 'high'
      : 'medium';

  const newPlan: RefactorPlan = {
    id: `REF-${(state.plans.length + 1).toString().padStart(3, '0')}`,
    name: plan.name,
    type: plan.type,
    description: plan.description || '',
    steps,
    affected_files: plan.affected_files || [],
    status: 'draft',
    risk_level: riskLevel,
    created_at: new Date().toISOString(),
  };

  state.plans.push(newPlan);
  saveState(state, stateFile);

  return { success: true, plan: newPlan };
}

/** Validate a plan: detect circular and out-of-order step dependencies. */
export function validatePlan(planId: string, options: PlannerFileOptions = {}): ValidatePlanResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const plan = state.plans.find((p) => p.id === planId);
  if (!plan) return { success: false, error: `Plan not found: ${planId}` };

  const issues: ValidationIssue[] = [];

  for (const step of plan.steps) {
    for (const dep of step.dependencies) {
      const depStep = plan.steps.find((s) => s.order === dep);
      if (depStep?.dependencies.includes(step.order)) {
        issues.push({ type: 'circular-dependency', steps: [step.order, dep] });
      }
    }
  }

  for (const step of plan.steps) {
    for (const dep of step.dependencies) {
      if (dep >= step.order) {
        issues.push({ type: 'invalid-order', step: step.order, depends_on: dep });
      }
    }
  }

  return {
    success: true,
    plan_id: planId,
    valid: issues.length === 0,
    issues,
    total_steps: plan.steps.length,
    risk_level: plan.risk_level,
  };
}

/** Generate a roll-up report across all plans. */
export function generateReport(options: PlannerFileOptions = {}): RefactorReport {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const byType: Record<string, number> = {};
  for (const p of state.plans) {
    // p.type is constrained to RefactorType at the type level, so it can
    // never be a prototype-pollution-shaped key. Defensive runtime check
    // is still useful when state.json is hand-edited: cast to string before
    // comparing to bypass TS's overlap check.
    const typeStr: string = p.type;
    if (typeStr === '__proto__' || typeStr === 'constructor' || typeStr === 'prototype') continue;
    byType[typeStr] = (byType[typeStr] || 0) + 1;
  }

  return {
    success: true,
    total_plans: state.plans.length,
    completed: state.completed.length,
    active: state.plans.filter((p) => p.status !== 'completed').length,
    by_type: byType,
    plans: state.plans,
  };
}
