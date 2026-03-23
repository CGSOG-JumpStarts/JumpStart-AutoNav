/**
 * db-evolution.js — Database Evolution Planner (Item 49)
 *
 * Generate migration strategy, backward compatibility plan,
 * data validation, and rollback approach.
 *
 * Usage:
 *   node bin/lib/db-evolution.js plan|validate|report [options]
 *
 * State file: .jumpstart/state/db-evolution.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'db-evolution.json');

const MIGRATION_TYPES = ['add-column', 'drop-column', 'rename-column', 'add-table', 'drop-table',
  'add-index', 'drop-index', 'modify-type', 'add-constraint', 'data-migration'];

const RISK_LEVELS = {
  'add-column': 'low', 'add-table': 'low', 'add-index': 'low',
  'rename-column': 'medium', 'modify-type': 'medium', 'add-constraint': 'medium',
  'drop-column': 'high', 'drop-table': 'high', 'drop-index': 'medium',
  'data-migration': 'high'
};

function defaultState() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    migrations: [],
    rollback_scripts: []
  };
}

function loadState(stateFile) {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  if (!fs.existsSync(filePath)) return defaultState();
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return defaultState(); }
}

function saveState(state, stateFile) {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/**
 * Plan a database migration.
 *
 * @param {object} migration - { name, type, description, table?, column?, backward_compatible? }
 * @param {object} [options]
 * @returns {object}
 */
function planMigration(migration, options = {}) {
  if (!migration || !migration.name || !migration.type) {
    return { success: false, error: 'name and type are required' };
  }

  if (!MIGRATION_TYPES.includes(migration.type)) {
    return { success: false, error: `Invalid type. Must be one of: ${MIGRATION_TYPES.join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const risk = RISK_LEVELS[migration.type] || 'medium';

  const mig = {
    id: `DB-${(state.migrations.length + 1).toString().padStart(3, '0')}`,
    name: migration.name,
    type: migration.type,
    description: migration.description || '',
    table: migration.table || null,
    column: migration.column || null,
    risk_level: risk,
    backward_compatible: migration.backward_compatible !== false,
    rollback_strategy: migration.rollback_strategy || (risk === 'low' ? 'reverse-migration' : 'backup-restore'),
    validation_steps: migration.validation_steps || ['row-count', 'schema-compare'],
    status: 'planned',
    created_at: new Date().toISOString()
  };

  state.migrations.push(mig);
  saveState(state, stateFile);

  return { success: true, migration: mig };
}

/**
 * Validate migration plan for safety.
 *
 * @param {string} migrationId
 * @param {object} [options]
 * @returns {object}
 */
function validateMigration(migrationId, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const mig = state.migrations.find(m => m.id === migrationId);
  if (!mig) return { success: false, error: `Migration not found: ${migrationId}` };

  const warnings = [];
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
    backward_compatible: mig.backward_compatible
  };
}

/**
 * Generate DB evolution report.
 *
 * @param {object} [options]
 * @returns {object}
 */
function generateReport(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    total_migrations: state.migrations.length,
    by_type: state.migrations.reduce((acc, m) => { acc[m.type] = (acc[m.type] || 0) + 1; return acc; }, {}),
    by_risk: state.migrations.reduce((acc, m) => { acc[m.risk_level] = (acc[m.risk_level] || 0) + 1; return acc; }, {}),
    high_risk: state.migrations.filter(m => m.risk_level === 'high'),
    migrations: state.migrations
  };
}

module.exports = {
  defaultState,
  loadState,
  saveState,
  planMigration,
  validateMigration,
  generateReport,
  MIGRATION_TYPES,
  RISK_LEVELS
};
