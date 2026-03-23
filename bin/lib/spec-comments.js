/**
 * spec-comments.js — Inline Spec Review Comments (Item 63)
 *
 * Comment, resolve, assign, and approve within artifact sections.
 *
 * Usage:
 *   node bin/lib/spec-comments.js add|resolve|list|assign [options]
 *
 * State file: .jumpstart/state/spec-comments.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'spec-comments.json');

const COMMENT_STATUSES = ['open', 'resolved', 'wontfix', 'deferred'];

function defaultState() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    comments: []
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
 * Add a review comment to a spec artifact.
 */
function addComment(artifact, section, text, options = {}) {
  if (!artifact || !text) return { success: false, error: 'artifact and text are required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const comment = {
    id: `C-${Date.now()}`,
    artifact,
    section: section || null,
    text,
    author: options.author || 'anonymous',
    assignee: options.assignee || null,
    status: 'open',
    created_at: new Date().toISOString(),
    resolved_at: null,
    replies: []
  };

  state.comments.push(comment);
  saveState(state, stateFile);

  return { success: true, comment };
}

/**
 * Resolve a comment.
 */
function resolveComment(commentId, resolution, options = {}) {
  if (!commentId) return { success: false, error: 'commentId is required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const comment = state.comments.find(c => c.id === commentId);
  if (!comment) return { success: false, error: `Comment ${commentId} not found` };

  comment.status = 'resolved';
  comment.resolution = resolution || 'Resolved';
  comment.resolved_at = new Date().toISOString();
  comment.resolved_by = options.author || 'anonymous';
  saveState(state, stateFile);

  return { success: true, comment };
}

/**
 * List comments, optionally filtered.
 */
function listComments(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  let comments = state.comments;

  if (options.artifact) {
    comments = comments.filter(c => c.artifact === options.artifact);
  }
  if (options.status) {
    comments = comments.filter(c => c.status === options.status);
  }
  if (options.assignee) {
    comments = comments.filter(c => c.assignee === options.assignee);
  }

  return {
    success: true,
    total: comments.length,
    comments
  };
}

/**
 * Assign a comment to a reviewer.
 */
function assignComment(commentId, assignee, options = {}) {
  if (!commentId || !assignee) return { success: false, error: 'commentId and assignee are required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const comment = state.comments.find(c => c.id === commentId);
  if (!comment) return { success: false, error: `Comment ${commentId} not found` };

  comment.assignee = assignee;
  saveState(state, stateFile);

  return { success: true, comment };
}

module.exports = {
  addComment,
  resolveComment,
  listComments,
  assignComment,
  loadState,
  saveState,
  defaultState,
  COMMENT_STATUSES
};
