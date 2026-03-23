/**
 * vendor-risk.js — Vendor & Dependency Risk Scoring (Item 36)
 *
 * Evaluate OSS and SaaS dependencies for maintenance health,
 * license risk, and supply chain concerns.
 *
 * Usage:
 *   node bin/lib/vendor-risk.js scan|assess|report [options]
 *
 * State file: .jumpstart/state/vendor-risk.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'vendor-risk.json');

const RISK_FACTORS = ['maintenance', 'license', 'security', 'popularity', 'supply-chain'];

const LICENSE_RISK = {
  'MIT': 'low', 'ISC': 'low', 'BSD-2-Clause': 'low', 'BSD-3-Clause': 'low', 'Apache-2.0': 'low',
  'LGPL-2.1': 'medium', 'LGPL-3.0': 'medium', 'MPL-2.0': 'medium',
  'GPL-2.0': 'high', 'GPL-3.0': 'high', 'AGPL-3.0': 'high',
  'SSPL-1.0': 'critical', 'BSL-1.1': 'high', 'UNLICENSED': 'critical', 'unknown': 'high'
};

function defaultState() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    assessments: [],
    vendor_catalog: []
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
 * Scan project dependencies.
 *
 * @param {string} root - Project root.
 * @param {object} [options]
 * @returns {object}
 */
function scanDependencies(root, options = {}) {
  const packageFile = path.join(root, 'package.json');
  const dependencies = [];

  if (fs.existsSync(packageFile)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
      const deps = { ...pkg.dependencies };
      const devDeps = options.includeDevDeps ? pkg.devDependencies || {} : {};

      for (const [name, version] of Object.entries(deps)) {
        dependencies.push({ name, version, type: 'production', ecosystem: 'npm' });
      }
      for (const [name, version] of Object.entries(devDeps)) {
        dependencies.push({ name, version, type: 'development', ecosystem: 'npm' });
      }
    } catch { /* ignore */ }
  }

  return { success: true, dependencies, total: dependencies.length };
}

/**
 * Assess risk for a dependency.
 *
 * @param {object} dep - { name, version, license?, last_publish?, weekly_downloads? }
 * @param {object} [options]
 * @returns {object}
 */
function assessDependency(dep, options = {}) {
  if (!dep || !dep.name) return { success: false, error: 'dep.name is required' };

  const scores = {};

  // License risk
  const license = dep.license || 'unknown';
  const licenseRisk = LICENSE_RISK[license] || 'high';
  scores.license = licenseRisk === 'low' ? 90 : licenseRisk === 'medium' ? 60 : licenseRisk === 'high' ? 30 : 10;

  // Maintenance (based on last publish date if available)
  if (dep.last_publish) {
    const daysSince = Math.floor((Date.now() - new Date(dep.last_publish).getTime()) / (1000 * 60 * 60 * 24));
    scores.maintenance = daysSince < 90 ? 90 : daysSince < 365 ? 60 : daysSince < 730 ? 30 : 10;
  } else {
    scores.maintenance = 50; // unknown
  }

  // Popularity
  const downloads = dep.weekly_downloads || 0;
  scores.popularity = downloads > 1000000 ? 90 : downloads > 100000 ? 70 : downloads > 10000 ? 50 : 30;

  // Security (default: no known issues)
  scores.security = dep.known_vulnerabilities ? 20 : 80;

  // Supply chain
  scores['supply-chain'] = dep.has_lockfile ? 80 : 50;

  const overall = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / Object.keys(scores).length);

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const assessment = {
    name: dep.name,
    version: dep.version,
    license,
    scores,
    overall,
    risk_level: overall >= 70 ? 'low' : overall >= 50 ? 'medium' : overall >= 30 ? 'high' : 'critical',
    assessed_at: new Date().toISOString()
  };

  state.assessments.push(assessment);
  saveState(state, stateFile);

  return { success: true, assessment };
}

/**
 * Generate vendor risk report.
 *
 * @param {object} [options]
 * @returns {object}
 */
function generateReport(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const byRisk = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const a of state.assessments) byRisk[a.risk_level]++;

  return {
    success: true,
    total_assessed: state.assessments.length,
    by_risk: byRisk,
    high_risk: state.assessments.filter(a => a.risk_level === 'high' || a.risk_level === 'critical'),
    average_score: state.assessments.length > 0
      ? Math.round(state.assessments.reduce((s, a) => s + a.overall, 0) / state.assessments.length)
      : 0,
    assessments: state.assessments
  };
}

module.exports = {
  defaultState,
  loadState,
  saveState,
  scanDependencies,
  assessDependency,
  generateReport,
  RISK_FACTORS,
  LICENSE_RISK
};
