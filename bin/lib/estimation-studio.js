/**
 * estimation-studio.js — Feature Estimation Studio (Item 72)
 *
 * T-shirt sizing, story points, ideal days, ROM cost,
 * and confidence ranges for feature estimation.
 *
 * Usage:
 *   node bin/lib/estimation-studio.js estimate|report|calibrate [options]
 *
 * State file: .jumpstart/state/estimations.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join('.jumpstart', 'state', 'estimations.json');

const TSHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const TSHIRT_TO_POINTS = { XS: 1, S: 2, M: 3, L: 5, XL: 8, XXL: 13 };
const TSHIRT_TO_DAYS = { XS: 0.5, S: 1, M: 2, L: 5, XL: 10, XXL: 20 };

const CONFIDENCE_LEVELS = ['low', 'medium', 'high'];
const CONFIDENCE_RANGES = {
  low: { min_multiplier: 0.5, max_multiplier: 3.0 },
  medium: { min_multiplier: 0.75, max_multiplier: 1.5 },
  high: { min_multiplier: 0.9, max_multiplier: 1.2 }
};

function defaultState() {
  return { version: '1.0.0', estimates: [], calibration: { velocity: null }, last_updated: null };
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
 * Estimate a feature.
 */
function estimateFeature(name, tshirtSize, options = {}) {
  if (!name || !tshirtSize) return { success: false, error: 'name and tshirtSize are required' };
  if (!TSHIRT_SIZES.includes(tshirtSize)) {
    return { success: false, error: `Invalid size: ${tshirtSize}. Valid: ${TSHIRT_SIZES.join(', ')}` };
  }

  const confidence = options.confidence || 'medium';
  const range = CONFIDENCE_RANGES[confidence] || CONFIDENCE_RANGES.medium;
  const points = TSHIRT_TO_POINTS[tshirtSize];
  const days = TSHIRT_TO_DAYS[tshirtSize];
  const dailyRate = options.dailyRate || 800;

  const estimate = {
    id: `EST-${Date.now()}`,
    name,
    tshirt_size: tshirtSize,
    story_points: points,
    ideal_days: days,
    confidence,
    rom_cost: {
      min: Math.round(days * dailyRate * range.min_multiplier),
      expected: Math.round(days * dailyRate),
      max: Math.round(days * dailyRate * range.max_multiplier)
    },
    created_at: new Date().toISOString()
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
function generateReport(options = {}) {
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
    by_size: TSHIRT_SIZES.reduce((acc, size) => {
      acc[size] = state.estimates.filter(e => e.tshirt_size === size).length;
      return acc;
    }, {}),
    estimates: state.estimates
  };
}

/**
 * Set calibration data.
 */
function calibrate(velocity, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);
  state.calibration.velocity = velocity;
  state.calibration.updated_at = new Date().toISOString();
  saveState(state, stateFile);
  return { success: true, velocity };
}

module.exports = {
  estimateFeature, generateReport, calibrate,
  loadState, saveState, defaultState,
  TSHIRT_SIZES, TSHIRT_TO_POINTS, TSHIRT_TO_DAYS, CONFIDENCE_LEVELS, CONFIDENCE_RANGES
};
