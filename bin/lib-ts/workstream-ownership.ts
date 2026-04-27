/**
 * workstream-ownership.ts — workstream ownership visualization port (T4.4.2, cluster I).
 *
 * Pure-library port of `bin/lib/workstream-ownership.js`. Public surface
 * preserved verbatim:
 *
 *   - `defineWorkstream(name, options?)` => DefineResult
 *   - `addDependency(fromId, toId, options?)` => AddDepResult
 *   - `generateReport(options?)` => WorkstreamReport
 *   - `loadState(stateFile?)`, `saveState(state, stateFile?)`, `defaultState()`
 *
 * Behavior parity:
 *   - Default state path: `.jumpstart/state/workstream-ownership.json`.
 *   - M3 hardening: shape-validated JSON; rejects __proto__.
 *
 * @see bin/lib/workstream-ownership.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.2
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DEFAULT_STATE_FILE = join('.jumpstart', 'state', 'workstream-ownership.json');

export interface Workstream {
  id: string;
  name: string;
  team: string | null;
  owner: string | null;
  status: string;
  components: string[];
  created_at: string;
}

export interface WorkstreamDependency {
  from: string;
  to: string;
  type: string;
  description: string | null;
  created_at: string;
}

export interface WorkstreamState {
  version: string;
  workstreams: Workstream[];
  dependencies: WorkstreamDependency[];
  last_updated: string | null;
}

export interface DefineWorkstreamOptions {
  stateFile?: string;
  team?: string;
  owner?: string;
  status?: string;
  components?: string[];
}

export interface AddDependencyOptions {
  stateFile?: string;
  type?: string;
  description?: string;
}

export interface ReportOptions {
  stateFile?: string;
}

export interface DefineResult {
  success: boolean;
  workstream?: Workstream;
  error?: string;
}

export interface AddDepResult {
  success: boolean;
  dependency?: WorkstreamDependency;
  error?: string;
}

export interface WorkstreamReport {
  success: true;
  total_workstreams: number;
  total_dependencies: number;
  by_team: Record<string, string[]>;
  workstreams: Workstream[];
  dependencies: WorkstreamDependency[];
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function safeParseState(raw: string): WorkstreamState | null {
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
  const data = parsed as Partial<WorkstreamState>;
  return {
    version: typeof data.version === 'string' ? data.version : '1.0.0',
    workstreams: Array.isArray(data.workstreams) ? (data.workstreams as Workstream[]) : [],
    dependencies: Array.isArray(data.dependencies)
      ? (data.dependencies as WorkstreamDependency[])
      : [],
    last_updated: typeof data.last_updated === 'string' ? data.last_updated : null,
  };
}

export function defaultState(): WorkstreamState {
  return { version: '1.0.0', workstreams: [], dependencies: [], last_updated: null };
}

export function loadState(stateFile?: string): WorkstreamState {
  const fp = stateFile || DEFAULT_STATE_FILE;
  if (!existsSync(fp)) return defaultState();
  const parsed = safeParseState(readFileSync(fp, 'utf8'));
  return parsed ?? defaultState();
}

export function saveState(state: WorkstreamState, stateFile?: string): void {
  const fp = stateFile || DEFAULT_STATE_FILE;
  const dir = dirname(fp);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  writeFileSync(fp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function defineWorkstream(
  name: string,
  options: DefineWorkstreamOptions = {}
): DefineResult {
  if (!name) return { success: false, error: 'Workstream name is required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const ws: Workstream = {
    id: `WS-${Date.now()}`,
    name,
    team: options.team || null,
    owner: options.owner || null,
    status: options.status || 'active',
    components: options.components || [],
    created_at: new Date().toISOString(),
  };

  state.workstreams.push(ws);
  saveState(state, stateFile);

  return { success: true, workstream: ws };
}

export function addDependency(
  fromId: string,
  toId: string,
  options: AddDependencyOptions = {}
): AddDepResult {
  if (!fromId || !toId) return { success: false, error: 'fromId and toId are required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const dep: WorkstreamDependency = {
    from: fromId,
    to: toId,
    type: options.type || 'depends-on',
    description: options.description || null,
    created_at: new Date().toISOString(),
  };

  state.dependencies.push(dep);
  saveState(state, stateFile);

  return { success: true, dependency: dep };
}

export function generateReport(options: ReportOptions = {}): WorkstreamReport {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const byTeam: Record<string, string[]> = {};
  for (const ws of state.workstreams) {
    const team = ws.team || 'unassigned';
    if (!byTeam[team]) byTeam[team] = [];
    byTeam[team].push(ws.name);
  }

  return {
    success: true,
    total_workstreams: state.workstreams.length,
    total_dependencies: state.dependencies.length,
    by_team: byTeam,
    workstreams: state.workstreams,
    dependencies: state.dependencies,
  };
}
