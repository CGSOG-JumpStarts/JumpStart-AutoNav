/**
 * ops-ownership.ts — operational ownership modeling port (T4.4.2, cluster I).
 *
 * Pure-library port of `bin/lib/ops-ownership.js`. Public surface
 * preserved verbatim:
 *
 *   - `defaultState()`, `loadState(stateFile?)`, `saveState(state, stateFile?)`
 *   - `defineOwnership(service, options?)` => DefineResult
 *   - `checkCompleteness(options?)` => CompletenessResult
 *   - `generateReport(options?)` => OpsReport
 *   - `OWNERSHIP_FIELDS`
 *
 * Behavior parity:
 *   - Default state path: `.jumpstart/state/ops-ownership.json`.
 *   - 7 ownership fields preserved verbatim.
 *   - Replace-by-name semantics preserved.
 *   - M3 hardening: shape-validated JSON; rejects __proto__.
 *
 * @see bin/lib/ops-ownership.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.2
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DEFAULT_STATE_FILE = join('.jumpstart', 'state', 'ops-ownership.json');

export const OWNERSHIP_FIELDS = [
  'service_owner',
  'team',
  'escalation_path',
  'oncall_model',
  'support_hours',
  'runbook_url',
  'sla_tier',
] as const;

export interface ServiceOwnership {
  id: string;
  name: string;
  service_owner: string;
  team: string | null;
  escalation_path: string[];
  oncall_model: string;
  support_hours: string;
  runbook_url: string | null;
  sla_tier: string;
  defined_at: string;
}

export interface OpsState {
  version: string;
  created_at: string;
  last_updated: string | null;
  services: ServiceOwnership[];
}

export interface ServiceInput {
  name?: string;
  service_owner?: string;
  team?: string;
  escalation_path?: string[];
  oncall_model?: string;
  support_hours?: string;
  runbook_url?: string;
  sla_tier?: string;
}

export interface StateOptions {
  stateFile?: string;
}

export interface DefineResult {
  success: boolean;
  service?: ServiceOwnership;
  error?: string;
}

export interface CompletenessFinding {
  service: string;
  missing: string[];
}

export interface CompletenessResult {
  success: true;
  total_services: number;
  complete: number;
  incomplete: number;
  findings: CompletenessFinding[];
  all_complete: boolean;
}

export interface OpsReport {
  success: true;
  total_services: number;
  by_team: Record<string, number>;
  by_tier: Record<string, number>;
  services: ServiceOwnership[];
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function safeParseState(raw: string): OpsState | null {
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
  const data = parsed as Partial<OpsState>;
  return {
    version: typeof data.version === 'string' ? data.version : '1.0.0',
    created_at: typeof data.created_at === 'string' ? data.created_at : new Date().toISOString(),
    last_updated: typeof data.last_updated === 'string' ? data.last_updated : null,
    services: Array.isArray(data.services) ? (data.services as ServiceOwnership[]) : [],
  };
}

export function defaultState(): OpsState {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    services: [],
  };
}

export function loadState(stateFile?: string): OpsState {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  if (!existsSync(filePath)) return defaultState();
  const parsed = safeParseState(readFileSync(filePath, 'utf8'));
  return parsed ?? defaultState();
}

export function saveState(state: OpsState, stateFile?: string): void {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function defineOwnership(service: ServiceInput, options: StateOptions = {}): DefineResult {
  if (!service?.name || !service.service_owner) {
    return { success: false, error: 'name and service_owner are required' };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const svc: ServiceOwnership = {
    id: `OPS-${(state.services.length + 1).toString().padStart(3, '0')}`,
    name: service.name,
    service_owner: service.service_owner,
    team: service.team || null,
    escalation_path: service.escalation_path || [],
    oncall_model: service.oncall_model || 'business-hours',
    support_hours: service.support_hours || '9x5',
    runbook_url: service.runbook_url || null,
    sla_tier: service.sla_tier || 'silver',
    defined_at: new Date().toISOString(),
  };

  const idx = state.services.findIndex((s) => s.name === service.name);
  if (idx >= 0) state.services[idx] = svc;
  else state.services.push(svc);

  saveState(state, stateFile);

  return { success: true, service: svc };
}

export function checkCompleteness(options: StateOptions = {}): CompletenessResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const incomplete: CompletenessFinding[] = [];
  for (const svc of state.services) {
    const missing: string[] = [];
    if (!svc.service_owner) missing.push('service_owner');
    if (!svc.team) missing.push('team');
    if (!svc.escalation_path || svc.escalation_path.length === 0) missing.push('escalation_path');
    if (!svc.runbook_url) missing.push('runbook_url');

    if (missing.length > 0) {
      incomplete.push({ service: svc.name, missing });
    }
  }

  return {
    success: true,
    total_services: state.services.length,
    complete: state.services.length - incomplete.length,
    incomplete: incomplete.length,
    findings: incomplete,
    all_complete: incomplete.length === 0,
  };
}

export function generateReport(options: StateOptions = {}): OpsReport {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const byTeam: Record<string, number> = {};
  const byTier: Record<string, number> = {};
  for (const svc of state.services) {
    const team = svc.team || 'unassigned';
    byTeam[team] = (byTeam[team] || 0) + 1;
    byTier[svc.sla_tier] = (byTier[svc.sla_tier] || 0) + 1;
  }

  return {
    success: true,
    total_services: state.services.length,
    by_team: byTeam,
    by_tier: byTier,
    services: state.services,
  };
}
