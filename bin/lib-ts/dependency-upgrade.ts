/**
 * dependency-upgrade.ts — Dependency Upgrade Autopilot port (T4.4.3, cluster L).
 *
 * Pure-library port of `bin/lib/dependency-upgrade.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `UPGRADE_TYPES` (constant array)
 *   - `RISK_BY_TYPE` (constant map)
 *   - `defaultState()` => UpgradeState
 *   - `loadState(stateFile?)` => UpgradeState
 *   - `saveState(state, stateFile?)` => void
 *   - `scanUpgrades(root, options?)` => ScanResult
 *   - `createUpgradePlan(plan, options?)` => CreatePlanResult
 *   - `generateReport(options?)` => ReportResult
 *
 * Behavior parity:
 *   - Default state file: `.jumpstart/state/dependency-upgrades.json`.
 *   - Risk mapping: patch=low, minor=medium, major=high.
 *   - JSON parse failures load defaults silently.
 *   - JSON shape validation rejects `__proto__` / `constructor` / `prototype`.
 *   - CLI entry-point intentionally omitted.
 *
 * @see bin/lib/dependency-upgrade.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.3
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type UpgradeType = 'patch' | 'minor' | 'major';

export interface DependencyCandidate {
  name: string;
  current_version: string;
  specified: string;
  type: 'minor-range' | 'patch-range' | 'fixed';
  is_dev: boolean;
}

export interface UpgradeEntry {
  package: string;
  from: string;
  to: string;
  type: string;
  risk: string;
  status: string;
  test_result: unknown | null;
}

export interface UpgradePlan {
  id: string;
  name: string;
  upgrades: UpgradeEntry[];
  status: string;
  created_at: string;
}

export interface ScanRecord {
  scanned_at: string;
  total: number;
}

export interface UpgradeState {
  version: string;
  created_at: string;
  last_updated: string | null;
  scans: ScanRecord[];
  upgrade_plans: UpgradePlan[];
}

export interface StateFileOption {
  stateFile?: string;
  [key: string]: unknown;
}

export interface ScanResult {
  success: boolean;
  dependencies?: DependencyCandidate[];
  total?: number;
  error?: string;
}

export interface PlanInput {
  name?: string;
  upgrades?: Array<{
    package?: string;
    name?: string;
    from?: string;
    current_version?: string;
    to?: string;
    target_version?: string;
    type?: string;
  }>;
}

export interface CreatePlanResult {
  success: boolean;
  plan?: UpgradePlan;
  error?: string;
}

export interface ReportResult {
  success: boolean;
  total_plans: number;
  total_scans: number;
  plans: UpgradePlan[];
  last_scan: ScanRecord | null;
}

const DEFAULT_STATE_FILE = join('.jumpstart', 'state', 'dependency-upgrades.json');

export const UPGRADE_TYPES: UpgradeType[] = ['patch', 'minor', 'major'];
export const RISK_BY_TYPE: Record<UpgradeType, string> = {
  patch: 'low',
  minor: 'medium',
  major: 'high',
};

export function defaultState(): UpgradeState {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    scans: [],
    upgrade_plans: [],
  };
}

function _safeParseState(content: string): UpgradeState | null {
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
    scans: Array.isArray(obj.scans) ? (obj.scans as ScanRecord[]) : [],
    upgrade_plans: Array.isArray(obj.upgrade_plans) ? (obj.upgrade_plans as UpgradePlan[]) : [],
  };
}

function _safeParseJson(content: string): Record<string, unknown> | null {
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
  return obj;
}

export function loadState(stateFile?: string): UpgradeState {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  if (!existsSync(filePath)) return defaultState();
  const parsed = _safeParseState(readFileSync(filePath, 'utf8'));
  return parsed || defaultState();
}

export function saveState(state: UpgradeState, stateFile?: string): void {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/**
 * Scan for available dependency upgrades.
 */
export function scanUpgrades(root: string, options: StateFileOption = {}): ScanResult {
  const packageFile = join(root, 'package.json');
  if (!existsSync(packageFile)) {
    return { success: false, error: 'package.json not found' };
  }

  const pkg = _safeParseJson(readFileSync(packageFile, 'utf8'));
  if (!pkg) return { success: false, error: 'Invalid package.json' };

  const dependencies = (pkg.dependencies as Record<string, string>) || {};
  const devDependencies = (pkg.devDependencies as Record<string, string>) || {};
  const deps: Record<string, string> = { ...dependencies, ...devDependencies };
  const candidates: DependencyCandidate[] = [];

  for (const [name, version] of Object.entries(deps)) {
    const clean = version.replace(/^[\^~>=<]/, '');
    candidates.push({
      name,
      current_version: clean,
      specified: version,
      type: version.startsWith('^')
        ? 'minor-range'
        : version.startsWith('~')
          ? 'patch-range'
          : 'fixed',
      is_dev: !!devDependencies[name],
    });
  }

  const stateFile = options.stateFile || join(root, DEFAULT_STATE_FILE);
  const state = loadState(stateFile);
  state.scans.push({
    scanned_at: new Date().toISOString(),
    total: candidates.length,
  });
  saveState(state, stateFile);

  return { success: true, dependencies: candidates, total: candidates.length };
}

/**
 * Create an upgrade plan.
 */
export function createUpgradePlan(
  plan: PlanInput,
  options: StateFileOption = {}
): CreatePlanResult {
  if (!plan?.name) return { success: false, error: 'plan.name is required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const upgradePlan: UpgradePlan = {
    id: `UPG-${(state.upgrade_plans.length + 1).toString().padStart(3, '0')}`,
    name: plan.name,
    upgrades: (plan.upgrades || []).map((u) => ({
      package: u.package || u.name || '',
      from: u.from || u.current_version || '',
      to: u.to || u.target_version || '',
      type: u.type || 'minor',
      risk: (u.type && RISK_BY_TYPE[u.type as UpgradeType]) || 'medium',
      status: 'planned',
      test_result: null,
    })),
    status: 'draft',
    created_at: new Date().toISOString(),
  };

  state.upgrade_plans.push(upgradePlan);
  saveState(state, stateFile);

  return { success: true, plan: upgradePlan };
}

/**
 * Generate upgrade report.
 */
export function generateReport(options: StateFileOption = {}): ReportResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    total_plans: state.upgrade_plans.length,
    total_scans: state.scans.length,
    plans: state.upgrade_plans,
    last_scan: state.scans.length > 0 ? state.scans[state.scans.length - 1] : null,
  };
}
