/**
 * design-system.ts — Design System Integration port (T4.4.3, cluster L).
 *
 * Pure-library port of `bin/lib/design-system.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `TOKEN_CATEGORIES` (constant array)
 *   - `ACCESSIBILITY_LEVELS` (constant array)
 *   - `defaultState()` / `loadState()` / `saveState()`
 *   - `registerTokens(category, tokens, options?)` => RegisterTokensResult
 *   - `registerComponent(name, spec, options?)` => RegisterComponentResult
 *   - `checkCompliance(options?)` => ComplianceResult
 *   - `generateReport(options?)` => ReportResult
 *
 * Behavior parity:
 *   - Default state path: `.jumpstart/state/design-system.json`.
 *   - Default a11y level: AA.
 *   - JSON parse failures load defaults silently.
 *   - JSON shape validation rejects `__proto__` / `constructor` / `prototype`.
 *
 * @see bin/lib/design-system.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.3
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type TokenCategory =
  | 'color'
  | 'typography'
  | 'spacing'
  | 'elevation'
  | 'breakpoint'
  | 'motion';

export type AccessibilityLevel = 'A' | 'AA' | 'AAA';

export interface ComponentSpec {
  props?: unknown[];
  accessibility?: string[];
  tokens_used?: string[];
}

export interface RegisteredComponent {
  name: string;
  props: unknown[];
  accessibility: string[];
  tokens_used: string[];
  registered_at: string;
}

export interface DesignSystemState {
  version: string;
  tokens: Record<string, Record<string, unknown>>;
  components: RegisteredComponent[];
  accessibility: { level: string };
  brand: Record<string, unknown>;
  last_updated: string | null;
}

export interface ComplianceIssue {
  type: string;
  category?: string;
  component?: string;
  severity: string;
}

export interface RegisterTokensResult {
  success: boolean;
  category?: string;
  token_count?: number;
  error?: string;
}

export interface RegisterComponentResult {
  success: boolean;
  component?: RegisteredComponent;
  error?: string;
}

export interface ComplianceResult {
  success: boolean;
  compliant: boolean;
  issues: ComplianceIssue[];
  token_categories: number;
  components: number;
  accessibility_level: string;
}

export interface ReportResult {
  success: boolean;
  tokens: Record<string, number>;
  components: number;
  accessibility_level: string;
  brand: Record<string, unknown>;
}

export interface StateOptions {
  stateFile?: string;
}

const DEFAULT_STATE_FILE = join('.jumpstart', 'state', 'design-system.json');

export const TOKEN_CATEGORIES: TokenCategory[] = [
  'color',
  'typography',
  'spacing',
  'elevation',
  'breakpoint',
  'motion',
];

export const ACCESSIBILITY_LEVELS: AccessibilityLevel[] = ['A', 'AA', 'AAA'];

export function defaultState(): DesignSystemState {
  return {
    version: '1.0.0',
    tokens: {},
    components: [],
    accessibility: { level: 'AA' },
    brand: {},
    last_updated: null,
  };
}

function _safeParseState(content: string): DesignSystemState | null {
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
    tokens:
      obj.tokens && typeof obj.tokens === 'object' && !Array.isArray(obj.tokens)
        ? (obj.tokens as Record<string, Record<string, unknown>>)
        : {},
    components: Array.isArray(obj.components) ? (obj.components as RegisteredComponent[]) : [],
    accessibility:
      obj.accessibility &&
      typeof obj.accessibility === 'object' &&
      !Array.isArray(obj.accessibility)
        ? (obj.accessibility as { level: string })
        : { level: 'AA' },
    brand:
      obj.brand && typeof obj.brand === 'object' && !Array.isArray(obj.brand)
        ? (obj.brand as Record<string, unknown>)
        : {},
  };
}

export function loadState(stateFile?: string): DesignSystemState {
  const fp = stateFile || DEFAULT_STATE_FILE;
  if (!existsSync(fp)) return defaultState();
  const parsed = _safeParseState(readFileSync(fp, 'utf8'));
  return parsed || defaultState();
}

export function saveState(state: DesignSystemState, stateFile?: string): void {
  const fp = stateFile || DEFAULT_STATE_FILE;
  const dir = dirname(fp);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  writeFileSync(fp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/**
 * Register design tokens.
 */
export function registerTokens(
  category: string,
  tokens: Record<string, unknown>,
  options: StateOptions = {}
): RegisterTokensResult {
  if (!category || !tokens) return { success: false, error: 'category and tokens are required' };
  if (!TOKEN_CATEGORIES.includes(category as TokenCategory)) {
    return {
      success: false,
      error: `Unknown category: ${category}. Valid: ${TOKEN_CATEGORIES.join(', ')}`,
    };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);
  state.tokens[category] = tokens;
  saveState(state, stateFile);

  return { success: true, category, token_count: Object.keys(tokens).length };
}

/**
 * Register a component.
 */
export function registerComponent(
  name: string,
  spec: ComponentSpec,
  options: StateOptions = {}
): RegisterComponentResult {
  if (!name) return { success: false, error: 'Component name is required' };

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const component: RegisteredComponent = {
    name,
    props: spec.props || [],
    accessibility: spec.accessibility || [],
    tokens_used: spec.tokens_used || [],
    registered_at: new Date().toISOString(),
  };

  state.components.push(component);
  saveState(state, stateFile);

  return { success: true, component };
}

/**
 * Check design system compliance.
 */
export function checkCompliance(options: StateOptions = {}): ComplianceResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const issues: ComplianceIssue[] = [];
  const tokenCategories = Object.keys(state.tokens);

  for (const required of ['color', 'typography', 'spacing']) {
    if (!tokenCategories.includes(required)) {
      issues.push({ type: 'missing_tokens', category: required, severity: 'warning' });
    }
  }

  for (const comp of state.components) {
    if (!comp.accessibility || comp.accessibility.length === 0) {
      issues.push({ type: 'missing_accessibility', component: comp.name, severity: 'warning' });
    }
  }

  return {
    success: true,
    compliant: issues.length === 0,
    issues,
    token_categories: tokenCategories.length,
    components: state.components.length,
    accessibility_level: state.accessibility.level,
  };
}

/**
 * Generate design system report.
 */
export function generateReport(options: StateOptions = {}): ReportResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    tokens: Object.fromEntries(
      Object.entries(state.tokens).map(([k, v]) => [k, Object.keys(v).length])
    ),
    components: state.components.length,
    accessibility_level: state.accessibility.level,
    brand: state.brand,
  };
}
