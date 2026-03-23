/**
 * requirements-baseline.js — Requirements Baseline & Change Control
 *
 * Freezes approved requirements and forces impact assessment when
 * downstream changes are proposed.
 *
 * Baseline file: .jumpstart/state/requirements-baseline.json
 *
 * Usage:
 *   node bin/lib/requirements-baseline.js freeze|check|impact|status [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_BASELINE_FILE = path.join('.jumpstart', 'state', 'requirements-baseline.json');

const ARTIFACT_TYPES = ['challenger-brief', 'product-brief', 'prd', 'architecture', 'implementation-plan'];

/**
 * Default empty baseline registry.
 * @returns {object}
 */
function defaultBaseline() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    frozen: false,
    baselines: [],
    change_requests: []
  };
}

/**
 * Load baseline from disk.
 * @param {string} [baselineFile]
 * @returns {object}
 */
function loadBaseline(baselineFile) {
  const filePath = baselineFile || DEFAULT_BASELINE_FILE;
  if (!fs.existsSync(filePath)) {
    return defaultBaseline();
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return defaultBaseline();
  }
}

/**
 * Save baseline to disk.
 * @param {object} baseline
 * @param {string} [baselineFile]
 */
function saveBaseline(baseline, baselineFile) {
  const filePath = baselineFile || DEFAULT_BASELINE_FILE;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  baseline.last_updated = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(baseline, null, 2) + '\n', 'utf8');
}

/**
 * Compute SHA-256 hash of content.
 * @param {string} content
 * @returns {string}
 */
function hashContent(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Extract requirement IDs from content.
 * Matches patterns like REQ-001, E01-S01, NFR-001, UC-001, etc.
 * @param {string} content
 * @returns {string[]}
 */
function extractRequirementIds(content) {
  const patterns = [
    /\b(REQ-\d+)\b/g,
    /\b(E\d+-S\d+)\b/g,
    /\b(NFR-\d+)\b/g,
    /\b(UC-\d+)\b/g,
    /\b(FR-\d+)\b/g,
    /\b(AC-\d+)\b/g
  ];
  const ids = new Set();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      ids.add(match[1]);
    }
  }
  return [...ids].sort();
}

/**
 * Freeze current requirements as baseline.
 *
 * @param {string} root - Project root.
 * @param {object} [options]
 * @returns {object}
 */
function freezeBaseline(root, options = {}) {
  const baselineFile = options.baselineFile || path.join(root, DEFAULT_BASELINE_FILE);
  const baseline = loadBaseline(baselineFile);

  const specsDir = path.join(root, 'specs');
  if (!fs.existsSync(specsDir)) {
    return { success: false, error: 'specs/ directory not found' };
  }

  const snapshots = [];
  const artifactMap = {
    'challenger-brief': 'specs/challenger-brief.md',
    'product-brief': 'specs/product-brief.md',
    'prd': 'specs/prd.md',
    'architecture': 'specs/architecture.md',
    'implementation-plan': 'specs/implementation-plan.md'
  };

  for (const [type, relPath] of Object.entries(artifactMap)) {
    const fullPath = path.join(root, relPath);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      snapshots.push({
        type,
        path: relPath,
        hash: hashContent(content),
        requirement_ids: extractRequirementIds(content),
        frozen_at: new Date().toISOString()
      });
    }
  }

  if (snapshots.length === 0) {
    return { success: false, error: 'No spec artifacts found to freeze' };
  }

  const baselineEntry = {
    id: `baseline-${Date.now()}`,
    frozen_at: new Date().toISOString(),
    frozen_by: options.approver || 'system',
    snapshots,
    total_requirements: snapshots.reduce((sum, s) => sum + s.requirement_ids.length, 0)
  };

  baseline.baselines.push(baselineEntry);
  baseline.frozen = true;
  saveBaseline(baseline, baselineFile);

  return {
    success: true,
    baseline_id: baselineEntry.id,
    artifacts_frozen: snapshots.length,
    total_requirements: baselineEntry.total_requirements,
    snapshots: snapshots.map(s => ({ type: s.type, path: s.path, requirements: s.requirement_ids.length }))
  };
}

/**
 * Check if any frozen artifacts have changed since the baseline.
 *
 * @param {string} root - Project root.
 * @param {object} [options]
 * @returns {object}
 */
function checkBaseline(root, options = {}) {
  const baselineFile = options.baselineFile || path.join(root, DEFAULT_BASELINE_FILE);
  const baseline = loadBaseline(baselineFile);

  if (!baseline.frozen || baseline.baselines.length === 0) {
    return { success: true, frozen: false, message: 'No frozen baseline found' };
  }

  const latestBaseline = baseline.baselines[baseline.baselines.length - 1];
  const changes = [];
  const unchanged = [];

  for (const snapshot of latestBaseline.snapshots) {
    const fullPath = path.join(root, snapshot.path);
    if (!fs.existsSync(fullPath)) {
      changes.push({
        type: snapshot.type,
        path: snapshot.path,
        change: 'deleted',
        severity: 'critical'
      });
      continue;
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    const currentHash = hashContent(content);

    if (currentHash !== snapshot.hash) {
      const currentIds = extractRequirementIds(content);
      const addedIds = currentIds.filter(id => !snapshot.requirement_ids.includes(id));
      const removedIds = snapshot.requirement_ids.filter(id => !currentIds.includes(id));

      changes.push({
        type: snapshot.type,
        path: snapshot.path,
        change: 'modified',
        severity: removedIds.length > 0 ? 'critical' : addedIds.length > 0 ? 'warning' : 'info',
        added_requirements: addedIds,
        removed_requirements: removedIds
      });
    } else {
      unchanged.push({ type: snapshot.type, path: snapshot.path });
    }
  }

  const drifted = changes.length > 0;
  return {
    success: true,
    frozen: true,
    baseline_id: latestBaseline.id,
    frozen_at: latestBaseline.frozen_at,
    drifted,
    changes,
    unchanged,
    summary: {
      total_artifacts: latestBaseline.snapshots.length,
      changed: changes.length,
      unchanged: unchanged.length,
      critical: changes.filter(c => c.severity === 'critical').length
    }
  };
}

/**
 * Perform impact assessment for a proposed change.
 *
 * @param {string} artifactPath - Path to the changed artifact.
 * @param {string} root - Project root.
 * @param {object} [options]
 * @returns {object}
 */
function assessImpact(artifactPath, root, options = {}) {
  const baselineFile = options.baselineFile || path.join(root, DEFAULT_BASELINE_FILE);
  const baseline = loadBaseline(baselineFile);

  if (!baseline.frozen || baseline.baselines.length === 0) {
    return { success: true, impact: 'none', message: 'No frozen baseline — changes are unconstrained' };
  }

  const relPath = path.relative(root, path.resolve(root, artifactPath)).replace(/\\/g, '/');
  const latestBaseline = baseline.baselines[baseline.baselines.length - 1];
  const snapshot = latestBaseline.snapshots.find(s => s.path === relPath);

  if (!snapshot) {
    return { success: true, impact: 'none', message: `${relPath} is not part of the frozen baseline` };
  }

  const fullPath = path.join(root, relPath);
  if (!fs.existsSync(fullPath)) {
    return {
      success: true,
      impact: 'critical',
      artifact: relPath,
      assessment: {
        change_type: 'deletion',
        affected_requirements: snapshot.requirement_ids,
        downstream_artifacts: ARTIFACT_TYPES.filter(t => t !== snapshot.type)
      }
    };
  }

  const content = fs.readFileSync(fullPath, 'utf8');
  const currentHash = hashContent(content);

  if (currentHash === snapshot.hash) {
    return { success: true, impact: 'none', message: 'Artifact matches frozen baseline' };
  }

  const currentIds = extractRequirementIds(content);
  const addedIds = currentIds.filter(id => !snapshot.requirement_ids.includes(id));
  const removedIds = snapshot.requirement_ids.filter(id => !currentIds.includes(id));
  const unchangedIds = currentIds.filter(id => snapshot.requirement_ids.includes(id));

  const typeIndex = ARTIFACT_TYPES.indexOf(snapshot.type);
  const downstreamTypes = ARTIFACT_TYPES.slice(typeIndex + 1);

  const impactLevel = removedIds.length > 0 ? 'critical'
    : addedIds.length > 3 ? 'high'
    : addedIds.length > 0 ? 'medium'
    : 'low';

  const changeRequest = {
    id: `cr-${Date.now()}`,
    artifact: relPath,
    artifact_type: snapshot.type,
    requested_at: new Date().toISOString(),
    impact_level: impactLevel,
    added_requirements: addedIds,
    removed_requirements: removedIds,
    downstream_artifacts: downstreamTypes,
    status: 'pending_review'
  };

  baseline.change_requests.push(changeRequest);
  saveBaseline(baseline, baselineFile);

  return {
    success: true,
    impact: impactLevel,
    change_request_id: changeRequest.id,
    artifact: relPath,
    assessment: {
      change_type: removedIds.length > 0 ? 'breaking' : 'additive',
      added_requirements: addedIds,
      removed_requirements: removedIds,
      unchanged_requirements: unchangedIds.length,
      downstream_artifacts: downstreamTypes,
      requires_re_approval: impactLevel === 'critical' || impactLevel === 'high'
    }
  };
}

/**
 * Get baseline status.
 *
 * @param {object} [options]
 * @returns {object}
 */
function getBaselineStatus(options = {}) {
  const baselineFile = options.baselineFile || DEFAULT_BASELINE_FILE;
  const baseline = loadBaseline(baselineFile);

  return {
    success: true,
    frozen: baseline.frozen,
    total_baselines: baseline.baselines.length,
    total_change_requests: baseline.change_requests.length,
    pending_change_requests: baseline.change_requests.filter(cr => cr.status === 'pending_review').length,
    latest_baseline: baseline.baselines.length > 0 ? baseline.baselines[baseline.baselines.length - 1] : null
  };
}

module.exports = {
  defaultBaseline,
  loadBaseline,
  saveBaseline,
  hashContent,
  extractRequirementIds,
  freezeBaseline,
  checkBaseline,
  assessImpact,
  getBaselineStatus,
  ARTIFACT_TYPES
};
