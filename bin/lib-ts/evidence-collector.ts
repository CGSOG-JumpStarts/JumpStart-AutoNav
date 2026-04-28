/**
 * evidence-collector.ts — evidence collection automation port (T4.4.2, cluster I).
 *
 * Pure-library port of `bin/lib/evidence-collector.js`. Public surface
 * preserved verbatim:
 *
 *   - `defaultState()`, `loadState(stateFile?)`, `saveState(state, stateFile?)`
 *   - `collectEvidence(root, options?)` => CollectResult
 *   - `packageEvidence(root, options?)` => PackageResult
 *   - `getStatus(options?)` => StatusResult
 *   - `EVIDENCE_TYPES`
 *
 * Behavior parity:
 *   - Default state path: `.jumpstart/state/evidence.json`.
 *   - Default output dir: `.jumpstart/evidence/`.
 *   - 9 evidence types preserved verbatim.
 *   - M3 hardening: shape-validated JSON; rejects __proto__.
 *
 * @see bin/lib/evidence-collector.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.2
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { redactSecrets } from './secret-scanner.js';

const DEFAULT_OUTPUT_DIR = join('.jumpstart', 'evidence');
const DEFAULT_STATE_FILE = join('.jumpstart', 'state', 'evidence.json');

export const EVIDENCE_TYPES = [
  'test-results',
  'approval-records',
  'policy-checks',
  'architecture-diagrams',
  'security-scans',
  'coverage-reports',
  'audit-logs',
  'screenshots',
  'compliance-checks',
] as const;

export interface EvidenceItem {
  type: string;
  source: string;
  collected_at: string;
}

export interface EvidenceCollection {
  id: string;
  collected_at: string;
  items_count: number;
  types: string[];
}

export interface EvidenceState {
  version: string;
  created_at: string;
  last_updated: string | null;
  collections: EvidenceCollection[];
  evidence_items: EvidenceItem[];
}

export interface StateOptions {
  stateFile?: string;
  outputDir?: string;
}

export interface CollectResult {
  success: true;
  items_collected: number;
  types: string[];
  collection_id: string;
}

export interface PackageManifest {
  package_id: string;
  created_at: string;
  project_root: string;
  total_items: number;
  types: string[];
  collections: number;
  items: EvidenceItem[];
}

export interface PackageResult {
  success: true;
  package_id: string;
  output: string;
  total_items: number;
  types: string[];
}

export interface StatusResult {
  success: true;
  total_items: number;
  collections: number;
  types: string[];
  last_collection: EvidenceCollection | null;
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function safeParseState(raw: string): EvidenceState | null {
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
  const data = parsed as Partial<EvidenceState>;
  return {
    version: typeof data.version === 'string' ? data.version : '1.0.0',
    created_at: typeof data.created_at === 'string' ? data.created_at : new Date().toISOString(),
    last_updated: typeof data.last_updated === 'string' ? data.last_updated : null,
    collections: Array.isArray(data.collections) ? (data.collections as EvidenceCollection[]) : [],
    evidence_items: Array.isArray(data.evidence_items)
      ? (data.evidence_items as EvidenceItem[])
      : [],
  };
}

export function defaultState(): EvidenceState {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    collections: [],
    evidence_items: [],
  };
}

export function loadState(stateFile?: string): EvidenceState {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  if (!existsSync(filePath)) return defaultState();
  const parsed = safeParseState(readFileSync(filePath, 'utf8'));
  return parsed ?? defaultState();
}

export function saveState(state: EvidenceState, stateFile?: string): void {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  // Pit Crew M5 Reviewer (HIGH): ADR-012 redaction missing in evidence-
  // collector audit trail. Evidence items can carry tool-call payloads,
  // CLI invocations, and config snapshots — any of which may contain
  // bearer tokens or API keys. Apply redactSecrets before persistence
  // so audit logs cannot leak credentials.
  const redacted = redactSecrets(state);
  writeFileSync(filePath, `${JSON.stringify(redacted, null, 2)}\n`, 'utf8');
}

export function collectEvidence(root: string, options: StateOptions = {}): CollectResult {
  const stateFile = options.stateFile || join(root, DEFAULT_STATE_FILE);
  const state = loadState(stateFile);
  const items: EvidenceItem[] = [];

  // Collect approval records
  const approvalFile = join(root, '.jumpstart', 'state', 'role-approvals.json');
  if (existsSync(approvalFile)) {
    items.push({
      type: 'approval-records',
      source: approvalFile,
      collected_at: new Date().toISOString(),
    });
  }

  // Collect policy check results
  const policyFile = join(root, '.jumpstart', 'policies.json');
  if (existsSync(policyFile)) {
    items.push({
      type: 'policy-checks',
      source: policyFile,
      collected_at: new Date().toISOString(),
    });
  }

  // Collect spec artifacts as architecture evidence
  const specsDir = join(root, 'specs');
  if (existsSync(specsDir)) {
    const specs = readdirSync(specsDir).filter((f) => f.endsWith('.md'));
    for (const spec of specs) {
      items.push({
        type: 'architecture-diagrams',
        source: join('specs', spec),
        collected_at: new Date().toISOString(),
      });
    }
  }

  // Collect test results if available
  const testDirs = ['tests', 'test', '__tests__'];
  for (const td of testDirs) {
    const testDir = join(root, td);
    if (existsSync(testDir)) {
      items.push({ type: 'test-results', source: td, collected_at: new Date().toISOString() });
      break;
    }
  }

  state.evidence_items.push(...items);
  state.collections.push({
    id: `ev-${Date.now()}`,
    collected_at: new Date().toISOString(),
    items_count: items.length,
    types: [...new Set(items.map((i) => i.type))],
  });

  saveState(state, stateFile);

  return {
    success: true,
    items_collected: items.length,
    types: [...new Set(items.map((i) => i.type))],
    collection_id: state.collections[state.collections.length - 1].id,
  };
}

export function packageEvidence(root: string, options: StateOptions = {}): PackageResult {
  const stateFile = options.stateFile || join(root, DEFAULT_STATE_FILE);
  const state = loadState(stateFile);
  const outputDir = options.outputDir || join(root, DEFAULT_OUTPUT_DIR);

  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const manifest: PackageManifest = {
    package_id: `audit-${Date.now()}`,
    created_at: new Date().toISOString(),
    project_root: root,
    total_items: state.evidence_items.length,
    types: [...new Set(state.evidence_items.map((i) => i.type))],
    collections: state.collections.length,
    items: state.evidence_items,
  };

  const manifestPath = join(outputDir, 'audit-manifest.json');
  // ADR-012: redact the audit manifest before persistence too.
  const redactedManifest = redactSecrets(manifest);
  writeFileSync(manifestPath, `${JSON.stringify(redactedManifest, null, 2)}\n`, 'utf8');

  return {
    success: true,
    package_id: manifest.package_id,
    output: manifestPath,
    total_items: manifest.total_items,
    types: manifest.types,
  };
}

export function getStatus(options: StateOptions = {}): StatusResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    total_items: state.evidence_items.length,
    collections: state.collections.length,
    types: [...new Set(state.evidence_items.map((i) => i.type))],
    last_collection:
      state.collections.length > 0 ? state.collections[state.collections.length - 1] : null,
  };
}
