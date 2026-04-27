/**
 * cost-router.ts — cost-aware model routing port (T4.3.1).
 *
 * Pure-library port of `bin/lib/cost-router.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `MODEL_COSTS` (constant catalog)
 *   - `BUDGET_PROFILES` (constant catalog)
 *   - `loadConfig(configFile?)`
 *   - `saveConfig(config, configFile?)`
 *   - `routeByCost(task, options?)`
 *   - `recordSpending(model, tokens, options?)`
 *   - `generateReport(options?)`
 *
 * Behavior parity:
 *   - Default config file: `.jumpstart/cost-routing.json`.
 *   - Config defaults: `{budget_profile: 'balanced', spending: []}`.
 *   - Cost rounding: 4 decimal places (cost) / 2 decimal places (total).
 *   - Sort preference: cheapest / best-quality / balanced
 *     (avg of quality+speed).
 *   - Soft-fail on missing/corrupt config (returns defaults).
 *
 * @see bin/lib/cost-router.js (legacy reference)
 * @see specs/implementation-plan.md T4.3.1
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

// Public types

export interface ModelCostEntry {
  input_per_1k: number;
  output_per_1k: number;
  quality: number;
  speed: number;
}

export interface BudgetProfile {
  max_per_task: number;
  prefer: 'cheapest' | 'balanced' | 'best-quality';
  min_quality: number;
}

export interface SpendingEntry {
  model: string;
  tokens: number;
  cost: number;
  recorded_at: string;
}

export interface CostRouterConfig {
  budget_profile: string;
  spending: SpendingEntry[];
}

export interface RouteTask {
  type?: string;
  estimated_tokens?: number;
  min_quality?: number;
}

export interface RouteOptions {
  configFile?: string;
}

export interface RouteCandidate {
  model: string;
  cost: number;
  quality: number;
  speed: number;
}

export interface RouteResult {
  success: boolean;
  selected_model: string | null;
  estimated_cost: number;
  quality: number;
  budget_profile: string;
  alternatives: RouteCandidate[];
}

export interface RecordSpendingResult {
  success: boolean;
  model?: string;
  tokens?: number;
  cost?: number;
  error?: string;
}

export interface CostReport {
  success: boolean;
  budget_profile: string;
  total_cost: number;
  total_requests: number;
  by_model: Record<string, number>;
  recent: SpendingEntry[];
}

// Catalogs (preserved verbatim from legacy)

export const MODEL_COSTS: Record<string, ModelCostEntry> = {
  'gpt-4o': { input_per_1k: 0.005, output_per_1k: 0.015, quality: 90, speed: 80 },
  'gpt-4-turbo': { input_per_1k: 0.01, output_per_1k: 0.03, quality: 92, speed: 70 },
  'gpt-3.5-turbo': { input_per_1k: 0.0005, output_per_1k: 0.0015, quality: 70, speed: 95 },
  'claude-3-opus': { input_per_1k: 0.015, output_per_1k: 0.075, quality: 95, speed: 60 },
  'claude-3-sonnet': { input_per_1k: 0.003, output_per_1k: 0.015, quality: 88, speed: 85 },
  'claude-3-haiku': {
    input_per_1k: 0.00025,
    output_per_1k: 0.00125,
    quality: 75,
    speed: 95,
  },
};

export const BUDGET_PROFILES: Record<string, BudgetProfile> = {
  economy: { max_per_task: 0.1, prefer: 'cheapest', min_quality: 65 },
  balanced: { max_per_task: 0.5, prefer: 'balanced', min_quality: 80 },
  premium: { max_per_task: 2.0, prefer: 'best-quality', min_quality: 90 },
};

const DEFAULT_CONFIG_FILE = path.join('.jumpstart', 'cost-routing.json');

// Implementation

/** Load cost-routing config; returns defaults on missing/corrupt. */
export function loadConfig(configFile?: string): CostRouterConfig {
  const filePath = configFile || DEFAULT_CONFIG_FILE;
  if (!existsSync(filePath)) return { budget_profile: 'balanced', spending: [] };
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as CostRouterConfig;
  } catch {
    return { budget_profile: 'balanced', spending: [] };
  }
}

/** Persist cost-routing config (auto-creates parent dir + trailing newline). */
export function saveConfig(config: CostRouterConfig, configFile?: string): void {
  const filePath = configFile || DEFAULT_CONFIG_FILE;
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

/**
 * Route to the most cost-effective model. Filter by min_quality
 * (task override > profile default), then sort by the profile's
 * `prefer` policy (cheapest / best-quality / balanced).
 */
export function routeByCost(task: RouteTask, options: RouteOptions = {}): RouteResult {
  const configFile = options.configFile || DEFAULT_CONFIG_FILE;
  const config = loadConfig(configFile);
  const profile = BUDGET_PROFILES[config.budget_profile] || BUDGET_PROFILES.balanced;
  // Pit Crew M4 Reviewer M1: legacy used `||` not `??`. For a caller
  // who passes `min_quality: 0` (i.e. "no minimum"), `??` keeps the 0
  // and accepts any quality; `||` falls through to profile default.
  // Restore legacy behavior to avoid silent routing changes.
  const minQuality = task.min_quality || profile.min_quality;

  const candidates: RouteCandidate[] = Object.entries(MODEL_COSTS)
    .filter(([, costs]) => costs.quality >= minQuality)
    .map(([model, costs]) => {
      const tokens = task.estimated_tokens || 1000;
      const cost = (tokens / 1000) * costs.input_per_1k + (tokens / 1000) * costs.output_per_1k;
      return {
        model,
        cost: Math.round(cost * 10000) / 10000,
        quality: costs.quality,
        speed: costs.speed,
      };
    })
    .sort((a, b) => {
      if (profile.prefer === 'cheapest') return a.cost - b.cost;
      if (profile.prefer === 'best-quality') return b.quality - a.quality;
      return (b.quality + b.speed) / 2 - (a.quality + a.speed) / 2;
    });

  const selected = candidates[0];

  return {
    success: true,
    selected_model: selected ? selected.model : null,
    estimated_cost: selected ? selected.cost : 0,
    quality: selected ? selected.quality : 0,
    budget_profile: config.budget_profile,
    alternatives: candidates.slice(1, 3),
  };
}

/** Record an LLM spend entry into the on-disk config. */
export function recordSpending(
  model: string,
  tokens: number,
  options: RouteOptions = {}
): RecordSpendingResult {
  const configFile = options.configFile || DEFAULT_CONFIG_FILE;
  const config = loadConfig(configFile);
  const costs = MODEL_COSTS[model];

  if (!costs) return { success: false, error: `Unknown model: ${model}` };

  const cost = (tokens / 1000) * (costs.input_per_1k + costs.output_per_1k);

  if (!config.spending) config.spending = [];
  config.spending.push({
    model,
    tokens,
    cost: Math.round(cost * 10000) / 10000,
    recorded_at: new Date().toISOString(),
  });

  saveConfig(config, configFile);

  return { success: true, model, tokens, cost: Math.round(cost * 10000) / 10000 };
}

/** Aggregate cost report over recorded spending. */
export function generateReport(options: RouteOptions = {}): CostReport {
  const configFile = options.configFile || DEFAULT_CONFIG_FILE;
  const config = loadConfig(configFile);
  const spending = config.spending || [];

  const totalCost = spending.reduce((sum, s) => sum + s.cost, 0);
  const byModel = spending.reduce<Record<string, number>>((acc, s) => {
    acc[s.model] = (acc[s.model] || 0) + s.cost;
    return acc;
  }, {});

  return {
    success: true,
    budget_profile: config.budget_profile,
    total_cost: Math.round(totalCost * 100) / 100,
    total_requests: spending.length,
    by_model: byModel,
    recent: spending.slice(-10),
  };
}
