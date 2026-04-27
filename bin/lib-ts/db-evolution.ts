/**
 * db-evolution.ts — Database Evolution Planner port (T4.4.3, cluster L).
 *
 * Pure-library port of `bin/lib/db-evolution.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `MIGRATION_TYPES` (constant array)
 *   - `RISK_LEVELS` (constant map)
 *   - `defaultState()` / `loadState()` / `saveState()`
 *   - `planMigration(migration, options?)` => PlanResult
 *   - `validateMigration(migrationId, options?)` => ValidateResult
 *   - `generateReport(options?)` => ReportResult
 *
 * Behavior parity:
 *   - Default state path: `.jumpstart/state/db-evolution.json`.
 *   - Default validation steps: ['row-count', 'schema-compare'].
 *   - Default rollback strategy: 'reverse-migration' (low risk) or 'backup-restore'.
 *   - JSON parse failures load defaults silently.
 *   - JSON shape validation rejects `__proto__` / `constructor` / `prototype`.
 *
 * @see bin/lib/db-evolution.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.3
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type MigrationType =
  | 'add-column'
  | 'drop-column'
  | 'rename-column'
  | 'add-table'
  | 'drop-table'
  | 'add-index'
  | 'drop-index'
  | 'modify-type'
  | 'add-constraint'
  | 'data-migration';

export interface MigrationInput {
  name: string;
  type: string;
  description?: string;
  table?: string;
  column?: string;
  backward_compatible?: boolean;
  rollback_strategy?: string;
  validation_steps?: string[];
}

export interface Migration {
  id: string;
  name: string;
  type: string;
  description: string;
  table: string | null;
  column: string | null;
  risk_level: string;
  backward_compatible: boolean;
  rollback_strategy: string;
  validation_steps: string[];
  status: string;
  created_at: string;
}

export interface DbEvolutionState {
  version: string;
  created_at: string;
  last_updated: string | null;
  migrations: Migration[];
  rollback_scripts: unknown[];
}

export interface StateOptions {
  stateFile?: string;
}

export interface PlanResult {
  success: boolean;
  migration?: Migration;
  error?: string;
}

export interface ValidateResult {
  success: boolean;
  migration_id?: string;
  safe?: boolean;
  warnings?: string[];
  risk_level?: string;
  backward_compatible?: boolean;
  error?: string;
}

export interface ReportResult {
  success: boolean;
  total_migrations: number;
  by_type: Record<string, number>;
  by_risk: Record<string, number>;
  high_risk: Migration[];
  migrations: Migration[];
}

const DEFAULT_STATE_FILE = join('.jumpstart', 'state', 'db-evolution.json');

export const MIGRATION_TYPES: MigrationType[] = [
  'add-column',
  'drop-column',
  'rename-column',
  'add-table',
  'drop-table',
  'add-index',
  'drop-index',
  'modify-type',
  'add-constraint',
  'data-migration',
];

export const RISK_LEVELS: Record<MigrationType, string> = {
  'add-column': 'low',
  'add-table': 'low',
  'add-index': 'low',
  'rename-column': 'medium',
  'modify-type': 'medium',
  'add-constraint': 'medium',
  'drop-column': 'high',
  'drop-table': 'high',
  'drop-index': 'medium',
  'data-migration': 'high',
};

export function defaultState(): DbEvolutionState {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    migrations: [],
    rollback_scripts: [],
  };
}

function _safeParseState(content: string): DbEvolutionState | null {
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
    migrations: Array.isArray(obj.migrations) ? (obj.migrations as Migration[]) : [],
    rollback_scripts: Array.isArray(obj.rollback_scripts) ? obj.rollback_scripts : [],
  };
}

export function loadState(stateFile?: string): DbEvolutionState {
  const fp = stateFile || DEFAULT_STATE_FILE;
  if (!existsSync(fp)) return defaultState();
  const parsed = _safeParseState(readFileSync(fp, 'utf8'));
  return parsed || defaultState();
}

export function saveState(state: DbEvolutionState, stateFile?: string): void {
  const fp = stateFile || DEFAULT_STATE_FILE;
  const dir = dirname(fp);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  writeFileSync(fp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/**
 * Plan a database migration.
 */
export function planMigration(migration: MigrationInput, options: StateOptions = {}): PlanResult {
  if (!migration?.name || !migration.type) {
    return { success: false, error: 'name and type are required' };
  }

  if (!MIGRATION_TYPES.includes(migration.type as MigrationType)) {
    return { success: false, error: `Invalid type. Must be one of: ${MIGRATION_TYPES.join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const risk = RISK_LEVELS[migration.type as MigrationType] || 'medium';

  const mig: Migration = {
    id: `DB-${(state.migrations.length + 1).toString().padStart(3, '0')}`,
    name: migration.name,
    type: migration.type,
    description: migration.description || '',
    table: migration.table || null,
    column: migration.column || null,
    risk_level: risk,
    backward_compatible: migration.backward_compatible !== false,
    rollback_strategy:
      migration.rollback_strategy || (risk === 'low' ? 'reverse-migration' : 'backup-restore'),
    validation_steps: migration.validation_steps || ['row-count', 'schema-compare'],
    status: 'planned',
    created_at: new Date().toISOString(),
  };

  state.migrations.push(mig);
  saveState(state, stateFile);

  return { success: true, migration: mig };
}

/**
 * Validate migration plan for safety.
 */
export function validateMigration(migrationId: string, options: StateOptions = {}): ValidateResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const mig = state.migrations.find((m) => m.id === migrationId);
  if (!mig) return { success: false, error: `Migration not found: ${migrationId}` };

  const warnings: string[] = [];
  if (!mig.backward_compatible) warnings.push('Migration is not backward compatible');
  if (mig.risk_level === 'high') warnings.push('High-risk migration — requires explicit approval');
  if (!mig.rollback_strategy) warnings.push('No rollback strategy defined');
  if (mig.type === 'drop-table' || mig.type === 'drop-column') {
    warnings.push('Destructive operation — ensure data backup exists');
  }

  return {
    success: true,
    migration_id: migrationId,
    safe: warnings.length === 0,
    warnings,
    risk_level: mig.risk_level,
    backward_compatible: mig.backward_compatible,
  };
}

/**
 * Generate DB evolution report.
 */
export function generateReport(options: StateOptions = {}): ReportResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    total_migrations: state.migrations.length,
    by_type: state.migrations.reduce<Record<string, number>>((acc, m) => {
      acc[m.type] = (acc[m.type] || 0) + 1;
      return acc;
    }, {}),
    by_risk: state.migrations.reduce<Record<string, number>>((acc, m) => {
      acc[m.risk_level] = (acc[m.risk_level] || 0) + 1;
      return acc;
    }, {}),
    high_risk: state.migrations.filter((m) => m.risk_level === 'high'),
    migrations: state.migrations,
  };
}
