/**
 * promptless-mode.ts — promptless mode wizard port (T4.3.3, cluster H).
 *
 * Pure-library port of `bin/lib/promptless-mode.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `WIZARDS` (constant array)
 *   - `WIZARD_STEPS` (constant map)
 *   - `defaultState()` => PromptlessState
 *   - `loadState(stateFile?)` => PromptlessState
 *   - `saveState(state, stateFile?)`
 *   - `startWizard(wizardType, options?)` => StartWizardResult
 *   - `answerStep(sessionId, answer, options?)` => AnswerStepResult
 *   - `getWizardStatus(options?)` => WizardStatusResult
 *
 * Behavior parity:
 *   - Default state path: `.jumpstart/state/promptless.json`.
 *   - Auto-incrementing session ID `WIZ-<unix-ms>`.
 *   - JSON parse failures load default state silently.
 *   - Wizard completion: `current_step >= steps.length` → `complete`.
 *
 * @see bin/lib/promptless-mode.js (legacy reference)
 * @see specs/implementation-plan.md T4.3.3
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Public types

export type WizardId = 'new-project' | 'add-feature' | 'review-spec' | 'estimate' | 'handoff';

export interface WizardStepDefinition {
  id: string;
  prompt: string;
  type: 'text' | 'select';
  options?: string[];
}

export interface WizardStep extends WizardStepDefinition {
  answer: string | null;
}

export interface WizardSession {
  id: string;
  wizard: string;
  status: 'active' | 'complete';
  current_step: number;
  steps: WizardStep[];
  created_at: string;
}

export interface PromptlessState {
  version: string;
  sessions: WizardSession[];
  last_updated: string | null;
}

export interface StartWizardOptions {
  stateFile?: string;
}

export interface StartWizardResult {
  success: boolean;
  session?: WizardSession;
  next_step?: WizardStep | null;
  error?: string;
}

export interface AnswerStepOptions {
  stateFile?: string;
}

export interface AnswerStepResult {
  success: boolean;
  complete?: boolean;
  next_step?: WizardStep | null;
  answers?: Record<string, string | null>;
  error?: string;
}

export interface WizardStatusOptions {
  stateFile?: string;
}

export interface WizardStatusEntry {
  id: string;
  wizard: string;
  status: string;
  progress: string;
}

export interface WizardStatusResult {
  success: boolean;
  available_wizards: string[];
  sessions: WizardStatusEntry[];
}

// Constants (verbatim from legacy)

const DEFAULT_STATE_FILE = join('.jumpstart', 'state', 'promptless.json');

export const WIZARDS: WizardId[] = [
  'new-project',
  'add-feature',
  'review-spec',
  'estimate',
  'handoff',
];

export const WIZARD_STEPS: Record<string, WizardStepDefinition[]> = {
  'new-project': [
    { id: 'name', prompt: 'What is your project name?', type: 'text' },
    {
      id: 'domain',
      prompt: 'What industry is this for?',
      type: 'select',
      options: ['healthcare', 'fintech', 'retail', 'manufacturing', 'public-sector', 'general'],
    },
    {
      id: 'type',
      prompt: 'Is this a new or existing project?',
      type: 'select',
      options: ['greenfield', 'brownfield'],
    },
    {
      id: 'team_size',
      prompt: 'How large is your team?',
      type: 'select',
      options: ['1-3', '4-10', '10+'],
    },
  ],
  'add-feature': [
    { id: 'feature_name', prompt: 'What feature do you want to add?', type: 'text' },
    {
      id: 'priority',
      prompt: 'How urgent is this?',
      type: 'select',
      options: ['must-have', 'should-have', 'nice-to-have'],
    },
    {
      id: 'complexity',
      prompt: 'How complex do you think it is?',
      type: 'select',
      options: ['simple', 'moderate', 'complex'],
    },
  ],
  'review-spec': [
    { id: 'spec_file', prompt: 'Which specification file?', type: 'text' },
    {
      id: 'review_type',
      prompt: 'What kind of review?',
      type: 'select',
      options: ['completeness', 'quality', 'ambiguity'],
    },
  ],
};

// Implementation

/** Default state structure. */
export function defaultState(): PromptlessState {
  return { version: '1.0.0', sessions: [], last_updated: null };
}

/** Load state from disk; defaults on missing/corrupt. */
export function loadState(stateFile?: string): PromptlessState {
  const fp = stateFile || DEFAULT_STATE_FILE;
  if (!existsSync(fp)) return defaultState();
  try {
    return JSON.parse(readFileSync(fp, 'utf8')) as PromptlessState;
  } catch {
    return defaultState();
  }
}

/** Persist state to disk. Auto-creates parent dir, stamps last_updated. */
export function saveState(state: PromptlessState, stateFile?: string): void {
  const fp = stateFile || DEFAULT_STATE_FILE;
  const dir = dirname(fp);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  writeFileSync(fp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/** Begin a new wizard session. */
export function startWizard(
  wizardType: string,
  options: StartWizardOptions = {}
): StartWizardResult {
  if (!WIZARDS.includes(wizardType as WizardId)) {
    return { success: false, error: `Unknown wizard: ${wizardType}. Valid: ${WIZARDS.join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const session: WizardSession = {
    id: `WIZ-${Date.now()}`,
    wizard: wizardType,
    status: 'active',
    current_step: 0,
    steps: (WIZARD_STEPS[wizardType] || []).map((s) => ({ ...s, answer: null })),
    created_at: new Date().toISOString(),
  };

  state.sessions.push(session);
  saveState(state, stateFile);

  return { success: true, session, next_step: session.steps[0] || null };
}

/** Submit an answer for the current step of a wizard session. */
export function answerStep(
  sessionId: string,
  answer: string,
  options: AnswerStepOptions = {}
): AnswerStepResult {
  if (!sessionId) return { success: false, error: 'sessionId is required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return { success: false, error: `Session ${sessionId} not found` };

  if (session.current_step >= session.steps.length) {
    return { success: false, error: 'Wizard is already complete' };
  }

  session.steps[session.current_step].answer = answer;
  session.current_step++;

  const complete = session.current_step >= session.steps.length;
  if (complete) session.status = 'complete';

  saveState(state, stateFile);

  return {
    success: true,
    complete,
    next_step: complete ? null : session.steps[session.current_step],
    answers: Object.fromEntries(
      session.steps.filter((s) => s.answer !== null).map((s) => [s.id, s.answer])
    ),
  };
}

/** Snapshot of all known wizard sessions and the available wizard list. */
export function getWizardStatus(options: WizardStatusOptions = {}): WizardStatusResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    available_wizards: WIZARDS,
    sessions: state.sessions.map((s) => ({
      id: s.id,
      wizard: s.wizard,
      status: s.status,
      progress: `${s.current_step}/${s.steps.length}`,
    })),
  };
}
