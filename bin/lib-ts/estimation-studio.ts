/**
 * estimation-studio.ts — Feature Estimation Studio port (T4.4.3, cluster L).
 *
 * Pure-library port of `bin/lib/estimation-studio.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `TSHIRT_SIZES` (constant array)
 *   - `TSHIRT_TO_POINTS` (constant map)
 *   - `TSHIRT_TO_DAYS` (constant map)
 *   - `CONFIDENCE_LEVELS` (constant array)
 *   - `CONFIDENCE_RANGES` (constant map)
 *   - `defaultState()` / `loadState()` / `saveState()`
 *   - `estimateFeature(name, tshirtSize, options?)` => EstimateResult
 *   - `generateReport(options?)` => ReportResult
 *   - `calibrate(velocity, options?)` => CalibrateResult
 *
 * Behavior parity:
 *   - Default state path: `.jumpstart/state/estimations.json`.
 *   - Default daily rate: 800.
 *   - Default confidence: medium.
 *   - JSON parse failures load defaults silently.
 *   - JSON shape validation rejects `__proto__` / `constructor` / `prototype`.
 *
 * @see bin/lib/estimation-studio.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.3
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type TshirtSize = 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL';
export type ConfidenceLevel = 'low' | 'medium' | 'high';

export interface ConfidenceRange {
  min_multiplier: number;
  max_multiplier: number;
}

export interface RomCost {
  min: number;
  expected: number;
  max: number;
}

export interface Estimate {
  id: string;
  name: string;
  tshirt_size: TshirtSize;
  story_points: number;
  ideal_days: number;
  confidence: string;
  rom_cost: RomCost;
  created_at: string;
}

export interface EstimationCalibration {
  velocity: number | null;
  updated_at?: string;
}

export interface EstimationState {
  version: string;
  estimates: Estimate[];
  calibration: EstimationCalibration;
  last_updated: string | null;
}

export interface EstimateOptions {
  stateFile?: string;
  confidence?: string;
  dailyRate?: number;
}

export interface EstimateResult {
  success: boolean;
  estimate?: Estimate;
  error?: string;
}

export interface ReportOptions {
  stateFile?: string;
}

export interface ReportResult {
  success: boolean;
  total_features: number;
  total_story_points: number;
  total_ideal_days: number;
  total_rom_cost: { min: number; max: number };
  by_size: Record<string, number>;
  estimates: Estimate[];
}

export interface CalibrateResult {
  success: boolean;
  velocity: number;
}

const DEFAULT_STATE_FILE = join('.jumpstart', 'state', 'estimations.json');

export const TSHIRT_SIZES: TshirtSize[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

export const TSHIRT_TO_POINTS: Record<TshirtSize, number> = {
  XS: 1,
  S: 2,
  M: 3,
  L: 5,
  XL: 8,
  XXL: 13,
};

export const TSHIRT_TO_DAYS: Record<TshirtSize, number> = {
  XS: 0.5,
  S: 1,
  M: 2,
  L: 5,
  XL: 10,
  XXL: 20,
};

export const CONFIDENCE_LEVELS: ConfidenceLevel[] = ['low', 'medium', 'high'];

export const CONFIDENCE_RANGES: Record<ConfidenceLevel, ConfidenceRange> = {
  low: { min_multiplier: 0.5, max_multiplier: 3.0 },
  medium: { min_multiplier: 0.75, max_multiplier: 1.5 },
  high: { min_multiplier: 0.9, max_multiplier: 1.2 },
};

export function defaultState(): EstimationState {
  return {
    version: '1.0.0',
    estimates: [],
    calibration: { velocity: null },
    last_updated: null,
  };
}

function _safeParseState(content: string): EstimationState | null {
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
    estimates: Array.isArray(obj.estimates) ? (obj.estimates as Estimate[]) : [],
    calibration:
      obj.calibration && typeof obj.calibration === 'object' && !Array.isArray(obj.calibration)
        ? (obj.calibration as EstimationCalibration)
        : { velocity: null },
  };
}

export function loadState(stateFile?: string): EstimationState {
  const fp = stateFile || DEFAULT_STATE_FILE;
  if (!existsSync(fp)) return defaultState();
  const parsed = _safeParseState(readFileSync(fp, 'utf8'));
  return parsed || defaultState();
}

export function saveState(state: EstimationState, stateFile?: string): void {
  const fp = stateFile || DEFAULT_STATE_FILE;
  const dir = dirname(fp);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  writeFileSync(fp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/**
 * Estimate a feature.
 */
export function estimateFeature(
  name: string,
  tshirtSize: string,
  options: EstimateOptions = {}
): EstimateResult {
  if (!name || !tshirtSize) return { success: false, error: 'name and tshirtSize are required' };
  if (!TSHIRT_SIZES.includes(tshirtSize as TshirtSize)) {
    return {
      success: false,
      error: `Invalid size: ${tshirtSize}. Valid: ${TSHIRT_SIZES.join(', ')}`,
    };
  }

  const confidence = (options.confidence || 'medium') as ConfidenceLevel;
  const range = CONFIDENCE_RANGES[confidence] || CONFIDENCE_RANGES.medium;
  const points = TSHIRT_TO_POINTS[tshirtSize as TshirtSize];
  const days = TSHIRT_TO_DAYS[tshirtSize as TshirtSize];
  const dailyRate = options.dailyRate || 800;

  const estimate: Estimate = {
    id: `EST-${Date.now()}`,
    name,
    tshirt_size: tshirtSize as TshirtSize,
    story_points: points,
    ideal_days: days,
    confidence,
    rom_cost: {
      min: Math.round(days * dailyRate * range.min_multiplier),
      expected: Math.round(days * dailyRate),
      max: Math.round(days * dailyRate * range.max_multiplier),
    },
    created_at: new Date().toISOString(),
  };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);
  state.estimates.push(estimate);
  saveState(state, stateFile);

  return { success: true, estimate };
}

/**
 * Generate estimation report.
 */
export function generateReport(options: ReportOptions = {}): ReportResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const totalPoints = state.estimates.reduce((s, e) => s + e.story_points, 0);
  const totalDays = state.estimates.reduce((s, e) => s + e.ideal_days, 0);
  const totalCostMin = state.estimates.reduce((s, e) => s + e.rom_cost.min, 0);
  const totalCostMax = state.estimates.reduce((s, e) => s + e.rom_cost.max, 0);

  return {
    success: true,
    total_features: state.estimates.length,
    total_story_points: totalPoints,
    total_ideal_days: totalDays,
    total_rom_cost: { min: totalCostMin, max: totalCostMax },
    by_size: TSHIRT_SIZES.reduce<Record<string, number>>((acc, size) => {
      acc[size] = state.estimates.filter((e) => e.tshirt_size === size).length;
      return acc;
    }, {}),
    estimates: state.estimates,
  };
}

/**
 * Set calibration data.
 */
export function calibrate(velocity: number, options: ReportOptions = {}): CalibrateResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);
  state.calibration.velocity = velocity;
  state.calibration.updated_at = new Date().toISOString();
  saveState(state, stateFile);
  return { success: true, velocity };
}
