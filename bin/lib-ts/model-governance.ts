/**
 * model-governance.ts — model governance workflows port (T4.4.2, cluster I).
 *
 * Pure-library port of `bin/lib/model-governance.js`. Public surface
 * preserved verbatim:
 *
 *   - `defaultState()`, `loadState(stateFile?)`, `saveState(state, stateFile?)`
 *   - `registerModel(model, options?)` => RegisterResult
 *   - `recordEvaluation(modelId, evaluation, options?)` => EvalResult
 *   - `updateStatus(modelId, status, options?)` => UpdateStatusResult
 *   - `generateReport(options?)` => ModelReport
 *   - `MODEL_RISK_LEVELS`, `MODEL_STATUSES`
 *
 * Behavior parity:
 *   - Default state path: `.jumpstart/state/model-governance.json`.
 *   - 4 risk levels (low/medium/high/critical), 5 statuses.
 *   - M3 hardening: shape-validated JSON; rejects __proto__.
 *
 * @see bin/lib/model-governance.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.2
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DEFAULT_STATE_FILE = join('.jumpstart', 'state', 'model-governance.json');

export const MODEL_RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
export const MODEL_STATUSES = [
  'proposed',
  'approved',
  'deployed',
  'deprecated',
  'retired',
] as const;

export interface ModelEntry {
  id: string;
  name: string;
  provider: string;
  version: string;
  use_case: string;
  risk_level: string;
  status: string;
  fallback: string | null;
  prompting_strategy: string | null;
  safety_controls: string[];
  data_handling: string | null;
  registered_at: string;
  status_updated_at?: string;
}

export interface ModelEvaluation {
  id: string;
  model_id: string;
  metrics: Record<string, unknown>;
  notes: string;
  evaluator: string | null;
  evaluated_at: string;
}

export interface ModelGovernanceState {
  version: string;
  created_at: string;
  last_updated: string | null;
  models: ModelEntry[];
  evaluations: ModelEvaluation[];
  safety_controls: unknown[];
}

export interface ModelInput {
  name?: string;
  provider?: string;
  version?: string;
  use_case?: string;
  risk_level?: string;
  fallback?: string;
  prompting_strategy?: string;
  safety_controls?: string[];
  data_handling?: string;
}

export interface EvaluationInput {
  metrics?: Record<string, unknown>;
  notes?: string;
  evaluator?: string;
}

export interface StateOptions {
  stateFile?: string;
}

export interface RegisterResult {
  success: boolean;
  model?: ModelEntry;
  error?: string;
}

export interface EvalResult {
  success: boolean;
  evaluation?: ModelEvaluation;
  error?: string;
}

export interface UpdateStatusResult {
  success: boolean;
  model?: ModelEntry;
  error?: string;
}

export interface ModelReport {
  success: true;
  total_models: number;
  total_evaluations: number;
  by_status: Record<string, number>;
  by_risk: Record<string, number>;
  high_risk_models: ModelEntry[];
  models_without_fallback: ModelEntry[];
  models: ModelEntry[];
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function safeParseState(raw: string): ModelGovernanceState | null {
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
  const data = parsed as Partial<ModelGovernanceState>;
  return {
    version: typeof data.version === 'string' ? data.version : '1.0.0',
    created_at: typeof data.created_at === 'string' ? data.created_at : new Date().toISOString(),
    last_updated: typeof data.last_updated === 'string' ? data.last_updated : null,
    models: Array.isArray(data.models) ? (data.models as ModelEntry[]) : [],
    evaluations: Array.isArray(data.evaluations) ? (data.evaluations as ModelEvaluation[]) : [],
    safety_controls: Array.isArray(data.safety_controls) ? data.safety_controls : [],
  };
}

export function defaultState(): ModelGovernanceState {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    models: [],
    evaluations: [],
    safety_controls: [],
  };
}

export function loadState(stateFile?: string): ModelGovernanceState {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  if (!existsSync(filePath)) return defaultState();
  const parsed = safeParseState(readFileSync(filePath, 'utf8'));
  return parsed ?? defaultState();
}

export function saveState(state: ModelGovernanceState, stateFile?: string): void {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function registerModel(model: ModelInput, options: StateOptions = {}): RegisterResult {
  if (!model?.name || !model.provider) {
    return { success: false, error: 'name and provider are required' };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const riskLevel = (model.risk_level || 'medium').toLowerCase();
  if (!(MODEL_RISK_LEVELS as readonly string[]).includes(riskLevel)) {
    return {
      success: false,
      error: `Invalid risk level. Must be one of: ${MODEL_RISK_LEVELS.join(', ')}`,
    };
  }

  const newModel: ModelEntry = {
    id: `MDL-${(state.models.length + 1).toString().padStart(3, '0')}`,
    name: model.name,
    provider: model.provider,
    version: model.version || 'latest',
    use_case: model.use_case || '',
    risk_level: riskLevel,
    status: 'proposed',
    fallback: model.fallback || null,
    prompting_strategy: model.prompting_strategy || null,
    safety_controls: model.safety_controls || [],
    data_handling: model.data_handling || null,
    registered_at: new Date().toISOString(),
  };

  state.models.push(newModel);
  saveState(state, stateFile);

  return { success: true, model: newModel };
}

export function recordEvaluation(
  modelId: string,
  evaluation: EvaluationInput,
  options: StateOptions = {}
): EvalResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const model = state.models.find((m) => m.id === modelId);
  if (!model) return { success: false, error: `Model not found: ${modelId}` };

  const newEval: ModelEvaluation = {
    id: `EVAL-${Date.now().toString(36).toUpperCase()}`,
    model_id: modelId,
    metrics: evaluation.metrics || {},
    notes: evaluation.notes || '',
    evaluator: evaluation.evaluator || null,
    evaluated_at: new Date().toISOString(),
  };

  state.evaluations.push(newEval);
  saveState(state, stateFile);

  return { success: true, evaluation: newEval };
}

export function updateStatus(
  modelId: string,
  status: string,
  options: StateOptions = {}
): UpdateStatusResult {
  if (!(MODEL_STATUSES as readonly string[]).includes(status)) {
    return {
      success: false,
      error: `Invalid status. Must be one of: ${MODEL_STATUSES.join(', ')}`,
    };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const model = state.models.find((m) => m.id === modelId);
  if (!model) return { success: false, error: `Model not found: ${modelId}` };

  model.status = status;
  model.status_updated_at = new Date().toISOString();
  saveState(state, stateFile);

  return { success: true, model };
}

export function generateReport(options: StateOptions = {}): ModelReport {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const byStatus: Record<string, number> = {};
  const byRisk: Record<string, number> = {};
  for (const m of state.models) {
    byStatus[m.status] = (byStatus[m.status] || 0) + 1;
    byRisk[m.risk_level] = (byRisk[m.risk_level] || 0) + 1;
  }

  return {
    success: true,
    total_models: state.models.length,
    total_evaluations: state.evaluations.length,
    by_status: byStatus,
    by_risk: byRisk,
    high_risk_models: state.models.filter(
      (m) => m.risk_level === 'high' || m.risk_level === 'critical'
    ),
    models_without_fallback: state.models.filter((m) => !m.fallback),
    models: state.models,
  };
}
