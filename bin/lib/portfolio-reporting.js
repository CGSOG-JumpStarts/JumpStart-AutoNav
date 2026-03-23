/**
 * portfolio-reporting.js — Portfolio Reporting Layer
 *
 * Show leadership status across many JumpStart initiatives: phase,
 * risk, spend, readiness, blockers.
 *
 * Registry: .jumpstart/state/portfolio.json
 *
 * Usage:
 *   node bin/lib/portfolio-reporting.js register|status|report|remove [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_PORTFOLIO_FILE = path.join('.jumpstart', 'state', 'portfolio.json');

const PORTFOLIO_STATUSES = ['on-track', 'at-risk', 'blocked', 'completed', 'paused', 'cancelled'];

const PHASES = [
  { id: 'scout', name: 'Scout', order: -1 },
  { id: 'phase-0', name: 'Challenge', order: 0 },
  { id: 'phase-1', name: 'Analyze', order: 1 },
  { id: 'phase-2', name: 'Plan', order: 2 },
  { id: 'phase-3', name: 'Architect', order: 3 },
  { id: 'phase-4', name: 'Build', order: 4 }
];

/**
 * Default portfolio state.
 * @returns {object}
 */
function defaultPortfolio() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    initiatives: [],
    snapshots: []
  };
}

/**
 * Load portfolio from disk.
 * @param {string} [portfolioFile]
 * @returns {object}
 */
function loadPortfolio(portfolioFile) {
  const filePath = portfolioFile || DEFAULT_PORTFOLIO_FILE;
  if (!fs.existsSync(filePath)) {
    return defaultPortfolio();
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return defaultPortfolio();
  }
}

/**
 * Save portfolio to disk.
 * @param {object} portfolio
 * @param {string} [portfolioFile]
 */
function savePortfolio(portfolio, portfolioFile) {
  const filePath = portfolioFile || DEFAULT_PORTFOLIO_FILE;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  portfolio.last_updated = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(portfolio, null, 2) + '\n', 'utf8');
}

/**
 * Analyze a project directory to determine its status.
 * @param {string} projectRoot
 * @returns {object}
 */
function analyzeProject(projectRoot) {
  const result = {
    current_phase: null,
    phase_progress: 0,
    artifacts_completed: 0,
    total_artifacts: 5,
    blockers: [],
    risks: [],
    readiness: 'unknown'
  };

  const stateFile = path.join(projectRoot, '.jumpstart', 'state', 'state.json');
  if (fs.existsSync(stateFile)) {
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (state.current_phase) result.current_phase = state.current_phase;
    } catch {
      // ignore parse errors
    }
  }

  // Check which artifacts exist and are approved
  const artifactMap = {
    'specs/challenger-brief.md': 'phase-0',
    'specs/product-brief.md': 'phase-1',
    'specs/prd.md': 'phase-2',
    'specs/architecture.md': 'phase-3',
    'specs/implementation-plan.md': 'phase-3'
  };

  let completed = 0;
  let latestPhase = null;

  for (const [relPath, phase] of Object.entries(artifactMap)) {
    const fullPath = path.join(projectRoot, relPath);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const isApproved = /- \[x\]/i.test(content) && /Approved by[:\s]+(?!Pending)/i.test(content);
      if (isApproved) {
        completed++;
        latestPhase = phase;
      }

      // Check for blockers
      const blockerMatches = content.match(/\[BLOCKER[:\s]*([^\]]*)\]/gi);
      if (blockerMatches) {
        result.blockers.push(...blockerMatches.map(b => b.replace(/\[BLOCKER[:\s]*/i, '').replace(/\]/g, '')));
      }

      // Check for risks
      const clarificationMatches = content.match(/\[NEEDS CLARIFICATION[:\s]*([^\]]*)\]/gi);
      if (clarificationMatches) {
        result.risks.push(...clarificationMatches.map(c => `Unresolved: ${c.replace(/\[NEEDS CLARIFICATION[:\s]*/i, '').replace(/\]/g, '')}`));
      }
    }
  }

  result.artifacts_completed = completed;
  result.phase_progress = Math.round((completed / result.total_artifacts) * 100);

  if (!result.current_phase && latestPhase) {
    const phaseObj = PHASES.find(p => p.id === latestPhase);
    const nextPhase = PHASES.find(p => p.order === (phaseObj ? phaseObj.order + 1 : 0));
    result.current_phase = nextPhase ? nextPhase.id : latestPhase;
  }

  // Determine readiness
  if (completed >= 5) result.readiness = 'production-ready';
  else if (completed >= 3) result.readiness = 'implementation-ready';
  else if (completed >= 1) result.readiness = 'in-progress';
  else result.readiness = 'not-started';

  return result;
}

/**
 * Register a project initiative.
 *
 * @param {object} initiative - { name, path, owner?, budget?, target_date? }
 * @param {object} [options]
 * @returns {object}
 */
function registerInitiative(initiative, options = {}) {
  if (!initiative || !initiative.name) {
    return { success: false, error: 'initiative.name is required' };
  }

  const portfolioFile = options.portfolioFile || DEFAULT_PORTFOLIO_FILE;
  const portfolio = loadPortfolio(portfolioFile);

  const id = initiative.id || initiative.name.toLowerCase().replace(/\s+/g, '-');
  if (portfolio.initiatives.find(i => i.id === id)) {
    return { success: false, error: `Initiative "${id}" already exists` };
  }

  const newInitiative = {
    id,
    name: initiative.name.trim(),
    path: initiative.path || null,
    owner: initiative.owner || null,
    budget: initiative.budget || null,
    target_date: initiative.target_date || null,
    status: 'on-track',
    registered_at: new Date().toISOString(),
    last_checked: null,
    current_phase: null,
    phase_progress: 0,
    readiness: 'not-started',
    blockers: [],
    risks: [],
    spend: 0,
    notes: []
  };

  portfolio.initiatives.push(newInitiative);
  savePortfolio(portfolio, portfolioFile);

  return { success: true, initiative: newInitiative };
}

/**
 * Update initiative status from project analysis.
 *
 * @param {string} initiativeId
 * @param {object} [options]
 * @returns {object}
 */
function refreshInitiative(initiativeId, options = {}) {
  const portfolioFile = options.portfolioFile || DEFAULT_PORTFOLIO_FILE;
  const portfolio = loadPortfolio(portfolioFile);

  const initiative = portfolio.initiatives.find(i => i.id === initiativeId);
  if (!initiative) {
    return { success: false, error: `Initiative not found: ${initiativeId}` };
  }

  if (initiative.path && fs.existsSync(initiative.path)) {
    const analysis = analyzeProject(initiative.path);
    initiative.current_phase = analysis.current_phase;
    initiative.phase_progress = analysis.phase_progress;
    initiative.readiness = analysis.readiness;
    initiative.blockers = analysis.blockers;
    initiative.risks = analysis.risks;
    initiative.artifacts_completed = analysis.artifacts_completed;

    if (analysis.blockers.length > 0) {
      initiative.status = 'blocked';
    } else if (analysis.risks.length > 3) {
      initiative.status = 'at-risk';
    } else if (analysis.phase_progress >= 100) {
      initiative.status = 'completed';
    }
  }

  initiative.last_checked = new Date().toISOString();
  savePortfolio(portfolio, portfolioFile);

  return { success: true, initiative };
}

/**
 * Get portfolio status report.
 *
 * @param {object} [options]
 * @returns {object}
 */
function getPortfolioStatus(options = {}) {
  const portfolioFile = options.portfolioFile || DEFAULT_PORTFOLIO_FILE;
  const portfolio = loadPortfolio(portfolioFile);

  const statusCounts = {};
  for (const status of PORTFOLIO_STATUSES) {
    statusCounts[status] = portfolio.initiatives.filter(i => i.status === status).length;
  }

  const totalBudget = portfolio.initiatives.reduce((sum, i) => sum + (i.budget || 0), 0);
  const totalSpend = portfolio.initiatives.reduce((sum, i) => sum + (i.spend || 0), 0);

  const allBlockers = portfolio.initiatives.flatMap(i =>
    (i.blockers || []).map(b => ({ initiative: i.name, blocker: b }))
  );

  const avgProgress = portfolio.initiatives.length > 0
    ? Math.round(portfolio.initiatives.reduce((sum, i) => sum + (i.phase_progress || 0), 0) / portfolio.initiatives.length)
    : 0;

  return {
    success: true,
    total_initiatives: portfolio.initiatives.length,
    status_counts: statusCounts,
    average_progress: avgProgress,
    budget: { total: totalBudget, spent: totalSpend, remaining: totalBudget - totalSpend },
    blockers: allBlockers,
    initiatives: portfolio.initiatives.map(i => ({
      id: i.id,
      name: i.name,
      status: i.status,
      phase: i.current_phase,
      progress: i.phase_progress,
      readiness: i.readiness,
      owner: i.owner,
      blockers: (i.blockers || []).length,
      risks: (i.risks || []).length
    }))
  };
}

/**
 * Remove an initiative.
 *
 * @param {string} initiativeId
 * @param {object} [options]
 * @returns {object}
 */
function removeInitiative(initiativeId, options = {}) {
  const portfolioFile = options.portfolioFile || DEFAULT_PORTFOLIO_FILE;
  const portfolio = loadPortfolio(portfolioFile);

  const index = portfolio.initiatives.findIndex(i => i.id === initiativeId);
  if (index === -1) {
    return { success: false, error: `Initiative not found: ${initiativeId}` };
  }

  const removed = portfolio.initiatives.splice(index, 1)[0];
  savePortfolio(portfolio, portfolioFile);

  return { success: true, removed: removed.name };
}

/**
 * Take a snapshot of portfolio status for historical tracking.
 *
 * @param {object} [options]
 * @returns {object}
 */
function takeSnapshot(options = {}) {
  const portfolioFile = options.portfolioFile || DEFAULT_PORTFOLIO_FILE;
  const portfolio = loadPortfolio(portfolioFile);

  const snapshot = {
    taken_at: new Date().toISOString(),
    total_initiatives: portfolio.initiatives.length,
    status_summary: {},
    avg_progress: 0
  };

  for (const status of PORTFOLIO_STATUSES) {
    snapshot.status_summary[status] = portfolio.initiatives.filter(i => i.status === status).length;
  }

  snapshot.avg_progress = portfolio.initiatives.length > 0
    ? Math.round(portfolio.initiatives.reduce((sum, i) => sum + (i.phase_progress || 0), 0) / portfolio.initiatives.length)
    : 0;

  portfolio.snapshots.push(snapshot);
  if (portfolio.snapshots.length > 100) {
    portfolio.snapshots = portfolio.snapshots.slice(-100);
  }
  savePortfolio(portfolio, portfolioFile);

  return { success: true, snapshot };
}

module.exports = {
  defaultPortfolio,
  loadPortfolio,
  savePortfolio,
  analyzeProject,
  registerInitiative,
  refreshInitiative,
  getPortfolioStatus,
  removeInitiative,
  takeSnapshot,
  PORTFOLIO_STATUSES,
  PHASES
};
