/**
 * structured-elicitation.js — Facilitated Q&A with Structured Elicitation (Item 66)
 *
 * Adaptive questioning based on domain, compliance, and delivery model.
 *
 * Usage:
 *   node bin/lib/structured-elicitation.js start|answer|status|report [options]
 *
 * State file: .jumpstart/state/elicitation.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'elicitation.json');

const DOMAINS = ['healthcare', 'fintech', 'retail', 'manufacturing', 'public-sector', 'general'];

const QUESTION_BANKS = {
  general: [
    { id: 'G1', text: 'What problem are you solving?', category: 'problem' },
    { id: 'G2', text: 'Who are the primary users?', category: 'users' },
    { id: 'G3', text: 'What are the success criteria?', category: 'success' },
    { id: 'G4', text: 'What are the key constraints?', category: 'constraints' },
    { id: 'G5', text: 'What is the timeline?', category: 'timeline' }
  ],
  healthcare: [
    { id: 'H1', text: 'Is PHI (Protected Health Information) involved?', category: 'compliance' },
    { id: 'H2', text: 'What HIPAA controls are required?', category: 'compliance' },
    { id: 'H3', text: 'Are there FDA regulatory requirements?', category: 'regulatory' }
  ],
  fintech: [
    { id: 'F1', text: 'What financial regulations apply (PCI-DSS, SOX)?', category: 'compliance' },
    { id: 'F2', text: 'Are there data residency requirements?', category: 'compliance' },
    { id: 'F3', text: 'What audit trail requirements exist?', category: 'audit' }
  ]
};

function defaultState() {
  return { version: '1.0.0', sessions: [], last_updated: null };
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
 * Start a structured elicitation session.
 */
function startElicitation(domain, options = {}) {
  if (!domain) domain = 'general';
  if (!DOMAINS.includes(domain)) {
    return { success: false, error: `Unknown domain: ${domain}. Valid: ${DOMAINS.join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const questions = [
    ...(QUESTION_BANKS.general || []),
    ...(QUESTION_BANKS[domain] || [])
  ];

  const session = {
    id: `ELICIT-${Date.now()}`,
    domain,
    status: 'active',
    questions: questions.map(q => ({ ...q, answered: false, answer: null })),
    created_at: new Date().toISOString()
  };

  state.sessions.push(session);
  saveState(state, stateFile);

  return { success: true, session };
}

/**
 * Answer a question.
 */
function answerQuestion(sessionId, questionId, answer, options = {}) {
  if (!sessionId || !questionId || !answer) {
    return { success: false, error: 'sessionId, questionId, and answer are required' };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const session = state.sessions.find(s => s.id === sessionId);
  if (!session) return { success: false, error: `Session ${sessionId} not found` };

  const question = session.questions.find(q => q.id === questionId);
  if (!question) return { success: false, error: `Question ${questionId} not found` };

  question.answered = true;
  question.answer = answer;
  question.answered_at = new Date().toISOString();

  saveState(state, stateFile);

  const remaining = session.questions.filter(q => !q.answered).length;
  return { success: true, question, remaining };
}

/**
 * Get next unanswered question.
 */
function getNextQuestion(sessionId, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const session = state.sessions.find(s => s.id === sessionId);
  if (!session) return { success: false, error: `Session ${sessionId} not found` };

  const next = session.questions.find(q => !q.answered);
  if (!next) return { success: true, complete: true, question: null };

  return { success: true, complete: false, question: next };
}

/**
 * Generate elicitation report.
 */
function generateReport(sessionId, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const session = state.sessions.find(s => s.id === sessionId);
  if (!session) return { success: false, error: `Session ${sessionId} not found` };

  const answered = session.questions.filter(q => q.answered);
  const unanswered = session.questions.filter(q => !q.answered);
  const byCategory = {};
  for (const q of answered) {
    if (!byCategory[q.category]) byCategory[q.category] = [];
    byCategory[q.category].push({ question: q.text, answer: q.answer });
  }

  return {
    success: true,
    domain: session.domain,
    total_questions: session.questions.length,
    answered: answered.length,
    unanswered: unanswered.length,
    completion_pct: Math.round((answered.length / session.questions.length) * 100),
    by_category: byCategory,
    gaps: unanswered.map(q => q.text)
  };
}

module.exports = {
  startElicitation,
  answerQuestion,
  getNextQuestion,
  generateReport,
  loadState,
  saveState,
  defaultState,
  DOMAINS,
  QUESTION_BANKS
};
