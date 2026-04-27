/**
 * ai-evaluation.ts — evaluation framework for AI systems port (T4.4.2, cluster I).
 *
 * Pure-library port of `bin/lib/ai-evaluation.js`. Public surface
 * preserved verbatim:
 *
 *   - `evaluate(name, scores, options?)` => EvaluateResult
 *   - `generateReport(options?)` => EvalReport
 *   - `configureBenchmark(name, thresholds, options?)` => BenchmarkResult
 *   - `loadState(stateFile?)`, `saveState(state, stateFile?)`, `defaultState()`
 *   - `EVAL_DIMENSIONS`
 *
 * Behavior parity:
 *   - Default state path: `.jumpstart/state/ai-evaluation.json`.
 *   - 7 evaluation dimensions preserved verbatim.
 *   - Overall = mean of provided dimension scores.
 *   - M3 hardening: shape-validated JSON; rejects __proto__.
 *
 * @see bin/lib/ai-evaluation.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.2
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DEFAULT_STATE_FILE = join('.jumpstart', 'state', 'ai-evaluation.json');

export const EVAL_DIMENSIONS = [
  'groundedness',
  'hallucination',
  'safety',
  'latency',
  'cost',
  'relevance',
  'coherence',
] as const;

export interface AIEvaluation {
  id: string;
  name: string;
  scores: Record<string, number>;
  overall: number;
  model: string | null;
  use_case: string | null;
  evaluated_at: string;
}

export interface AIBenchmark {
  id: string;
  name: string;
  thresholds: Record<string, number>;
  created_at: string;
}

export interface AIEvalState {
  version: string;
  evaluations: AIEvaluation[];
  benchmarks: AIBenchmark[];
  last_updated: string | null;
}

export interface EvaluateOptions {
  stateFile?: string;
  model?: string;
  use_case?: string;
}

export interface BenchmarkOptions {
  stateFile?: string;
}

export interface ReportOptions {
  stateFile?: string;
}

export interface EvaluateResult {
  success: boolean;
  evaluation?: AIEvaluation;
  error?: string;
}

export interface BenchmarkResult {
  success: boolean;
  benchmark?: AIBenchmark;
  error?: string;
}

export interface EvalReport {
  success: true;
  total_evaluations: number;
  average_scores: Record<string, number | null>;
  evaluations: AIEvaluation[];
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function safeParseState(raw: string): AIEvalState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  for (const key of Object.keys(parsed)) {
    if (FORBIDDEN_KEYS.has(key)) return null;
  }
  const data = parsed as Partial<AIEvalState>;
  return {
    version: typeof data.version === 'string' ? data.version : '1.0.0',
    evaluations: Array.isArray(data.evaluations) ? (data.evaluations as AIEvaluation[]) : [],
    benchmarks: Array.isArray(data.benchmarks) ? (data.benchmarks as AIBenchmark[]) : [],
    last_updated: typeof data.last_updated === 'string' ? data.last_updated : null,
  };
}

export function defaultState(): AIEvalState {
  return { version: '1.0.0', evaluations: [], benchmarks: [], last_updated: null };
}

export function loadState(stateFile?: string): AIEvalState {
  const fp = stateFile || DEFAULT_STATE_FILE;
  if (!existsSync(fp)) return defaultState();
  const parsed = safeParseState(readFileSync(fp, 'utf8'));
  return parsed ?? defaultState();
}

export function saveState(state: AIEvalState, stateFile?: string): void {
  const fp = stateFile || DEFAULT_STATE_FILE;
  const dir = dirname(fp);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  writeFileSync(fp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function evaluate(
  name: string,
  scores: Record<string, number>,
  options: EvaluateOptions = {}
): EvaluateResult {
  if (!name || !scores) return { success: false, error: 'name and scores are required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const values = Object.values(scores);
  const overall =
    values.length > 0 ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;

  const evaluation: AIEvaluation = {
    id: `EVAL-${Date.now()}`,
    name,
    scores,
    overall,
    model: options.model || null,
    use_case: options.use_case || null,
    evaluated_at: new Date().toISOString(),
  };

  state.evaluations.push(evaluation);
  saveState(state, stateFile);

  return { success: true, evaluation };
}

export function generateReport(options: ReportOptions = {}): EvalReport {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const avgScores: Record<string, number | null> = {};
  for (const dim of EVAL_DIMENSIONS) {
    const vals = state.evaluations
      .filter((e) => e.scores[dim] !== undefined)
      .map((e) => e.scores[dim]);
    avgScores[dim] =
      vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }

  return {
    success: true,
    total_evaluations: state.evaluations.length,
    average_scores: avgScores,
    evaluations: state.evaluations,
  };
}

export function configureBenchmark(
  name: string,
  thresholds: Record<string, number>,
  options: BenchmarkOptions = {}
): BenchmarkResult {
  if (!name || !thresholds) {
    return { success: false, error: 'name and thresholds are required' };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const benchmark: AIBenchmark = {
    id: `BENCH-${Date.now()}`,
    name,
    thresholds,
    created_at: new Date().toISOString(),
  };

  state.benchmarks.push(benchmark);
  saveState(state, stateFile);

  return { success: true, benchmark };
}
