/**
 * transcript-ingestion.js — Meeting Transcript Ingestion (Item 74)
 *
 * Convert notes and transcripts into artifact updates,
 * decision proposals, and action items.
 *
 * Usage:
 *   node bin/lib/transcript-ingestion.js ingest|extract|list [options]
 *
 * State file: .jumpstart/state/transcripts.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'transcripts.json');

const ACTION_PATTERNS = [
  /\baction(?:\s+item)?:\s*(.+)/gi,
  /\bTODO:\s*(.+)/gi,
  /\b(?:will|should|needs? to)\s+(.+?)(?:\.|$)/gi
];

const DECISION_PATTERNS = [
  /\bdecided?\s+(?:to\s+)?(.+?)(?:\.|$)/gi,
  /\bdecision:\s*(.+)/gi,
  /\bagreed\s+(?:to\s+)?(.+?)(?:\.|$)/gi
];

function defaultState() {
  return { version: '1.0.0', transcripts: [], last_updated: null };
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
 * Ingest a transcript text.
 */
function ingestTranscript(text, options = {}) {
  if (!text) return { success: false, error: 'Transcript text is required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const transcript = {
    id: `TR-${Date.now()}`,
    title: options.title || 'Untitled Meeting',
    source: options.source || 'manual',
    text_length: text.length,
    ingested_at: new Date().toISOString(),
    actions: [],
    decisions: [],
    key_topics: []
  };

  // Extract action items
  for (const pattern of ACTION_PATTERNS) {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(text)) !== null) {
      transcript.actions.push({ text: match[1].trim(), source_pattern: pattern.source.substring(0, 30) });
    }
  }

  // Extract decisions
  for (const pattern of DECISION_PATTERNS) {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(text)) !== null) {
      transcript.decisions.push({ text: match[1].trim() });
    }
  }

  // Extract key topics (headings or emphasized text)
  const headings = text.match(/^#+\s+(.+)$/gm);
  if (headings) {
    transcript.key_topics = headings.map(h => h.replace(/^#+\s+/, '').trim());
  }

  state.transcripts.push(transcript);
  saveState(state, stateFile);

  return { success: true, transcript };
}

/**
 * Extract structured data from a transcript.
 */
function extractFromTranscript(transcriptId, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const transcript = state.transcripts.find(t => t.id === transcriptId);
  if (!transcript) return { success: false, error: `Transcript ${transcriptId} not found` };

  return {
    success: true,
    id: transcript.id,
    title: transcript.title,
    actions: transcript.actions,
    decisions: transcript.decisions,
    key_topics: transcript.key_topics,
    summary: {
      action_count: transcript.actions.length,
      decision_count: transcript.decisions.length,
      topic_count: transcript.key_topics.length
    }
  };
}

/**
 * List ingested transcripts.
 */
function listTranscripts(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    total: state.transcripts.length,
    transcripts: state.transcripts.map(t => ({
      id: t.id,
      title: t.title,
      actions: t.actions.length,
      decisions: t.decisions.length,
      ingested_at: t.ingested_at
    }))
  };
}

module.exports = {
  ingestTranscript, extractFromTranscript, listTranscripts,
  loadState, saveState, defaultState,
  ACTION_PATTERNS, DECISION_PATTERNS
};
