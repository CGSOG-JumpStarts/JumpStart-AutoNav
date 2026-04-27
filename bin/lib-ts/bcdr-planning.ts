/**
 * bcdr-planning.ts — Business Continuity & DR Planning port (T4.4.3, cluster L).
 *
 * Pure-library port of `bin/lib/bcdr-planning.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `SERVICE_TIERS` (constant map)
 *   - `BCDR_COMPONENTS` (constant array)
 *   - `defaultState()` / `loadState()` / `saveState()`
 *   - `defineService(service, options?)` => DefineResult
 *   - `checkCoverage(root, options?)` => CoverageResult
 *   - `generateReport(options?)` => ReportResult
 *
 * Behavior parity:
 *   - Default state path: `.jumpstart/state/bcdr.json`.
 *   - Default tier when omitted: silver.
 *   - JSON parse failures load defaults silently.
 *   - JSON shape validation rejects `__proto__` / `constructor` / `prototype`.
 *
 * @see bin/lib/bcdr-planning.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.3
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type ServiceTier = 'platinum' | 'gold' | 'silver' | 'bronze';

export interface ServiceTierTemplate {
  rto_hours: number;
  rpo_hours: number;
  failover: string;
  backup_frequency: string;
}

export interface ServiceInput {
  name: string;
  tier?: string;
  rto_hours?: number;
  rpo_hours?: number;
  failover?: string;
  backup_frequency?: string;
  dependencies?: string[];
  recovery_procedures?: unknown[];
}

export interface BCDRService {
  id: string;
  name: string;
  tier: string;
  rto_hours: number;
  rpo_hours: number;
  failover: string;
  backup_frequency: string;
  dependencies: string[];
  recovery_procedures: unknown[];
  defined_at: string;
}

export interface BCDRState {
  version: string;
  created_at: string;
  last_updated: string | null;
  services: BCDRService[];
  dr_tests: unknown[];
}

export interface StateOptions {
  stateFile?: string;
}

export interface DefineResult {
  success: boolean;
  service?: BCDRService;
  error?: string;
}

export interface CoverageResult {
  success: boolean;
  coverage: number;
  components: Record<string, boolean>;
  gaps: string[];
  recommendations: string[];
}

export interface ReportResult {
  success: boolean;
  total_services: number;
  by_tier: Record<string, number>;
  services: BCDRService[];
  dr_tests: unknown[];
  lowest_rto: number | null;
  lowest_rpo: number | null;
}

const DEFAULT_STATE_FILE = join('.jumpstart', 'state', 'bcdr.json');

export const SERVICE_TIERS: Record<ServiceTier, ServiceTierTemplate> = {
  platinum: {
    rto_hours: 0.25,
    rpo_hours: 0,
    failover: 'automatic',
    backup_frequency: 'continuous',
  },
  gold: { rto_hours: 1, rpo_hours: 1, failover: 'automatic', backup_frequency: 'hourly' },
  silver: { rto_hours: 4, rpo_hours: 4, failover: 'manual', backup_frequency: 'daily' },
  bronze: { rto_hours: 24, rpo_hours: 24, failover: 'manual', backup_frequency: 'weekly' },
};

export const BCDR_COMPONENTS: string[] = [
  'rto-rpo',
  'failover-design',
  'backup-validation',
  'communication-plan',
  'recovery-procedures',
  'testing-schedule',
];

export function defaultState(): BCDRState {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    services: [],
    dr_tests: [],
  };
}

function _safeParseState(content: string): BCDRState | null {
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
    services: Array.isArray(obj.services) ? (obj.services as BCDRService[]) : [],
    dr_tests: Array.isArray(obj.dr_tests) ? obj.dr_tests : [],
  };
}

export function loadState(stateFile?: string): BCDRState {
  const fp = stateFile || DEFAULT_STATE_FILE;
  if (!existsSync(fp)) return defaultState();
  const parsed = _safeParseState(readFileSync(fp, 'utf8'));
  return parsed || defaultState();
}

export function saveState(state: BCDRState, stateFile?: string): void {
  const fp = stateFile || DEFAULT_STATE_FILE;
  const dir = dirname(fp);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  writeFileSync(fp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/**
 * Define BC/DR requirements for a service.
 */
export function defineService(service: ServiceInput, options: StateOptions = {}): DefineResult {
  if (!service?.name) return { success: false, error: 'service.name is required' };

  const tier = (service.tier || 'silver').toLowerCase();
  const template = SERVICE_TIERS[tier as ServiceTier];
  if (!template) {
    return {
      success: false,
      error: `Invalid tier. Must be one of: ${Object.keys(SERVICE_TIERS).join(', ')}`,
    };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const svc: BCDRService = {
    id: `SVC-${(state.services.length + 1).toString().padStart(3, '0')}`,
    name: service.name,
    tier,
    rto_hours: service.rto_hours ?? template.rto_hours,
    rpo_hours: service.rpo_hours ?? template.rpo_hours,
    failover: service.failover || template.failover,
    backup_frequency: service.backup_frequency || template.backup_frequency,
    dependencies: service.dependencies || [],
    recovery_procedures: service.recovery_procedures || [],
    defined_at: new Date().toISOString(),
  };

  state.services.push(svc);
  saveState(state, stateFile);

  return { success: true, service: svc };
}

/**
 * Check BC/DR coverage in specs.
 */
export function checkCoverage(root: string, _options: StateOptions = {}): CoverageResult {
  const archFile = join(root, 'specs', 'architecture.md');
  const findings: Record<string, boolean> = {};

  if (existsSync(archFile)) {
    try {
      const content = readFileSync(archFile, 'utf8');
      findings['rto-rpo'] = /\bRTO\b|\bRPO\b|recovery.time|recovery.point/i.test(content);
      findings['failover-design'] = /\bfailover\b|high.availability|redundan/i.test(content);
      findings['backup-validation'] = /\bbackup\b|snapshot|restore/i.test(content);
      findings['recovery-procedures'] = /\brecovery\b|disaster|DR\b/i.test(content);
    } catch {
      /* ignore */
    }
  }

  findings['communication-plan'] = false;
  findings['testing-schedule'] = false;

  const covered = Object.values(findings).filter(Boolean).length;
  const total = BCDR_COMPONENTS.length;

  return {
    success: true,
    coverage: Math.round((covered / total) * 100),
    components: findings,
    gaps: BCDR_COMPONENTS.filter((c) => !findings[c]),
    recommendations: BCDR_COMPONENTS.filter((c) => !findings[c]).map(
      (c) => `Add ${c} section to architecture spec`
    ),
  };
}

/**
 * Generate BCDR report.
 */
export function generateReport(options: StateOptions = {}): ReportResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    total_services: state.services.length,
    by_tier: state.services.reduce<Record<string, number>>((acc, s) => {
      acc[s.tier] = (acc[s.tier] || 0) + 1;
      return acc;
    }, {}),
    services: state.services,
    dr_tests: state.dr_tests,
    lowest_rto:
      state.services.length > 0 ? Math.min(...state.services.map((s) => s.rto_hours)) : null,
    lowest_rpo:
      state.services.length > 0 ? Math.min(...state.services.map((s) => s.rpo_hours)) : null,
  };
}
