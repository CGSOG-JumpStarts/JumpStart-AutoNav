/**
 * vendor-risk.ts — vendor & dependency risk scoring port (T4.4.2, cluster I).
 *
 * Pure-library port of `bin/lib/vendor-risk.js`. Public surface
 * preserved verbatim:
 *
 *   - `defaultState()`, `loadState(stateFile?)`, `saveState(state, stateFile?)`
 *   - `scanDependencies(root, options?)` => ScanResult
 *   - `assessDependency(dep, options?)` => AssessResult
 *   - `generateReport(options?)` => VendorReport
 *   - `RISK_FACTORS`, `LICENSE_RISK`
 *
 * Behavior parity:
 *   - Default state path: `.jumpstart/state/vendor-risk.json`.
 *   - License risk map preserved verbatim.
 *   - Scoring formulas preserved verbatim.
 *   - M3 hardening: shape-validated JSON; rejects __proto__.
 *
 * @see bin/lib/vendor-risk.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.2
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DEFAULT_STATE_FILE = join('.jumpstart', 'state', 'vendor-risk.json');

export const RISK_FACTORS = [
  'maintenance',
  'license',
  'security',
  'popularity',
  'supply-chain',
] as const;

export const LICENSE_RISK: Record<string, string> = {
  MIT: 'low',
  ISC: 'low',
  'BSD-2-Clause': 'low',
  'BSD-3-Clause': 'low',
  'Apache-2.0': 'low',
  'LGPL-2.1': 'medium',
  'LGPL-3.0': 'medium',
  'MPL-2.0': 'medium',
  'GPL-2.0': 'high',
  'GPL-3.0': 'high',
  'AGPL-3.0': 'high',
  'SSPL-1.0': 'critical',
  'BSL-1.1': 'high',
  UNLICENSED: 'critical',
  unknown: 'high',
};

export interface DependencyEntry {
  name: string;
  version: string;
  type: string;
  ecosystem: string;
}

export interface DepInput {
  name?: string;
  version?: string;
  license?: string;
  last_publish?: string;
  weekly_downloads?: number;
  known_vulnerabilities?: boolean;
  has_lockfile?: boolean;
}

export interface VendorAssessment {
  name: string;
  version: string;
  license: string;
  scores: Record<string, number>;
  overall: number;
  risk_level: string;
  assessed_at: string;
}

export interface VendorRiskState {
  version: string;
  created_at: string;
  last_updated: string | null;
  assessments: VendorAssessment[];
  vendor_catalog: unknown[];
}

export interface ScanOptions {
  includeDevDeps?: boolean;
}

export interface AssessOptions {
  stateFile?: string;
}

export interface ReportOptions {
  stateFile?: string;
}

export interface ScanResult {
  success: true;
  dependencies: DependencyEntry[];
  total: number;
}

export interface AssessResult {
  success: boolean;
  assessment?: VendorAssessment;
  error?: string;
}

export interface VendorReport {
  success: true;
  total_assessed: number;
  by_risk: Record<string, number>;
  high_risk: VendorAssessment[];
  average_score: number;
  assessments: VendorAssessment[];
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function safeParseState(raw: string): VendorRiskState | null {
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
  const data = parsed as Partial<VendorRiskState>;
  return {
    version: typeof data.version === 'string' ? data.version : '1.0.0',
    created_at: typeof data.created_at === 'string' ? data.created_at : new Date().toISOString(),
    last_updated: typeof data.last_updated === 'string' ? data.last_updated : null,
    assessments: Array.isArray(data.assessments) ? (data.assessments as VendorAssessment[]) : [],
    vendor_catalog: Array.isArray(data.vendor_catalog) ? data.vendor_catalog : [],
  };
}

export function defaultState(): VendorRiskState {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    assessments: [],
    vendor_catalog: [],
  };
}

export function loadState(stateFile?: string): VendorRiskState {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  if (!existsSync(filePath)) return defaultState();
  const parsed = safeParseState(readFileSync(filePath, 'utf8'));
  return parsed ?? defaultState();
}

export function saveState(state: VendorRiskState, stateFile?: string): void {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function safeParsePackageJson(raw: string): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} | null {
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
  return parsed as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
}

export function scanDependencies(root: string, options: ScanOptions = {}): ScanResult {
  const packageFile = join(root, 'package.json');
  const dependencies: DependencyEntry[] = [];

  if (existsSync(packageFile)) {
    const pkg = safeParsePackageJson(readFileSync(packageFile, 'utf8'));
    if (pkg) {
      const deps = { ...(pkg.dependencies || {}) };
      const devDeps = options.includeDevDeps ? pkg.devDependencies || {} : {};

      for (const [name, version] of Object.entries(deps)) {
        dependencies.push({ name, version, type: 'production', ecosystem: 'npm' });
      }
      for (const [name, version] of Object.entries(devDeps)) {
        dependencies.push({ name, version, type: 'development', ecosystem: 'npm' });
      }
    }
  }

  return { success: true, dependencies, total: dependencies.length };
}

export function assessDependency(dep: DepInput, options: AssessOptions = {}): AssessResult {
  if (!dep?.name) return { success: false, error: 'dep.name is required' };

  const scores: Record<string, number> = {};

  const license = dep.license || 'unknown';
  const licenseRisk = LICENSE_RISK[license] || 'high';
  scores.license =
    licenseRisk === 'low' ? 90 : licenseRisk === 'medium' ? 60 : licenseRisk === 'high' ? 30 : 10;

  if (dep.last_publish) {
    const daysSince = Math.floor(
      (Date.now() - new Date(dep.last_publish).getTime()) / (1000 * 60 * 60 * 24)
    );
    scores.maintenance = daysSince < 90 ? 90 : daysSince < 365 ? 60 : daysSince < 730 ? 30 : 10;
  } else {
    scores.maintenance = 50;
  }

  const downloads = dep.weekly_downloads || 0;
  scores.popularity =
    downloads > 1000000 ? 90 : downloads > 100000 ? 70 : downloads > 10000 ? 50 : 30;

  scores.security = dep.known_vulnerabilities ? 20 : 80;

  scores['supply-chain'] = dep.has_lockfile ? 80 : 50;

  const overall = Math.round(
    Object.values(scores).reduce((a, b) => a + b, 0) / Object.keys(scores).length
  );

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const assessment: VendorAssessment = {
    name: dep.name,
    version: dep.version || '',
    license,
    scores,
    overall,
    risk_level:
      overall >= 70 ? 'low' : overall >= 50 ? 'medium' : overall >= 30 ? 'high' : 'critical',
    assessed_at: new Date().toISOString(),
  };

  state.assessments.push(assessment);
  saveState(state, stateFile);

  return { success: true, assessment };
}

export function generateReport(options: ReportOptions = {}): VendorReport {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const byRisk: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const a of state.assessments) {
    byRisk[a.risk_level] = (byRisk[a.risk_level] || 0) + 1;
  }

  return {
    success: true,
    total_assessed: state.assessments.length,
    by_risk: byRisk,
    high_risk: state.assessments.filter(
      (a) => a.risk_level === 'high' || a.risk_level === 'critical'
    ),
    average_score:
      state.assessments.length > 0
        ? Math.round(
            state.assessments.reduce((s, a) => s + a.overall, 0) / state.assessments.length
          )
        : 0,
    assessments: state.assessments,
  };
}
