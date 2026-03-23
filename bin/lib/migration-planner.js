/**
 * migration-planner.js — Brownfield Migration Planner (Item 47)
 *
 * Special workflows for strangler patterns, phased cutovers,
 * compatibility layers, and rollback.
 *
 * Usage:
 *   node bin/lib/migration-planner.js plan|status|report [options]
 *
 * State file: .jumpstart/state/migration-plan.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'migration-plan.json');

const MIGRATION_STRATEGIES = ['strangler-fig', 'big-bang', 'phased-cutover', 'parallel-run', 'feature-flag'];

const MIGRATION_PHASES = ['discovery', 'planning', 'compatibility-layer', 'migration', 'validation', 'cutover', 'cleanup'];

function defaultState() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    migrations: []
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
 * Create a migration plan.
 *
 * @param {object} migration - { name, strategy, source_system, target_system, components[] }
 * @param {object} [options]
 * @returns {object}
 */
function createMigration(migration, options = {}) {
  if (!migration || !migration.name || !migration.strategy) {
    return { success: false, error: 'name and strategy are required' };
  }

  if (!MIGRATION_STRATEGIES.includes(migration.strategy)) {
    return { success: false, error: `Invalid strategy. Must be one of: ${MIGRATION_STRATEGIES.join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const plan = {
    id: `MIG-${(state.migrations.length + 1).toString().padStart(3, '0')}`,
    name: migration.name,
    strategy: migration.strategy,
    source_system: migration.source_system || null,
    target_system: migration.target_system || null,
    current_phase: 'discovery',
    components: (migration.components || []).map(c => ({
      name: c.name || c,
      status: 'pending',
      migrated_at: null
    })),
    rollback_plan: migration.rollback_plan || null,
    compatibility_requirements: migration.compatibility_requirements || [],
    created_at: new Date().toISOString()
  };

  state.migrations.push(plan);
  saveState(state, stateFile);

  return { success: true, migration: plan };
}

/**
 * Advance migration phase.
 *
 * @param {string} migrationId
 * @param {string} phase
 * @param {object} [options]
 * @returns {object}
 */
function advancePhase(migrationId, phase, options = {}) {
  if (!MIGRATION_PHASES.includes(phase)) {
    return { success: false, error: `Invalid phase. Must be one of: ${MIGRATION_PHASES.join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const migration = state.migrations.find(m => m.id === migrationId);
  if (!migration) return { success: false, error: `Migration not found: ${migrationId}` };

  migration.current_phase = phase;
  migration.phase_updated_at = new Date().toISOString();
  saveState(state, stateFile);

  return { success: true, migration_id: migrationId, phase, previous_phase: migration.current_phase };
}

/**
 * Generate migration report.
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
    by_strategy: state.migrations.reduce((acc, m) => { acc[m.strategy] = (acc[m.strategy] || 0) + 1; return acc; }, {}),
    by_phase: state.migrations.reduce((acc, m) => { acc[m.current_phase] = (acc[m.current_phase] || 0) + 1; return acc; }, {}),
    migrations: state.migrations
  };
}

module.exports = {
  defaultState,
  loadState,
  saveState,
  createMigration,
  advancePhase,
  generateReport,
  MIGRATION_STRATEGIES,
  MIGRATION_PHASES
};
