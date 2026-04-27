/**
 * policy-engine.ts — enterprise policy engine port (T4.4.2, cluster I).
 *
 * Pure-library port of `bin/lib/policy-engine.js`. Public surface
 * preserved verbatim:
 *
 *   - `loadPolicies(policyFile?)` => Policies
 *   - `savePolicies(policies, policyFile?)` => void
 *   - `defaultPolicies()` => Policies
 *   - `addPolicy(rule, options?)` => AddPolicyResult
 *   - `checkPolicies(root, options?)` => CheckResult
 *   - `listPolicies(filter?, options?)` => ListResult
 *   - `POLICY_CATEGORIES`, `SEVERITY_LEVELS`
 *
 * Behavior parity:
 *   - Default policy file: `.jumpstart/policies.json`.
 *   - 7 categories, 3 severity levels.
 *   - File walker uses `String.matchAll` (not stateful regex.exec).
 *   - M3 hardening: shape-validated JSON; rejects __proto__.
 *
 * @see bin/lib/policy-engine.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.2
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const DEFAULT_POLICY_FILE = join('.jumpstart', 'policies.json');

export const POLICY_CATEGORIES = [
  'architecture',
  'naming',
  'security',
  'legal',
  'ai',
  'deployment',
  'other',
] as const;

export const SEVERITY_LEVELS = ['error', 'warning', 'info'] as const;

export interface PolicyRule {
  id: string;
  category: string;
  name: string;
  description: string;
  pattern: string | null;
  severity: string;
  applies_to: string[];
  enabled: boolean;
  created_at: string;
}

export interface Policies {
  version: string;
  created_at: string;
  last_updated: string | null;
  policies: PolicyRule[];
}

export interface PolicyRuleInput {
  id?: string;
  category?: string;
  name?: string;
  description?: string;
  pattern?: string;
  severity?: string;
  applies_to?: string[];
  enabled?: boolean;
}

export interface PolicyFilter {
  category?: string;
  severity?: string;
  enabled?: boolean;
}

export interface StateOptions {
  policyFile?: string;
}

export interface AddPolicyResult {
  success: boolean;
  policy?: PolicyRule;
  total?: number;
  error?: string;
}

export interface PolicyViolation {
  policy_id: string;
  policy_name: string;
  category: string;
  severity: string;
  file: string;
  matched: string;
  description: string;
}

export interface CheckResult {
  success: true;
  passed: boolean;
  violations: PolicyViolation[];
  warnings: PolicyViolation[];
  infos: PolicyViolation[];
  summary: {
    total_policies_checked: number;
    violations: number;
    warnings: number;
    infos: number;
    passed: boolean;
  };
}

export interface ListResult {
  success: true;
  policies: PolicyRule[];
  total: number;
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function safeParseState(raw: string): Policies | null {
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
  const data = parsed as Partial<Policies>;
  return {
    version: typeof data.version === 'string' ? data.version : '1.0.0',
    created_at: typeof data.created_at === 'string' ? data.created_at : new Date().toISOString(),
    last_updated: typeof data.last_updated === 'string' ? data.last_updated : null,
    policies: Array.isArray(data.policies) ? (data.policies as PolicyRule[]) : [],
  };
}

export function defaultPolicies(): Policies {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    policies: [],
  };
}

export function loadPolicies(policyFile?: string): Policies {
  const filePath = policyFile || DEFAULT_POLICY_FILE;
  if (!existsSync(filePath)) return defaultPolicies();
  const parsed = safeParseState(readFileSync(filePath, 'utf8'));
  return parsed ?? defaultPolicies();
}

export function savePolicies(policies: Policies, policyFile?: string): void {
  const filePath = policyFile || DEFAULT_POLICY_FILE;
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  policies.last_updated = new Date().toISOString();
  writeFileSync(filePath, `${JSON.stringify(policies, null, 2)}\n`, 'utf8');
}

export function addPolicy(rule: PolicyRuleInput, options: StateOptions = {}): AddPolicyResult {
  if (!rule?.name || !rule.description) {
    return { success: false, error: 'rule.name and rule.description are required' };
  }

  const category = (rule.category || 'other').toLowerCase();
  if (!(POLICY_CATEGORIES as readonly string[]).includes(category)) {
    return { success: false, error: `category must be one of: ${POLICY_CATEGORIES.join(', ')}` };
  }

  const severity = (rule.severity || 'warning').toLowerCase();
  if (!(SEVERITY_LEVELS as readonly string[]).includes(severity)) {
    return { success: false, error: `severity must be one of: ${SEVERITY_LEVELS.join(', ')}` };
  }

  const policyFile = options.policyFile || DEFAULT_POLICY_FILE;
  const policies = loadPolicies(policyFile);

  const id = rule.id || `policy-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const existing = policies.policies.find((p) => p.id === id);
  if (existing) {
    return { success: false, error: `Policy with id "${id}" already exists` };
  }

  const newRule: PolicyRule = {
    id,
    category,
    name: rule.name.trim(),
    description: rule.description.trim(),
    pattern: rule.pattern || null,
    severity,
    applies_to: rule.applies_to || ['specs', 'src'],
    enabled: rule.enabled !== false,
    created_at: new Date().toISOString(),
  };

  policies.policies.push(newRule);
  savePolicies(policies, policyFile);

  return { success: true, policy: newRule, total: policies.policies.length };
}

export function checkPolicies(root: string, options: StateOptions = {}): CheckResult {
  const policyFile = options.policyFile || join(root, DEFAULT_POLICY_FILE);
  const policies = loadPolicies(policyFile);

  const violations: PolicyViolation[] = [];
  const warnings: PolicyViolation[] = [];
  const infos: PolicyViolation[] = [];

  const enabledPolicies = policies.policies.filter((p) => p.enabled !== false);

  for (const policy of enabledPolicies) {
    if (!policy.pattern) continue;

    let pattern: RegExp;
    try {
      pattern = new RegExp(policy.pattern, 'gi');
    } catch {
      continue;
    }

    const dirsToCheck = policy.applies_to || [];
    for (const dir of dirsToCheck) {
      const absDir = join(root, dir);
      if (!existsSync(absDir)) continue;

      const walk = (d: string): void => {
        for (const entry of readdirSync(d, { withFileTypes: true })) {
          const full = join(d, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else if (entry.isFile()) {
            try {
              const content = readFileSync(full, 'utf8');
              const rel = relative(root, full).replace(/\\/g, '/');
              for (const match of content.matchAll(pattern)) {
                const violation: PolicyViolation = {
                  policy_id: policy.id,
                  policy_name: policy.name,
                  category: policy.category,
                  severity: policy.severity,
                  file: rel,
                  matched: match[0],
                  description: policy.description,
                };
                if (policy.severity === 'error') {
                  violations.push(violation);
                } else if (policy.severity === 'warning') {
                  warnings.push(violation);
                } else {
                  infos.push(violation);
                }
              }
            } catch {
              // skip unreadable files
            }
          }
        }
      };
      walk(absDir);
    }
  }

  const passed = violations.length === 0;

  return {
    success: true,
    passed,
    violations,
    warnings,
    infos,
    summary: {
      total_policies_checked: enabledPolicies.length,
      violations: violations.length,
      warnings: warnings.length,
      infos: infos.length,
      passed,
    },
  };
}

export function listPolicies(filter: PolicyFilter = {}, options: StateOptions = {}): ListResult {
  const policyFile = options.policyFile || DEFAULT_POLICY_FILE;
  const policies = loadPolicies(policyFile);

  let entries = policies.policies;

  if (filter.category) {
    entries = entries.filter((p) => p.category === filter.category);
  }
  if (filter.severity) {
    entries = entries.filter((p) => p.severity === filter.severity);
  }
  if (filter.enabled !== undefined) {
    const wantEnabled = filter.enabled;
    entries = entries.filter((p) => (p.enabled !== false) === wantEnabled);
  }

  return { success: true, policies: entries, total: entries.length };
}
