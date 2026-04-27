/**
 * prompt-governance.ts — prompt and agent version governance port (T4.4.2, cluster I).
 *
 * Pure-library port of `bin/lib/prompt-governance.js`. Public surface
 * preserved verbatim:
 *
 *   - `registerAsset(name, type, content, options?)` => RegisterResult
 *   - `addVersion(assetId, content, version, options?)` => AddVersionResult
 *   - `approveVersion(assetId, version, options?)` => ApproveResult
 *   - `listAssets(options?)` => ListAssetsResult
 *   - `loadState(stateFile?)`, `saveState(state, stateFile?)`, `defaultState()`
 *   - `ASSET_TYPES`
 *
 * Behavior parity:
 *   - Default state path: `.jumpstart/state/prompt-governance.json`.
 *   - 4 asset types: prompt, persona, tool, workflow.
 *   - M3 hardening: shape-validated JSON; rejects __proto__.
 *
 * @see bin/lib/prompt-governance.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.2
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DEFAULT_STATE_FILE = join('.jumpstart', 'state', 'prompt-governance.json');

export const ASSET_TYPES = ['prompt', 'persona', 'tool', 'workflow'] as const;

export interface AssetVersion {
  version: string;
  content: string;
  approved: boolean;
  created_at: string;
  approved_at?: string;
  approved_by?: string;
}

export interface Asset {
  id: string;
  name: string;
  type: string;
  versions: AssetVersion[];
  current_version: string;
  created_at: string;
}

export interface PromptGovernanceState {
  version: string;
  assets: Asset[];
  last_updated: string | null;
}

export interface RegisterOptions {
  stateFile?: string;
}

export interface AddVersionOptions {
  stateFile?: string;
}

export interface ApproveOptions {
  stateFile?: string;
  approver?: string;
}

export interface ListAssetsOptions {
  stateFile?: string;
  type?: string;
}

export interface RegisterResult {
  success: boolean;
  asset?: { id: string; name: string; type: string; version: string };
  error?: string;
}

export interface AddVersionResult {
  success: boolean;
  asset_id?: string;
  version?: string;
  error?: string;
}

export interface ApproveResult {
  success: boolean;
  asset_id?: string;
  version?: string;
  approved?: boolean;
  error?: string;
}

export interface ListedAsset {
  id: string;
  name: string;
  type: string;
  current_version: string;
  versions_count: number;
  latest_approved: string | null;
}

export interface ListAssetsResult {
  success: true;
  total: number;
  assets: ListedAsset[];
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function safeParseState(raw: string): PromptGovernanceState | null {
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
  const data = parsed as Partial<PromptGovernanceState>;
  return {
    version: typeof data.version === 'string' ? data.version : '1.0.0',
    assets: Array.isArray(data.assets) ? (data.assets as Asset[]) : [],
    last_updated: typeof data.last_updated === 'string' ? data.last_updated : null,
  };
}

export function defaultState(): PromptGovernanceState {
  return { version: '1.0.0', assets: [], last_updated: null };
}

export function loadState(stateFile?: string): PromptGovernanceState {
  const fp = stateFile || DEFAULT_STATE_FILE;
  if (!existsSync(fp)) return defaultState();
  const parsed = safeParseState(readFileSync(fp, 'utf8'));
  return parsed ?? defaultState();
}

export function saveState(state: PromptGovernanceState, stateFile?: string): void {
  const fp = stateFile || DEFAULT_STATE_FILE;
  const dir = dirname(fp);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  writeFileSync(fp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function registerAsset(
  name: string,
  type: string,
  content: string,
  options: RegisterOptions = {}
): RegisterResult {
  if (!name || !type || !content) {
    return { success: false, error: 'name, type, and content are required' };
  }
  if (!(ASSET_TYPES as readonly string[]).includes(type)) {
    return { success: false, error: `Unknown type: ${type}. Valid: ${ASSET_TYPES.join(', ')}` };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const asset: Asset = {
    id: `PGOV-${Date.now()}`,
    name,
    type,
    versions: [
      {
        version: '1.0.0',
        content,
        approved: false,
        created_at: new Date().toISOString(),
      },
    ],
    current_version: '1.0.0',
    created_at: new Date().toISOString(),
  };

  state.assets.push(asset);
  saveState(state, stateFile);

  return {
    success: true,
    asset: { id: asset.id, name: asset.name, type: asset.type, version: asset.current_version },
  };
}

export function addVersion(
  assetId: string,
  content: string,
  version: string,
  options: AddVersionOptions = {}
): AddVersionResult {
  if (!assetId || !content || !version) {
    return { success: false, error: 'assetId, content, and version are required' };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const asset = state.assets.find((a) => a.id === assetId);
  if (!asset) return { success: false, error: `Asset ${assetId} not found` };

  asset.versions.push({
    version,
    content,
    approved: false,
    created_at: new Date().toISOString(),
  });
  asset.current_version = version;

  saveState(state, stateFile);

  return { success: true, asset_id: assetId, version };
}

export function approveVersion(
  assetId: string,
  version: string,
  options: ApproveOptions = {}
): ApproveResult {
  if (!assetId || !version) {
    return { success: false, error: 'assetId and version are required' };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const asset = state.assets.find((a) => a.id === assetId);
  if (!asset) return { success: false, error: `Asset ${assetId} not found` };

  const ver = asset.versions.find((v) => v.version === version);
  if (!ver) return { success: false, error: `Version ${version} not found` };

  ver.approved = true;
  ver.approved_at = new Date().toISOString();
  ver.approved_by = options.approver || 'system';

  saveState(state, stateFile);

  return { success: true, asset_id: assetId, version, approved: true };
}

export function listAssets(options: ListAssetsOptions = {}): ListAssetsResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  let assets = state.assets;
  if (options.type) {
    const wantType = options.type;
    assets = assets.filter((a) => a.type === wantType);
  }

  return {
    success: true,
    total: assets.length,
    assets: assets.map((a) => {
      const lastApproved = [...a.versions].reverse().find((v) => v.approved);
      return {
        id: a.id,
        name: a.name,
        type: a.type,
        current_version: a.current_version,
        versions_count: a.versions.length,
        latest_approved: lastApproved ? lastApproved.version : null,
      };
    }),
  };
}
