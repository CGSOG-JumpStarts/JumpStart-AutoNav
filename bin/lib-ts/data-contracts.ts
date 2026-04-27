/**
 * data-contracts.ts — Data Contract Governance port (T4.4.3, cluster L).
 *
 * Pure-library port of `bin/lib/data-contracts.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `COMPATIBILITY_MODES` (constant array)
 *   - `defaultState()` / `loadState()` / `saveState()`
 *   - `registerContract(name, schema, options?)` => RegisterResult
 *   - `validateCompatibility(contractId, newSchema, options?)` => ValidateResult
 *   - `trackLineage(source, target, options?)` => LineageResult
 *   - `generateReport(options?)` => ReportResult
 *
 * Behavior parity:
 *   - Default state path: `.jumpstart/state/data-contracts.json`.
 *   - Default version: 1.0.0; default compatibility: backward.
 *   - JSON parse failures load defaults silently.
 *   - JSON shape validation rejects `__proto__` / `constructor` / `prototype`.
 *
 * @see bin/lib/data-contracts.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.3
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type CompatibilityMode = 'backward' | 'forward' | 'full' | 'none';

export interface DataContract {
  id: string;
  name: string;
  version: string;
  schema: Record<string, unknown>;
  producer: string | null;
  consumers: string[];
  compatibility: string;
  created_at: string;
}

export interface LineageEntry {
  source: string;
  target: string;
  transformation: string;
  created_at: string;
}

export interface DataContractsState {
  version: string;
  contracts: DataContract[];
  lineage: LineageEntry[];
  last_updated: string | null;
}

export interface RegisterOptions {
  stateFile?: string;
  version?: string;
  producer?: string;
  consumers?: string[];
  compatibility?: string;
}

export interface RegisterResult {
  success: boolean;
  contract?: DataContract;
  error?: string;
}

export interface ValidateOptions {
  stateFile?: string;
}

export interface ValidateResult {
  success: boolean;
  compatible?: boolean;
  issues?: Array<{ type: string; fields: string[] }>;
  added?: string[];
  removed?: string[];
  error?: string;
}

export interface LineageOptions {
  stateFile?: string;
  transformation?: string;
}

export interface LineageResult {
  success: boolean;
  lineage?: LineageEntry;
  error?: string;
}

export interface ReportOptions {
  stateFile?: string;
}

export interface ReportResult {
  success: boolean;
  total_contracts: number;
  total_lineage: number;
  contracts: Array<{ id: string; name: string; version: string; compatibility: string }>;
  lineage: LineageEntry[];
}

const DEFAULT_STATE_FILE = join('.jumpstart', 'state', 'data-contracts.json');

export const COMPATIBILITY_MODES: CompatibilityMode[] = ['backward', 'forward', 'full', 'none'];

export function defaultState(): DataContractsState {
  return {
    version: '1.0.0',
    contracts: [],
    lineage: [],
    last_updated: null,
  };
}

function _safeParseState(content: string): DataContractsState | null {
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
    contracts: Array.isArray(obj.contracts) ? (obj.contracts as DataContract[]) : [],
    lineage: Array.isArray(obj.lineage) ? (obj.lineage as LineageEntry[]) : [],
  };
}

export function loadState(stateFile?: string): DataContractsState {
  const fp = stateFile || DEFAULT_STATE_FILE;
  if (!existsSync(fp)) return defaultState();
  const parsed = _safeParseState(readFileSync(fp, 'utf8'));
  return parsed || defaultState();
}

export function saveState(state: DataContractsState, stateFile?: string): void {
  const fp = stateFile || DEFAULT_STATE_FILE;
  const dir = dirname(fp);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  writeFileSync(fp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function registerContract(
  name: string,
  schema: Record<string, unknown>,
  options: RegisterOptions = {}
): RegisterResult {
  if (!name || !schema) return { success: false, error: 'name and schema are required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const contract: DataContract = {
    id: `DC-${Date.now()}`,
    name,
    version: options.version || '1.0.0',
    schema,
    producer: options.producer || null,
    consumers: options.consumers || [],
    compatibility: options.compatibility || 'backward',
    created_at: new Date().toISOString(),
  };

  state.contracts.push(contract);
  saveState(state, stateFile);

  return { success: true, contract };
}

export function validateCompatibility(
  contractId: string,
  newSchema: Record<string, unknown>,
  options: ValidateOptions = {}
): ValidateResult {
  if (!contractId || !newSchema) {
    return { success: false, error: 'contractId and newSchema are required' };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const contract = state.contracts.find((c) => c.id === contractId);
  if (!contract) return { success: false, error: `Contract ${contractId} not found` };

  const oldFields = new Set(Object.keys(contract.schema));
  const newFields = new Set(Object.keys(newSchema));

  const added = [...newFields].filter((f) => !oldFields.has(f));
  const removed = [...oldFields].filter((f) => !newFields.has(f));

  let compatible = true;
  const issues: Array<{ type: string; fields: string[] }> = [];

  if (contract.compatibility === 'backward' && removed.length > 0) {
    compatible = false;
    issues.push({ type: 'breaking_removal', fields: removed });
  }
  if (contract.compatibility === 'forward' && added.length > 0) {
    compatible = false;
    issues.push({ type: 'forward_incompatible', fields: added });
  }

  return { success: true, compatible, issues, added, removed };
}

export function trackLineage(
  sourceContract: string,
  targetContract: string,
  options: LineageOptions = {}
): LineageResult {
  if (!sourceContract || !targetContract) {
    return { success: false, error: 'source and target contracts are required' };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const entry: LineageEntry = {
    source: sourceContract,
    target: targetContract,
    transformation: options.transformation || 'direct',
    created_at: new Date().toISOString(),
  };

  state.lineage.push(entry);
  saveState(state, stateFile);

  return { success: true, lineage: entry };
}

export function generateReport(options: ReportOptions = {}): ReportResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    total_contracts: state.contracts.length,
    total_lineage: state.lineage.length,
    contracts: state.contracts.map((c) => ({
      id: c.id,
      name: c.name,
      version: c.version,
      compatibility: c.compatibility,
    })),
    lineage: state.lineage,
  };
}
