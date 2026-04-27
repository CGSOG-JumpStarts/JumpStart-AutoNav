/**
 * data-classification.ts — data classification & handling controls port (T4.4.2, cluster I).
 *
 * Pure-library port of `bin/lib/data-classification.js`. Public surface
 * preserved verbatim:
 *
 *   - `defaultState()`, `loadState(stateFile?)`, `saveState(state, stateFile?)`
 *   - `classifyAsset(asset, options?)` => ClassifyResult
 *   - `checkCompliance(options?)` => ComplianceCheck
 *   - `generateReport(options?)` => ClassificationReport
 *   - `CLASSIFICATION_LEVELS`, `HANDLING_REQUIREMENTS`, `DATA_TYPE_DEFAULTS`
 *
 * Behavior parity:
 *   - Default state path: `.jumpstart/state/data-classification.json`.
 *   - 4 levels (public/internal/confidential/restricted) preserved verbatim.
 *   - Per-level handling requirements preserved verbatim.
 *   - M3 hardening: shape-validated JSON; rejects __proto__.
 *   - ADR-012: redacts asset fields before persistence to prevent
 *     classification descriptions accidentally embedding secrets.
 *
 * @see bin/lib/data-classification.js (legacy reference)
 * @see bin/lib-ts/secret-scanner.ts (redaction)
 * @see specs/implementation-plan.md T4.4.2
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { redactSecrets } from './secret-scanner.js';

const DEFAULT_STATE_FILE = join('.jumpstart', 'state', 'data-classification.json');

export const CLASSIFICATION_LEVELS = ['public', 'internal', 'confidential', 'restricted'] as const;

export interface HandlingRequirements {
  encryption_at_rest: boolean;
  encryption_in_transit: boolean;
  access_logging: boolean;
  retention_policy: boolean;
  mfa_required?: boolean;
  data_masking?: boolean;
}

export const HANDLING_REQUIREMENTS: Record<string, HandlingRequirements> = {
  public: {
    encryption_at_rest: false,
    encryption_in_transit: false,
    access_logging: false,
    retention_policy: false,
  },
  internal: {
    encryption_at_rest: false,
    encryption_in_transit: true,
    access_logging: false,
    retention_policy: true,
  },
  confidential: {
    encryption_at_rest: true,
    encryption_in_transit: true,
    access_logging: true,
    retention_policy: true,
  },
  restricted: {
    encryption_at_rest: true,
    encryption_in_transit: true,
    access_logging: true,
    retention_policy: true,
    mfa_required: true,
    data_masking: true,
  },
};

export const DATA_TYPE_DEFAULTS: Record<string, string> = {
  PII: 'confidential',
  PHI: 'restricted',
  PCI: 'restricted',
  credentials: 'restricted',
  'business-sensitive': 'confidential',
  'public-content': 'public',
  'internal-docs': 'internal',
};

export interface DataAsset {
  id: string;
  name: string;
  type: string;
  data_types: string[];
  classification: string;
  handling: HandlingRequirements;
  description: string;
  classified_at: string;
  encryption_at_rest_verified?: boolean;
  encryption_in_transit_verified?: boolean;
}

export interface DataClassificationState {
  version: string;
  created_at: string;
  last_updated: string | null;
  classifications: unknown[];
  data_assets: DataAsset[];
}

export interface AssetInput {
  name?: string;
  type?: string;
  data_types?: string[];
  classification?: string;
  description?: string;
}

export interface StateOptions {
  stateFile?: string;
}

export interface ClassifyResult {
  success: boolean;
  asset?: DataAsset;
  error?: string;
}

export interface ComplianceFinding {
  asset: string;
  requirement: string;
  classification: string;
}

export interface ComplianceCheck {
  success: true;
  total_assets: number;
  violations: number;
  compliant: boolean;
  findings: ComplianceFinding[];
}

export interface ClassificationReport {
  success: true;
  total_assets: number;
  by_level: Record<string, number>;
  restricted_assets: DataAsset[];
  confidential_assets: DataAsset[];
  assets: DataAsset[];
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function safeParseState(raw: string): DataClassificationState | null {
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
  const data = parsed as Partial<DataClassificationState>;
  return {
    version: typeof data.version === 'string' ? data.version : '1.0.0',
    created_at: typeof data.created_at === 'string' ? data.created_at : new Date().toISOString(),
    last_updated: typeof data.last_updated === 'string' ? data.last_updated : null,
    classifications: Array.isArray(data.classifications) ? data.classifications : [],
    data_assets: Array.isArray(data.data_assets) ? (data.data_assets as DataAsset[]) : [],
  };
}

export function defaultState(): DataClassificationState {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    classifications: [],
    data_assets: [],
  };
}

export function loadState(stateFile?: string): DataClassificationState {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  if (!existsSync(filePath)) return defaultState();
  const parsed = safeParseState(readFileSync(filePath, 'utf8'));
  return parsed ?? defaultState();
}

export function saveState(state: DataClassificationState, stateFile?: string): void {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function classifyAsset(asset: AssetInput, options: StateOptions = {}): ClassifyResult {
  if (!asset?.name) {
    return { success: false, error: 'asset.name is required' };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  let level: string = 'public';
  const dataTypes = asset.data_types || [];
  for (const dt of dataTypes) {
    const defaultLevel = DATA_TYPE_DEFAULTS[dt];
    if (defaultLevel) {
      const idx = (CLASSIFICATION_LEVELS as readonly string[]).indexOf(defaultLevel);
      const currentIdx = (CLASSIFICATION_LEVELS as readonly string[]).indexOf(level);
      if (idx > currentIdx) level = defaultLevel;
    }
  }

  if (
    asset.classification &&
    (CLASSIFICATION_LEVELS as readonly string[]).includes(asset.classification)
  ) {
    level = asset.classification;
  }

  const classification: DataAsset = {
    id: `DC-${(state.data_assets.length + 1).toString().padStart(3, '0')}`,
    name: asset.name,
    type: asset.type || 'system',
    data_types: dataTypes,
    classification: level,
    handling: HANDLING_REQUIREMENTS[level],
    description: asset.description || '',
    classified_at: new Date().toISOString(),
  };

  // ADR-012: redact user-supplied fields before persistence to disk so
  // accidentally-embedded secrets in `description` / `name` / `data_types`
  // never leak through `.jumpstart/state/data-classification.json`.
  const redacted = redactSecrets(classification);

  state.data_assets.push(redacted);
  saveState(state, stateFile);

  return { success: true, asset: redacted };
}

export function checkCompliance(options: StateOptions = {}): ComplianceCheck {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const violations: ComplianceFinding[] = [];
  for (const asset of state.data_assets) {
    const requirements = HANDLING_REQUIREMENTS[asset.classification];
    if (!requirements) continue;

    if (requirements.encryption_at_rest && !asset.encryption_at_rest_verified) {
      violations.push({
        asset: asset.name,
        requirement: 'encryption_at_rest',
        classification: asset.classification,
      });
    }
    if (requirements.encryption_in_transit && !asset.encryption_in_transit_verified) {
      violations.push({
        asset: asset.name,
        requirement: 'encryption_in_transit',
        classification: asset.classification,
      });
    }
  }

  return {
    success: true,
    total_assets: state.data_assets.length,
    violations: violations.length,
    compliant: violations.length === 0,
    findings: violations,
  };
}

export function generateReport(options: StateOptions = {}): ClassificationReport {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const byLevel: Record<string, number> = {};
  for (const level of CLASSIFICATION_LEVELS) {
    byLevel[level] = state.data_assets.filter((a) => a.classification === level).length;
  }

  return {
    success: true,
    total_assets: state.data_assets.length,
    by_level: byLevel,
    restricted_assets: state.data_assets.filter((a) => a.classification === 'restricted'),
    confidential_assets: state.data_assets.filter((a) => a.classification === 'confidential'),
    assets: state.data_assets,
  };
}
