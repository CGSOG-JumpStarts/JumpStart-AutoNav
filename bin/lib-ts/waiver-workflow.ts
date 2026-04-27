/**
 * waiver-workflow.ts — exception & waiver workflow port (T4.4.2, cluster I).
 *
 * Pure-library port of `bin/lib/waiver-workflow.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `defaultState()`, `loadState(stateFile?)`, `saveState(state, stateFile?)`
 *   - `requestWaiver(request, options?)` => RequestResult
 *   - `resolveWaiver(waiverId, action, options?)` => ResolveResult
 *   - `expireWaivers(options?)` => ExpireResult
 *   - `listWaivers(filter?, options?)` => ListResult
 *   - `WAIVER_STATUSES`, `WAIVER_CATEGORIES`
 *
 * Behavior parity:
 *   - Default state path: `.jumpstart/state/waivers.json`.
 *   - Default expiration: 90 days.
 *   - M3 hardening: shape-validated JSON; rejects __proto__.
 *
 * @see bin/lib/waiver-workflow.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.2
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DEFAULT_STATE_FILE = join('.jumpstart', 'state', 'waivers.json');

export const WAIVER_STATUSES = ['pending', 'approved', 'rejected', 'expired', 'revoked'] as const;
export const WAIVER_CATEGORIES = [
  'security',
  'architecture',
  'compliance',
  'performance',
  'testing',
  'documentation',
  'other',
] as const;

export interface Waiver {
  id: string;
  title: string;
  category: string;
  justification: string;
  owner: string;
  status: string;
  requested_at: string;
  expires_at: string;
  approved_by: string | null;
  approved_at: string | null;
  conditions: string[];
  affected_artifacts: string[];
}

export interface WaiverState {
  version: string;
  created_at: string;
  last_updated: string | null;
  waivers: Waiver[];
}

export interface WaiverRequest {
  title?: string;
  category?: string;
  justification?: string;
  owner?: string;
  expires_in_days?: number;
  conditions?: string[];
  affected_artifacts?: string[];
}

export interface WaiverFilter {
  status?: string;
  category?: string;
  owner?: string;
}

export interface StateOptions {
  stateFile?: string;
  approver?: string;
}

export interface RequestResult {
  success: boolean;
  waiver?: Waiver;
  error?: string;
}

export interface ResolveResult {
  success: boolean;
  waiver?: Waiver;
  error?: string;
}

export interface ExpireResult {
  success: true;
  expired: number;
  total_waivers: number;
}

export interface ListResult {
  success: true;
  waivers: Waiver[];
  total: number;
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function safeParseState(raw: string): WaiverState | null {
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
  const data = parsed as Partial<WaiverState>;
  return {
    version: typeof data.version === 'string' ? data.version : '1.0.0',
    created_at: typeof data.created_at === 'string' ? data.created_at : new Date().toISOString(),
    last_updated: typeof data.last_updated === 'string' ? data.last_updated : null,
    waivers: Array.isArray(data.waivers) ? (data.waivers as Waiver[]) : [],
  };
}

export function defaultState(): WaiverState {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    waivers: [],
  };
}

export function loadState(stateFile?: string): WaiverState {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  if (!existsSync(filePath)) return defaultState();
  const parsed = safeParseState(readFileSync(filePath, 'utf8'));
  return parsed ?? defaultState();
}

export function saveState(state: WaiverState, stateFile?: string): void {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function requestWaiver(request: WaiverRequest, options: StateOptions = {}): RequestResult {
  if (!request?.title || !request.justification || !request.owner) {
    return { success: false, error: 'title, justification, and owner are required' };
  }

  const category = (request.category || 'other').toLowerCase();
  if (!(WAIVER_CATEGORIES as readonly string[]).includes(category)) {
    return {
      success: false,
      error: `Invalid category. Must be one of: ${WAIVER_CATEGORIES.join(', ')}`,
    };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const expiresInDays = request.expires_in_days || 90;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiresInDays);

  const waiver: Waiver = {
    id: `WVR-${Date.now().toString(36).toUpperCase()}`,
    title: request.title,
    category,
    justification: request.justification,
    owner: request.owner,
    status: 'pending',
    requested_at: new Date().toISOString(),
    expires_at: expiresAt.toISOString(),
    approved_by: null,
    approved_at: null,
    conditions: request.conditions || [],
    affected_artifacts: request.affected_artifacts || [],
  };

  state.waivers.push(waiver);
  saveState(state, stateFile);

  return { success: true, waiver };
}

export function resolveWaiver(
  waiverId: string,
  action: string,
  options: StateOptions = {}
): ResolveResult {
  if (!['approve', 'reject'].includes(action)) {
    return { success: false, error: 'action must be "approve" or "reject"' };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const waiver = state.waivers.find((w) => w.id === waiverId);
  if (!waiver) return { success: false, error: `Waiver not found: ${waiverId}` };
  if (waiver.status !== 'pending') {
    return { success: false, error: `Waiver is already ${waiver.status}` };
  }

  waiver.status = action === 'approve' ? 'approved' : 'rejected';
  waiver.approved_by = options.approver || null;
  waiver.approved_at = new Date().toISOString();

  saveState(state, stateFile);
  return { success: true, waiver };
}

export function expireWaivers(options: StateOptions = {}): ExpireResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);
  const now = new Date();
  let expired = 0;

  for (const waiver of state.waivers) {
    if (waiver.status === 'approved' && new Date(waiver.expires_at) < now) {
      waiver.status = 'expired';
      expired++;
    }
  }

  saveState(state, stateFile);
  return { success: true, expired, total_waivers: state.waivers.length };
}

export function listWaivers(filter: WaiverFilter = {}, options: StateOptions = {}): ListResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);
  let waivers = state.waivers;

  if (filter.status) waivers = waivers.filter((w) => w.status === filter.status);
  if (filter.category) waivers = waivers.filter((w) => w.category === filter.category);
  if (filter.owner) waivers = waivers.filter((w) => w.owner === filter.owner);

  return { success: true, waivers, total: waivers.length };
}
