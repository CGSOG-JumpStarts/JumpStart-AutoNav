/**
 * waiver-workflow.js — Exception & Waiver Workflow (Item 27)
 *
 * Allow formal approval of justified deviations from standards
 * with expiration and owner.
 *
 * Usage:
 *   node bin/lib/waiver-workflow.js request|approve|list|expire [options]
 *
 * State file: .jumpstart/state/waivers.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'waivers.json');

const WAIVER_STATUSES = ['pending', 'approved', 'rejected', 'expired', 'revoked'];
const WAIVER_CATEGORIES = ['security', 'architecture', 'compliance', 'performance', 'testing', 'documentation', 'other'];

function defaultState() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    waivers: []
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
 * Request a new waiver.
 *
 * @param {object} request - { title, category, justification, owner, expires_in_days? }
 * @param {object} [options]
 * @returns {object}
 */
function requestWaiver(request, options = {}) {
  if (!request || !request.title || !request.justification || !request.owner) {
    return { success: false, error: 'title, justification, and owner are required' };
  }

  const category = (request.category || 'other').toLowerCase();
  if (!WAIVER_CATEGORIES.includes(category)) {
    return { success: false, error: `Invalid category. Must be one of: ${WAIVER_CATEGORIES.join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const expiresInDays = request.expires_in_days || 90;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiresInDays);

  const waiver = {
    id: `WVR-${Date.now().toString(36).toUpperCase()}`,
    title: request.title,
    category,
    justification: request.justification,
    owner: request.owner,
    status: 'pending',
    requested_at: new Date().toISOString(),
    expires_at: expiresAt.toISOString(),
    approved_by: null,
    approved_at: null,
    conditions: request.conditions || [],
    affected_artifacts: request.affected_artifacts || []
  };

  state.waivers.push(waiver);
  saveState(state, stateFile);

  return { success: true, waiver };
}

/**
 * Approve or reject a waiver.
 *
 * @param {string} waiverId
 * @param {string} action - 'approve' or 'reject'
 * @param {object} [options]
 * @returns {object}
 */
function resolveWaiver(waiverId, action, options = {}) {
  if (!['approve', 'reject'].includes(action)) {
    return { success: false, error: 'action must be "approve" or "reject"' };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const waiver = state.waivers.find(w => w.id === waiverId);
  if (!waiver) return { success: false, error: `Waiver not found: ${waiverId}` };
  if (waiver.status !== 'pending') {
    return { success: false, error: `Waiver is already ${waiver.status}` };
  }

  waiver.status = action === 'approve' ? 'approved' : 'rejected';
  waiver.approved_by = options.approver || null;
  waiver.approved_at = new Date().toISOString();

  saveState(state, stateFile);
  return { success: true, waiver };
}

/**
 * Expire outdated waivers.
 *
 * @param {object} [options]
 * @returns {object}
 */
function expireWaivers(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);
  const now = new Date();
  let expired = 0;

  for (const waiver of state.waivers) {
    if (waiver.status === 'approved' && new Date(waiver.expires_at) < now) {
      waiver.status = 'expired';
      expired++;
    }
  }

  saveState(state, stateFile);
  return { success: true, expired, total_waivers: state.waivers.length };
}

/**
 * List waivers with optional filter.
 *
 * @param {object} [filter] - { status?, category?, owner? }
 * @param {object} [options]
 * @returns {object}
 */
function listWaivers(filter = {}, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);
  let waivers = state.waivers;

  if (filter.status) waivers = waivers.filter(w => w.status === filter.status);
  if (filter.category) waivers = waivers.filter(w => w.category === filter.category);
  if (filter.owner) waivers = waivers.filter(w => w.owner === filter.owner);

  return { success: true, waivers, total: waivers.length };
}

module.exports = {
  defaultState,
  loadState,
  saveState,
  requestWaiver,
  resolveWaiver,
  expireWaivers,
  listWaivers,
  WAIVER_STATUSES,
  WAIVER_CATEGORIES
};
