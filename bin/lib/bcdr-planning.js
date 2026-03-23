/**
 * bcdr-planning.js — Business Continuity & DR Planning (Item 38)
 *
 * Add RTO/RPO, failover design, backup validation, and continuity
 * considerations into specs.
 *
 * Usage:
 *   node bin/lib/bcdr-planning.js define|check|report [options]
 *
 * State file: .jumpstart/state/bcdr.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'bcdr.json');

const SERVICE_TIERS = {
  platinum: { rto_hours: 0.25, rpo_hours: 0, failover: 'automatic', backup_frequency: 'continuous' },
  gold: { rto_hours: 1, rpo_hours: 1, failover: 'automatic', backup_frequency: 'hourly' },
  silver: { rto_hours: 4, rpo_hours: 4, failover: 'manual', backup_frequency: 'daily' },
  bronze: { rto_hours: 24, rpo_hours: 24, failover: 'manual', backup_frequency: 'weekly' }
};

const BCDR_COMPONENTS = ['rto-rpo', 'failover-design', 'backup-validation', 'communication-plan', 'recovery-procedures', 'testing-schedule'];

function defaultState() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    services: [],
    dr_tests: []
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
 * Define BC/DR requirements for a service.
 *
 * @param {object} service - { name, tier, rto_hours?, rpo_hours?, dependencies[]? }
 * @param {object} [options]
 * @returns {object}
 */
function defineService(service, options = {}) {
  if (!service || !service.name) return { success: false, error: 'service.name is required' };

  const tier = (service.tier || 'silver').toLowerCase();
  const template = SERVICE_TIERS[tier];
  if (!template) {
    return { success: false, error: `Invalid tier. Must be one of: ${Object.keys(SERVICE_TIERS).join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const svc = {
    id: `SVC-${(state.services.length + 1).toString().padStart(3, '0')}`,
    name: service.name,
    tier,
    rto_hours: service.rto_hours || template.rto_hours,
    rpo_hours: service.rpo_hours || template.rpo_hours,
    failover: service.failover || template.failover,
    backup_frequency: service.backup_frequency || template.backup_frequency,
    dependencies: service.dependencies || [],
    recovery_procedures: service.recovery_procedures || [],
    defined_at: new Date().toISOString()
  };

  state.services.push(svc);
  saveState(state, stateFile);

  return { success: true, service: svc };
}

/**
 * Check BC/DR coverage in specs.
 *
 * @param {string} root
 * @param {object} [options]
 * @returns {object}
 */
function checkCoverage(root, options = {}) {
  const archFile = path.join(root, 'specs', 'architecture.md');
  const findings = {};

  if (fs.existsSync(archFile)) {
    try {
      const content = fs.readFileSync(archFile, 'utf8');
      findings['rto-rpo'] = /\bRTO\b|\bRPO\b|recovery.time|recovery.point/i.test(content);
      findings['failover-design'] = /\bfailover\b|high.availability|redundan/i.test(content);
      findings['backup-validation'] = /\bbackup\b|snapshot|restore/i.test(content);
      findings['recovery-procedures'] = /\brecovery\b|disaster|DR\b/i.test(content);
    } catch { /* ignore */ }
  }

  findings['communication-plan'] = false;
  findings['testing-schedule'] = false;

  const covered = Object.values(findings).filter(Boolean).length;
  const total = BCDR_COMPONENTS.length;

  return {
    success: true,
    coverage: Math.round((covered / total) * 100),
    components: findings,
    gaps: BCDR_COMPONENTS.filter(c => !findings[c]),
    recommendations: BCDR_COMPONENTS.filter(c => !findings[c]).map(c => `Add ${c} section to architecture spec`)
  };
}

/**
 * Generate BCDR report.
 *
 * @param {object} [options]
 * @returns {object}
 */
function generateReport(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    total_services: state.services.length,
    by_tier: state.services.reduce((acc, s) => { acc[s.tier] = (acc[s.tier] || 0) + 1; return acc; }, {}),
    services: state.services,
    dr_tests: state.dr_tests,
    lowest_rto: state.services.length > 0 ? Math.min(...state.services.map(s => s.rto_hours)) : null,
    lowest_rpo: state.services.length > 0 ? Math.min(...state.services.map(s => s.rpo_hours)) : null
  };
}

module.exports = {
  defaultState,
  loadState,
  saveState,
  defineService,
  checkCoverage,
  generateReport,
  SERVICE_TIERS,
  BCDR_COMPONENTS
};
