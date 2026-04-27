/**
 * risk-register.ts — risk register tracking port (T4.4.2, cluster I).
 *
 * Pure-library port of `bin/lib/risk-register.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `defaultState()` => RiskState
 *   - `loadState(stateFile?)` => RiskState
 *   - `saveState(state, stateFile?)` => void
 *   - `addRisk(risk, options?)` => AddRiskResult
 *   - `updateRisk(riskId, updates, options?)` => UpdateRiskResult
 *   - `listRisks(filter?, options?)` => ListRisksResult
 *   - `generateReport(options?)` => RiskReport
 *   - `RISK_CATEGORIES`, `RISK_LIKELIHOODS`, `RISK_IMPACTS`,
 *     `RISK_STATUSES`, `RISK_SCORE_MATRIX` (constants)
 *
 * Behavior parity:
 *   - Default state path: `.jumpstart/state/risk-register.json`.
 *   - 5x5 likelihood/impact score matrix preserved verbatim.
 *   - High-risk threshold: score >= 15.
 *   - M3 hardening: shape-validated JSON; rejects __proto__/constructor/prototype.
 *
 * @see bin/lib/risk-register.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.2
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DEFAULT_STATE_FILE = join('.jumpstart', 'state', 'risk-register.json');

export const RISK_CATEGORIES = [
  'business',
  'delivery',
  'security',
  'operational',
  'compliance',
  'technical',
] as const;
export const RISK_LIKELIHOODS = [
  'rare',
  'unlikely',
  'possible',
  'likely',
  'almost-certain',
] as const;
export const RISK_IMPACTS = ['negligible', 'minor', 'moderate', 'major', 'critical'] as const;
export const RISK_STATUSES = [
  'identified',
  'mitigating',
  'accepted',
  'resolved',
  'closed',
] as const;

export type RiskCategory = (typeof RISK_CATEGORIES)[number];
export type RiskLikelihood = (typeof RISK_LIKELIHOODS)[number];
export type RiskImpact = (typeof RISK_IMPACTS)[number];
export type RiskStatus = (typeof RISK_STATUSES)[number];

export const RISK_SCORE_MATRIX: Record<RiskLikelihood, Record<RiskImpact, number>> = {
  rare: { negligible: 1, minor: 2, moderate: 3, major: 4, critical: 5 },
  unlikely: { negligible: 2, minor: 4, moderate: 6, major: 8, critical: 10 },
  possible: { negligible: 3, minor: 6, moderate: 9, major: 12, critical: 15 },
  likely: { negligible: 4, minor: 8, moderate: 12, major: 16, critical: 20 },
  'almost-certain': { negligible: 5, minor: 10, moderate: 15, major: 20, critical: 25 },
};

export interface Risk {
  id: string;
  title: string;
  description: string;
  category: string;
  likelihood: string;
  impact: string;
  score: number;
  status: string;
  owner: string | null;
  mitigation: string | null;
  created_at: string;
  updated_at: string;
}

export interface RiskState {
  version: string;
  created_at: string;
  last_updated: string | null;
  risks: Risk[];
  mitigations: unknown[];
}

export interface RiskInput {
  title?: string;
  description?: string;
  category?: string;
  likelihood?: string;
  impact?: string;
  owner?: string;
  mitigation?: string;
}

export interface RiskUpdate {
  status?: string;
  mitigation?: string;
  owner?: string;
  likelihood?: string;
  impact?: string;
}

export interface RiskFilter {
  category?: string;
  status?: string;
  minScore?: number;
}

export interface StateOptions {
  stateFile?: string;
}

export interface AddRiskResult {
  success: boolean;
  risk?: Risk;
  error?: string;
}

export interface UpdateRiskResult {
  success: boolean;
  risk?: Risk;
  error?: string;
}

export interface ListRisksResult {
  success: true;
  risks: Risk[];
  total: number;
}

export interface RiskReport {
  success: true;
  total_risks: number;
  by_category: Record<string, number>;
  by_status: Record<string, number>;
  average_score: number;
  high_risks: number;
  unmitigated: number;
  top_risks: Risk[];
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function safeParseState(raw: string): RiskState | null {
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
  const data = parsed as Partial<RiskState>;
  return {
    version: typeof data.version === 'string' ? data.version : '1.0.0',
    created_at: typeof data.created_at === 'string' ? data.created_at : new Date().toISOString(),
    last_updated: typeof data.last_updated === 'string' ? data.last_updated : null,
    risks: Array.isArray(data.risks) ? (data.risks as Risk[]) : [],
    mitigations: Array.isArray(data.mitigations) ? data.mitigations : [],
  };
}

export function defaultState(): RiskState {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    risks: [],
    mitigations: [],
  };
}

export function loadState(stateFile?: string): RiskState {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  if (!existsSync(filePath)) return defaultState();
  const parsed = safeParseState(readFileSync(filePath, 'utf8'));
  return parsed ?? defaultState();
}

export function saveState(state: RiskState, stateFile?: string): void {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function addRisk(risk: RiskInput, options: StateOptions = {}): AddRiskResult {
  if (!risk?.title || !risk.description) {
    return { success: false, error: 'title and description are required' };
  }

  const category = (risk.category || 'technical').toLowerCase();
  if (!(RISK_CATEGORIES as readonly string[]).includes(category)) {
    return {
      success: false,
      error: `Invalid category. Must be one of: ${RISK_CATEGORIES.join(', ')}`,
    };
  }

  const likelihood = (risk.likelihood || 'possible').toLowerCase();
  const impact = (risk.impact || 'moderate').toLowerCase();

  if (!(RISK_LIKELIHOODS as readonly string[]).includes(likelihood)) {
    return {
      success: false,
      error: `Invalid likelihood. Must be one of: ${RISK_LIKELIHOODS.join(', ')}`,
    };
  }
  if (!(RISK_IMPACTS as readonly string[]).includes(impact)) {
    return {
      success: false,
      error: `Invalid impact. Must be one of: ${RISK_IMPACTS.join(', ')}`,
    };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const score = RISK_SCORE_MATRIX[likelihood as RiskLikelihood][impact as RiskImpact];

  const newRisk: Risk = {
    id: `RISK-${(state.risks.length + 1).toString().padStart(3, '0')}`,
    title: risk.title,
    description: risk.description,
    category,
    likelihood,
    impact,
    score,
    status: 'identified',
    owner: risk.owner || null,
    mitigation: risk.mitigation || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  state.risks.push(newRisk);
  saveState(state, stateFile);

  return { success: true, risk: newRisk };
}

export function updateRisk(
  riskId: string,
  updates: RiskUpdate,
  options: StateOptions = {}
): UpdateRiskResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const risk = state.risks.find((r) => r.id === riskId);
  if (!risk) return { success: false, error: `Risk not found: ${riskId}` };

  if (updates.status && (RISK_STATUSES as readonly string[]).includes(updates.status)) {
    risk.status = updates.status;
  }
  if (updates.mitigation) risk.mitigation = updates.mitigation;
  if (updates.owner) risk.owner = updates.owner;
  if (updates.likelihood && (RISK_LIKELIHOODS as readonly string[]).includes(updates.likelihood)) {
    risk.likelihood = updates.likelihood;
    risk.score = RISK_SCORE_MATRIX[risk.likelihood as RiskLikelihood][risk.impact as RiskImpact];
  }
  if (updates.impact && (RISK_IMPACTS as readonly string[]).includes(updates.impact)) {
    risk.impact = updates.impact;
    risk.score = RISK_SCORE_MATRIX[risk.likelihood as RiskLikelihood][risk.impact as RiskImpact];
  }

  risk.updated_at = new Date().toISOString();
  saveState(state, stateFile);

  return { success: true, risk };
}

export function listRisks(filter: RiskFilter = {}, options: StateOptions = {}): ListRisksResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);
  let risks = state.risks;

  if (filter.category) risks = risks.filter((r) => r.category === filter.category);
  if (filter.status) risks = risks.filter((r) => r.status === filter.status);
  if (filter.minScore !== undefined) {
    const minScore = filter.minScore;
    risks = risks.filter((r) => r.score >= minScore);
  }

  return { success: true, risks, total: risks.length };
}

export function generateReport(options: StateOptions = {}): RiskReport {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const byCategory: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  let totalScore = 0;

  for (const risk of state.risks) {
    byCategory[risk.category] = (byCategory[risk.category] || 0) + 1;
    byStatus[risk.status] = (byStatus[risk.status] || 0) + 1;
    totalScore += risk.score;
  }

  const highRisks = state.risks.filter((r) => r.score >= 15);
  const unmitigated = state.risks.filter((r) => !r.mitigation && r.status === 'identified');

  return {
    success: true,
    total_risks: state.risks.length,
    by_category: byCategory,
    by_status: byStatus,
    average_score: state.risks.length > 0 ? Math.round(totalScore / state.risks.length) : 0,
    high_risks: highRisks.length,
    unmitigated: unmitigated.length,
    top_risks: [...state.risks].sort((a, b) => b.score - a.score).slice(0, 5),
  };
}
