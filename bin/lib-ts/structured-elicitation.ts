/**
 * structured-elicitation.ts — Structured Elicitation port (T4.4.3, cluster L).
 *
 * Pure-library port of `bin/lib/structured-elicitation.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `DOMAINS` (constant array)
 *   - `QUESTION_BANKS` (constant map)
 *   - `defaultState()` => ElicitationState
 *   - `loadState(stateFile?)` => ElicitationState
 *   - `saveState(state, stateFile?)` => void
 *   - `startElicitation(domain, options?)` => StartResult
 *   - `answerQuestion(sessionId, questionId, answer, options?)` => AnswerResult
 *   - `getNextQuestion(sessionId, options?)` => NextResult
 *   - `generateReport(sessionId, options?)` => ReportResult
 *
 * Behavior parity:
 *   - Default state path: `.jumpstart/state/elicitation.json`.
 *   - Default domain when omitted: `general`.
 *   - JSON parse failures load defaults silently.
 *   - JSON shape validation rejects `__proto__` / `constructor` / `prototype`.
 *
 * @see bin/lib/structured-elicitation.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.3
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type Domain =
  | 'healthcare'
  | 'fintech'
  | 'retail'
  | 'manufacturing'
  | 'public-sector'
  | 'general';

export interface QuestionBankEntry {
  id: string;
  text: string;
  category: string;
}

export interface ElicitationQuestion extends QuestionBankEntry {
  answered: boolean;
  answer: string | null;
  answered_at?: string;
}

export interface ElicitationSession {
  id: string;
  domain: string;
  status: 'active' | 'closed';
  questions: ElicitationQuestion[];
  created_at: string;
}

export interface ElicitationState {
  version: string;
  sessions: ElicitationSession[];
  last_updated: string | null;
}

export interface StateFileOption {
  stateFile?: string;
}

export interface StartResult {
  success: boolean;
  session?: ElicitationSession;
  error?: string;
}

export interface AnswerResult {
  success: boolean;
  question?: ElicitationQuestion;
  remaining?: number;
  error?: string;
}

export interface NextResult {
  success: boolean;
  complete?: boolean;
  question?: ElicitationQuestion | null;
  error?: string;
}

export interface ReportResult {
  success: boolean;
  domain?: string;
  total_questions?: number;
  answered?: number;
  unanswered?: number;
  completion_pct?: number;
  by_category?: Record<string, Array<{ question: string; answer: string | null }>>;
  gaps?: string[];
  error?: string;
}

const DEFAULT_STATE_FILE = join('.jumpstart', 'state', 'elicitation.json');

export const DOMAINS: Domain[] = [
  'healthcare',
  'fintech',
  'retail',
  'manufacturing',
  'public-sector',
  'general',
];

export const QUESTION_BANKS: Record<string, QuestionBankEntry[]> = {
  general: [
    { id: 'G1', text: 'What problem are you solving?', category: 'problem' },
    { id: 'G2', text: 'Who are the primary users?', category: 'users' },
    { id: 'G3', text: 'What are the success criteria?', category: 'success' },
    { id: 'G4', text: 'What are the key constraints?', category: 'constraints' },
    { id: 'G5', text: 'What is the timeline?', category: 'timeline' },
  ],
  healthcare: [
    { id: 'H1', text: 'Is PHI (Protected Health Information) involved?', category: 'compliance' },
    { id: 'H2', text: 'What HIPAA controls are required?', category: 'compliance' },
    { id: 'H3', text: 'Are there FDA regulatory requirements?', category: 'regulatory' },
  ],
  fintech: [
    { id: 'F1', text: 'What financial regulations apply (PCI-DSS, SOX)?', category: 'compliance' },
    { id: 'F2', text: 'Are there data residency requirements?', category: 'compliance' },
    { id: 'F3', text: 'What audit trail requirements exist?', category: 'audit' },
  ],
};

export function defaultState(): ElicitationState {
  return { version: '1.0.0', sessions: [], last_updated: null };
}

function _safeParseState(content: string): ElicitationState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') return null;
  }
  const base = defaultState();
  return {
    ...base,
    ...obj,
    sessions: Array.isArray(obj.sessions) ? (obj.sessions as ElicitationSession[]) : [],
  };
}

export function loadState(stateFile?: string): ElicitationState {
  const fp = stateFile || DEFAULT_STATE_FILE;
  if (!existsSync(fp)) return defaultState();
  const parsed = _safeParseState(readFileSync(fp, 'utf8'));
  return parsed || defaultState();
}

export function saveState(state: ElicitationState, stateFile?: string): void {
  const fp = stateFile || DEFAULT_STATE_FILE;
  const dir = dirname(fp);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  writeFileSync(fp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/**
 * Start a structured elicitation session.
 */
export function startElicitation(domain: string, options: StateFileOption = {}): StartResult {
  const d = domain || 'general';
  if (!DOMAINS.includes(d as Domain)) {
    return { success: false, error: `Unknown domain: ${d}. Valid: ${DOMAINS.join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const questions: QuestionBankEntry[] = [
    ...(QUESTION_BANKS.general || []),
    ...(QUESTION_BANKS[d] || []),
  ];

  const session: ElicitationSession = {
    id: `ELICIT-${Date.now()}`,
    domain: d,
    status: 'active',
    questions: questions.map((q) => ({ ...q, answered: false, answer: null })),
    created_at: new Date().toISOString(),
  };

  state.sessions.push(session);
  saveState(state, stateFile);

  return { success: true, session };
}

/**
 * Answer a question.
 */
export function answerQuestion(
  sessionId: string,
  questionId: string,
  answer: string,
  options: StateFileOption = {}
): AnswerResult {
  if (!sessionId || !questionId || !answer) {
    return { success: false, error: 'sessionId, questionId, and answer are required' };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return { success: false, error: `Session ${sessionId} not found` };

  const question = session.questions.find((q) => q.id === questionId);
  if (!question) return { success: false, error: `Question ${questionId} not found` };

  question.answered = true;
  question.answer = answer;
  question.answered_at = new Date().toISOString();

  saveState(state, stateFile);

  const remaining = session.questions.filter((q) => !q.answered).length;
  return { success: true, question, remaining };
}

/**
 * Get next unanswered question.
 */
export function getNextQuestion(sessionId: string, options: StateFileOption = {}): NextResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return { success: false, error: `Session ${sessionId} not found` };

  const next = session.questions.find((q) => !q.answered);
  if (!next) return { success: true, complete: true, question: null };

  return { success: true, complete: false, question: next };
}

/**
 * Generate elicitation report.
 */
export function generateReport(sessionId: string, options: StateFileOption = {}): ReportResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return { success: false, error: `Session ${sessionId} not found` };

  const answered = session.questions.filter((q) => q.answered);
  const unanswered = session.questions.filter((q) => !q.answered);
  const byCategory: Record<string, Array<{ question: string; answer: string | null }>> = {};
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
    gaps: unanswered.map((q) => q.text),
  };
}
