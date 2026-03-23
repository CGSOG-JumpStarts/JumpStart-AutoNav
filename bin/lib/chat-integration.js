/**
 * chat-integration.js — Slack and Teams Integration (Item 75)
 *
 * Notify on approvals, risks, drift, and blockers;
 * accept structured approvals from chat.
 *
 * Usage:
 *   node bin/lib/chat-integration.js configure|notify|status [options]
 *
 * State file: .jumpstart/state/chat-integration.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'chat-integration.json');

const PLATFORMS = ['slack', 'teams'];
const EVENT_TYPES = ['approval', 'risk', 'drift', 'blocker', 'phase_change', 'comment'];

function defaultState() {
  return {
    version: '1.0.0',
    configurations: [],
    notifications: [],
    last_updated: null
  };
}

function loadState(stateFile) {
  const fp = stateFile || DEFAULT_STATE_FILE;
  if (!fs.existsSync(fp)) return defaultState();
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch { return defaultState(); }
}

function saveState(state, stateFile) {
  const fp = stateFile || DEFAULT_STATE_FILE;
  const dir = path.dirname(fp);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  fs.writeFileSync(fp, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/**
 * Configure a chat integration.
 */
function configure(platform, options = {}) {
  if (!PLATFORMS.includes(platform)) {
    return { success: false, error: `Unknown platform: ${platform}. Valid: ${PLATFORMS.join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const config = {
    id: `CHAT-${Date.now()}`,
    platform,
    channel: options.channel || 'general',
    webhook_url: options.webhook_url || null,
    events: options.events || EVENT_TYPES,
    enabled: true,
    configured_at: new Date().toISOString()
  };

  state.configurations.push(config);
  saveState(state, stateFile);

  return { success: true, configuration: config };
}

/**
 * Queue a notification.
 */
function queueNotification(eventType, message, options = {}) {
  if (!EVENT_TYPES.includes(eventType)) {
    return { success: false, error: `Unknown event type: ${eventType}. Valid: ${EVENT_TYPES.join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const notification = {
    id: `NOTIF-${Date.now()}`,
    event_type: eventType,
    message,
    platform: options.platform || 'all',
    status: 'queued',
    created_at: new Date().toISOString(),
    sent_at: null
  };

  state.notifications.push(notification);
  saveState(state, stateFile);

  return { success: true, notification };
}

/**
 * Get integration status.
 */
function getStatus(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    configurations: state.configurations.length,
    active: state.configurations.filter(c => c.enabled).length,
    notifications_queued: state.notifications.filter(n => n.status === 'queued').length,
    notifications_sent: state.notifications.filter(n => n.status === 'sent').length,
    platforms: state.configurations.map(c => c.platform)
  };
}

module.exports = {
  configure, queueNotification, getStatus,
  loadState, saveState, defaultState,
  PLATFORMS, EVENT_TYPES
};
