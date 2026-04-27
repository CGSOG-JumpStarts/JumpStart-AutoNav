/**
 * domain-ontology.ts — Domain Ontology Support port (T4.4.3, cluster L).
 *
 * Pure-library port of `bin/lib/domain-ontology.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `ELEMENT_TYPES` (constant array)
 *   - `defaultState()` => OntologyState
 *   - `loadState(stateFile?)` => OntologyState
 *   - `saveState(state, stateFile?)` => void
 *   - `defineElement(domain, name, type, options?)` => DefineResult
 *   - `queryOntology(domain, options?)` => QueryResult
 *   - `validateTermUsage(domain, text, options?)` => ValidateResult
 *   - `generateReport(options?)` => ReportResult
 *
 * Behavior parity:
 *   - Default state file: `.jumpstart/state/domain-ontology.json`.
 *   - Element types: entity / event / command / value-object / aggregate /
 *     constraint.
 *   - Levenshtein-based near-miss detection for validateTermUsage.
 *   - JSON parse failures load defaults silently.
 *   - JSON shape validation rejects `__proto__` / `constructor` / `prototype`.
 *   - CLI entry-point intentionally omitted.
 *
 * @see bin/lib/domain-ontology.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.3
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type ElementType =
  | 'entity'
  | 'event'
  | 'command'
  | 'value-object'
  | 'aggregate'
  | 'constraint';

export interface OntologyElement {
  id: string;
  name: string;
  type: string;
  description: string;
  properties: unknown[];
  constraints: unknown[];
  created_at: string;
}

export interface OntologyDomain {
  elements: OntologyElement[];
  relationships: unknown[];
}

export interface OntologyState {
  version: string;
  domains: Record<string, OntologyDomain>;
  last_updated: string | null;
}

export interface DefineOptions {
  stateFile?: string;
  description?: string;
  properties?: unknown[];
  constraints?: unknown[];
  [key: string]: unknown;
}

export interface QueryOptions {
  stateFile?: string;
  type?: string;
  [key: string]: unknown;
}

export interface ValidateOptions {
  stateFile?: string;
  [key: string]: unknown;
}

export interface ReportOptions {
  stateFile?: string;
  [key: string]: unknown;
}

export interface DefineResult {
  success: boolean;
  element?: OntologyElement;
  error?: string;
}

export interface QueryResult {
  success: boolean;
  domain: string;
  elements: OntologyElement[];
  total: number;
}

export interface ValidationIssue {
  type: string;
  canonical: string;
  severity: string;
}

export interface ValidateResult {
  success: boolean;
  domain?: string;
  issues?: ValidationIssue[];
  canonical_terms?: number;
  error?: string;
}

export interface DomainReport {
  total_elements: number;
  by_type: Record<string, number>;
}

export interface ReportResult {
  success: boolean;
  total_domains: number;
  domains: Record<string, DomainReport>;
}

const DEFAULT_STATE_FILE = join('.jumpstart', 'state', 'domain-ontology.json');

export const ELEMENT_TYPES: ElementType[] = [
  'entity',
  'event',
  'command',
  'value-object',
  'aggregate',
  'constraint',
];

export function defaultState(): OntologyState {
  return { version: '1.0.0', domains: {}, last_updated: null };
}

function _safeParseState(content: string): OntologyState | null {
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
  const domains =
    obj.domains && typeof obj.domains === 'object' && !Array.isArray(obj.domains)
      ? (obj.domains as Record<string, OntologyDomain>)
      : {};
  return {
    ...base,
    ...obj,
    domains,
  };
}

export function loadState(stateFile?: string): OntologyState {
  const fp = stateFile || DEFAULT_STATE_FILE;
  if (!existsSync(fp)) return defaultState();
  const parsed = _safeParseState(readFileSync(fp, 'utf8'));
  return parsed || defaultState();
}

export function saveState(state: OntologyState, stateFile?: string): void {
  const fp = stateFile || DEFAULT_STATE_FILE;
  const dir = dirname(fp);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  writeFileSync(fp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function defineElement(
  domain: string,
  name: string,
  type: string,
  options: DefineOptions = {}
): DefineResult {
  if (!domain || !name || !type) {
    return { success: false, error: 'domain, name, and type are required' };
  }
  if (!ELEMENT_TYPES.includes(type as ElementType)) {
    return {
      success: false,
      error: `Unknown type: ${type}. Valid: ${ELEMENT_TYPES.join(', ')}`,
    };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  if (!state.domains[domain]) state.domains[domain] = { elements: [], relationships: [] };

  const element: OntologyElement = {
    id: `ONT-${Date.now()}`,
    name,
    type,
    description: options.description || '',
    properties: options.properties || [],
    constraints: options.constraints || [],
    created_at: new Date().toISOString(),
  };

  state.domains[domain].elements.push(element);
  saveState(state, stateFile);

  return { success: true, element };
}

export function queryOntology(domain: string, options: QueryOptions = {}): QueryResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  if (!state.domains[domain]) return { success: true, domain, elements: [], total: 0 };

  let elements = state.domains[domain].elements;
  if (options.type) elements = elements.filter((e) => e.type === options.type);

  return { success: true, domain, elements, total: elements.length };
}

export function validateTermUsage(
  domain: string,
  text: string,
  options: ValidateOptions = {}
): ValidateResult {
  if (!domain || !text) return { success: false, error: 'domain and text are required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const domainData = state.domains[domain];
  if (!domainData) return { success: true, domain, issues: [], canonical_terms: 0 };

  const canonicalNames = domainData.elements.map((e) => e.name.toLowerCase());
  const issues: ValidationIssue[] = [];

  const words = text.toLowerCase().split(/\W+/);
  for (const name of canonicalNames) {
    const nameWords = name.split(/\s+/);
    for (const nw of nameWords) {
      if (
        nw.length > 3 &&
        words.some((w) => w !== nw && levenshtein(w, nw) <= 2 && levenshtein(w, nw) > 0)
      ) {
        issues.push({ type: 'possible_typo', canonical: name, severity: 'warning' });
      }
    }
  }

  return {
    success: true,
    domain,
    issues,
    canonical_terms: canonicalNames.length,
  };
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

export function generateReport(options: ReportOptions = {}): ReportResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const domains = Object.keys(state.domains);
  const report: ReportResult = { success: true, total_domains: domains.length, domains: {} };

  for (const d of domains) {
    const elements = state.domains[d].elements;
    const byType: Record<string, number> = {};
    for (const e of elements) byType[e.type] = (byType[e.type] || 0) + 1;
    report.domains[d] = { total_elements: elements.length, by_type: byType };
  }

  return report;
}
