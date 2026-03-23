/**
 * event-modeling.js — Event-Driven Architecture Modeling (Item 85)
 *
 * Topics, events, idempotency, retries, DLQs, sagas,
 * and observability patterns.
 *
 * Usage:
 *   node bin/lib/event-modeling.js define|validate|report [options]
 *
 * State file: .jumpstart/state/event-modeling.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'event-modeling.json');

const EVENT_TYPES = ['domain-event', 'integration-event', 'command', 'query'];
const PATTERNS = ['saga', 'choreography', 'orchestration', 'cqrs', 'event-sourcing'];

function defaultState() {
  return { version: '1.0.0', topics: [], events: [], sagas: [], last_updated: null };
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

function defineTopic(name, options = {}) {
  if (!name) return { success: false, error: 'Topic name is required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const topic = {
    id: `TOPIC-${Date.now()}`,
    name,
    partitions: options.partitions || 1,
    retention: options.retention || '7d',
    dlq: options.dlq || false,
    created_at: new Date().toISOString()
  };

  state.topics.push(topic);
  saveState(state, stateFile);

  return { success: true, topic };
}

function defineEvent(name, topicId, options = {}) {
  if (!name || !topicId) return { success: false, error: 'name and topicId are required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const event = {
    id: `EVT-${Date.now()}`,
    name,
    topic: topicId,
    type: options.type || 'domain-event',
    schema: options.schema || {},
    idempotency_key: options.idempotency_key || null,
    retry_policy: options.retry_policy || { max_retries: 3, backoff: 'exponential' },
    created_at: new Date().toISOString()
  };

  if (!EVENT_TYPES.includes(event.type)) {
    return { success: false, error: `Unknown type: ${event.type}. Valid: ${EVENT_TYPES.join(', ')}` };
  }

  state.events.push(event);
  saveState(state, stateFile);

  return { success: true, event };
}

function defineSaga(name, steps, options = {}) {
  if (!name || !steps || !Array.isArray(steps)) {
    return { success: false, error: 'name and steps array are required' };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const saga = {
    id: `SAGA-${Date.now()}`,
    name,
    steps: steps.map((s, i) => ({ order: i + 1, ...s })),
    compensation: options.compensation || 'manual',
    created_at: new Date().toISOString()
  };

  state.sagas.push(saga);
  saveState(state, stateFile);

  return { success: true, saga };
}

function generateReport(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    total_topics: state.topics.length,
    total_events: state.events.length,
    total_sagas: state.sagas.length,
    topics_with_dlq: state.topics.filter(t => t.dlq).length,
    events_by_type: state.events.reduce((acc, e) => { acc[e.type] = (acc[e.type] || 0) + 1; return acc; }, {}),
    topics: state.topics,
    events: state.events,
    sagas: state.sagas
  };
}

module.exports = {
  defineTopic, defineEvent, defineSaga, generateReport,
  loadState, saveState, defaultState,
  EVENT_TYPES, PATTERNS
};
