/**
 * ai-intake.ts — AI Use Case Intake port (T4.4.3, cluster L).
 *
 * Pure-library port of `bin/lib/ai-intake.js`. Public surface preserved
 * verbatim by name + signature:
 *
 *   - `INTAKE_SECTIONS` (constant array)
 *   - `RISK_TIERS` (constant array)
 *   - `defaultState()` / `loadState()` / `saveState()`
 *   - `createIntake(intake, options?)` => CreateResult
 *   - `listIntakes(filter?, options?)` => ListResult
 *   - `assessIntake(intakeId, options?)` => AssessResult
 *
 * Behavior parity:
 *   - Default state path: `.jumpstart/state/ai-intake.json`.
 *   - Auto-assess risk tier: 4 (PHI/PCI), 3 (PII/credentials), 2 (business-sensitive/internal), 1 default.
 *   - JSON parse failures load defaults silently.
 *   - JSON shape validation rejects `__proto__` / `constructor` / `prototype`.
 *
 * @see bin/lib/ai-intake.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.3
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface RiskTier {
  tier: number;
  label: string;
  description: string;
}

export interface IntakeInput {
  name: string;
  description: string;
  sponsor?: string | null;
  business_value?: string;
  data_types?: string[];
  model_type?: string | null;
}

export interface AIIntake {
  id: string;
  name: string;
  description: string;
  sponsor: string | null;
  business_value: string;
  data_types: string[];
  model_type: string | null;
  risk_tier: number;
  risk_label: string;
  status: string;
  sections_completed: string[];
  created_at: string;
}

export interface AIIntakeState {
  version: string;
  created_at: string;
  last_updated: string | null;
  intakes: AIIntake[];
}

export interface IntakeFilter {
  status?: string;
  risk_tier?: number;
}

export interface StateOptions {
  stateFile?: string;
}

export interface CreateResult {
  success: boolean;
  intake?: AIIntake;
  error?: string;
}

export interface ListResult {
  success: boolean;
  intakes: AIIntake[];
  total: number;
}

export interface AssessResult {
  success: boolean;
  intake_id?: string;
  completeness?: number;
  completed_sections?: string[];
  missing_sections?: string[];
  risk_tier?: number;
  ready_for_review?: boolean;
  error?: string;
}

const DEFAULT_STATE_FILE = join('.jumpstart', 'state', 'ai-intake.json');

export const INTAKE_SECTIONS: string[] = [
  'business-value',
  'data-sensitivity',
  'model-risk',
  'operating-model',
  'ethical-review',
  'compliance-requirements',
];

export const RISK_TIERS: RiskTier[] = [
  { tier: 1, label: 'Low Risk', description: 'No PII, internal tools, low business impact' },
  { tier: 2, label: 'Medium Risk', description: 'Some PII, customer-facing, moderate impact' },
  { tier: 3, label: 'High Risk', description: 'Sensitive data, critical decisions, high impact' },
  {
    tier: 4,
    label: 'Critical Risk',
    description: 'Regulated domain, autonomous decisions, severe impact',
  },
];

export function defaultState(): AIIntakeState {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    intakes: [],
  };
}

function _safeParseState(content: string): AIIntakeState | null {
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
  const base = defaultState();
  return {
    ...base,
    ...obj,
    intakes: Array.isArray(obj.intakes) ? (obj.intakes as AIIntake[]) : [],
  };
}

export function loadState(stateFile?: string): AIIntakeState {
  const fp = stateFile || DEFAULT_STATE_FILE;
  if (!existsSync(fp)) return defaultState();
  const parsed = _safeParseState(readFileSync(fp, 'utf8'));
  return parsed || defaultState();
}

export function saveState(state: AIIntakeState, stateFile?: string): void {
  const fp = stateFile || DEFAULT_STATE_FILE;
  const dir = dirname(fp);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  writeFileSync(fp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/**
 * Create a new AI use case intake.
 */
export function createIntake(intake: IntakeInput, options: StateOptions = {}): CreateResult {
  if (!intake?.name || !intake.description) {
    return { success: false, error: 'name and description are required' };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const dataTypes: string[] = intake.data_types || [];
  let riskTier = 1;
  if (dataTypes.some((dt) => ['PHI', 'PCI'].includes(dt))) riskTier = 4;
  else if (dataTypes.some((dt) => ['PII', 'credentials'].includes(dt))) riskTier = 3;
  else if (dataTypes.some((dt) => ['business-sensitive', 'internal'].includes(dt))) riskTier = 2;

  const newIntake: AIIntake = {
    id: `AI-${(state.intakes.length + 1).toString().padStart(3, '0')}`,
    name: intake.name,
    description: intake.description,
    sponsor: intake.sponsor || null,
    business_value: intake.business_value || '',
    data_types: dataTypes,
    model_type: intake.model_type || null,
    risk_tier: riskTier,
    risk_label: RISK_TIERS[riskTier - 1].label,
    status: 'draft',
    sections_completed: [],
    created_at: new Date().toISOString(),
  };

  state.intakes.push(newIntake);
  saveState(state, stateFile);

  return { success: true, intake: newIntake };
}

/**
 * List intakes with optional filter.
 */
export function listIntakes(filter: IntakeFilter = {}, options: StateOptions = {}): ListResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);
  let intakes = state.intakes;

  if (filter.status) intakes = intakes.filter((i) => i.status === filter.status);
  if (filter.risk_tier) intakes = intakes.filter((i) => i.risk_tier === filter.risk_tier);

  return { success: true, intakes, total: intakes.length };
}

/**
 * Assess intake completeness.
 */
export function assessIntake(intakeId: string, options: StateOptions = {}): AssessResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const intake = state.intakes.find((i) => i.id === intakeId);
  if (!intake) return { success: false, error: `Intake not found: ${intakeId}` };

  const completedSections = intake.sections_completed || [];
  const missingSections = INTAKE_SECTIONS.filter((s) => !completedSections.includes(s));
  const completeness = Math.round((completedSections.length / INTAKE_SECTIONS.length) * 100);

  return {
    success: true,
    intake_id: intakeId,
    completeness,
    completed_sections: completedSections,
    missing_sections: missingSections,
    risk_tier: intake.risk_tier,
    ready_for_review: completeness >= 80,
  };
}
