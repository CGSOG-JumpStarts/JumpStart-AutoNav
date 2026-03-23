/**
 * policy-engine.js — Enterprise Policy Engine
 *
 * Enforces org-specific rules for architecture, naming, security,
 * legal, AI usage, and deployment standards.
 *
 * Policy file: .jumpstart/policies.json
 *
 * Usage:
 *   node bin/lib/policy-engine.js check|list|add [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_POLICY_FILE = path.join('.jumpstart', 'policies.json');

const POLICY_CATEGORIES = ['architecture', 'naming', 'security', 'legal', 'ai', 'deployment', 'other'];
const SEVERITY_LEVELS = ['error', 'warning', 'info'];

/**
 * Default empty policy registry.
 * @returns {object}
 */
function defaultPolicies() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    policies: []
  };
}

/**
 * Load policies from disk.
 * @param {string} [policyFile]
 * @returns {object}
 */
function loadPolicies(policyFile) {
  const filePath = policyFile || DEFAULT_POLICY_FILE;
  if (!fs.existsSync(filePath)) {
    return defaultPolicies();
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return defaultPolicies();
  }
}

/**
 * Save policies to disk.
 * @param {object} policies
 * @param {string} [policyFile]
 */
function savePolicies(policies, policyFile) {
  const filePath = policyFile || DEFAULT_POLICY_FILE;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  policies.last_updated = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(policies, null, 2) + '\n', 'utf8');
}

/**
 * Add a new policy rule.
 *
 * @param {object} rule - { id, category, name, description, pattern?, severity, applies_to? }
 * @param {object} [options]
 * @returns {object}
 */
function addPolicy(rule, options = {}) {
  if (!rule || !rule.name || !rule.description) {
    return { success: false, error: 'rule.name and rule.description are required' };
  }

  const category = (rule.category || 'other').toLowerCase();
  if (!POLICY_CATEGORIES.includes(category)) {
    return { success: false, error: `category must be one of: ${POLICY_CATEGORIES.join(', ')}` };
  }

  const severity = (rule.severity || 'warning').toLowerCase();
  if (!SEVERITY_LEVELS.includes(severity)) {
    return { success: false, error: `severity must be one of: ${SEVERITY_LEVELS.join(', ')}` };
  }

  const policyFile = options.policyFile || DEFAULT_POLICY_FILE;
  const policies = loadPolicies(policyFile);

  const id = rule.id || `policy-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const existing = policies.policies.find(p => p.id === id);
  if (existing) {
    return { success: false, error: `Policy with id "${id}" already exists` };
  }

  const newRule = {
    id,
    category,
    name: rule.name.trim(),
    description: rule.description.trim(),
    pattern: rule.pattern || null,
    severity,
    applies_to: rule.applies_to || ['specs', 'src'],
    enabled: rule.enabled !== false,
    created_at: new Date().toISOString()
  };

  policies.policies.push(newRule);
  savePolicies(policies, policyFile);

  return { success: true, policy: newRule, total: policies.policies.length };
}

/**
 * Run policy checks against the project.
 *
 * @param {string} root - Project root.
 * @param {object} [options]
 * @returns {object} Policy check result with violations and warnings.
 */
function checkPolicies(root, options = {}) {
  const policyFile = options.policyFile || path.join(root, DEFAULT_POLICY_FILE);
  const policies = loadPolicies(policyFile);

  const violations = [];
  const warnings = [];
  const infos = [];

  const enabledPolicies = policies.policies.filter(p => p.enabled !== false);

  for (const policy of enabledPolicies) {
    if (!policy.pattern) continue;

    let pattern;
    try {
      pattern = new RegExp(policy.pattern, 'gi');
    } catch {
      continue; // skip invalid regex patterns
    }

    const dirsToCheck = (policy.applies_to || []);
    for (const dir of dirsToCheck) {
      const absDir = path.join(root, dir);
      if (!fs.existsSync(absDir)) continue;

      const walk = (d) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else if (entry.isFile()) {
            try {
              const content = fs.readFileSync(full, 'utf8');
              const rel = path.relative(root, full).replace(/\\/g, '/');
              let match;
              while ((match = pattern.exec(content)) !== null) {
                const violation = {
                  policy_id: policy.id,
                  policy_name: policy.name,
                  category: policy.category,
                  severity: policy.severity,
                  file: rel,
                  matched: match[0],
                  description: policy.description
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
      passed
    }
  };
}

/**
 * List all registered policies.
 *
 * @param {object} [filter] - { category?, severity?, enabled? }
 * @param {object} [options]
 * @returns {object}
 */
function listPolicies(filter = {}, options = {}) {
  const policyFile = options.policyFile || DEFAULT_POLICY_FILE;
  const policies = loadPolicies(policyFile);

  let entries = policies.policies;

  if (filter.category) {
    entries = entries.filter(p => p.category === filter.category);
  }
  if (filter.severity) {
    entries = entries.filter(p => p.severity === filter.severity);
  }
  if (filter.enabled !== undefined) {
    entries = entries.filter(p => (p.enabled !== false) === filter.enabled);
  }

  return { success: true, policies: entries, total: entries.length };
}

module.exports = {
  loadPolicies,
  savePolicies,
  defaultPolicies,
  addPolicy,
  checkPolicies,
  listPolicies,
  POLICY_CATEGORIES,
  SEVERITY_LEVELS
};
