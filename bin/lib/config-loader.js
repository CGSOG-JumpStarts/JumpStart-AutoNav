/**
 * config-loader.js — Global Config Overrides (Item 78)
 *
 * Merges user-specific global config (~/.jumpstart/config.yaml)
 * with project-level config (.jumpstart/config.yaml).
 * Project config takes precedence over global config.
 *
 * Usage:
 *   echo '{"root":"."}' | node bin/lib/config-loader.js
 *
 * Input (stdin JSON):
 *   {
 *     "root": ".",
 *     "global_path": "~/.jumpstart/config.yaml"
 *   }
 *
 * Output (stdout JSON):
 *   {
 *     "config": { merged config },
 *     "sources": { "global": "path", "project": "path" },
 *     "overrides_applied": [...]
 *   }
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Simple YAML parser for basic key-value configs.
 * Handles nested objects (indentation-based), strings, numbers, booleans, and arrays.
 * Not a full YAML parser — covers the framework's config structure.
 *
 * @param {string} yaml - YAML string.
 * @returns {object} Parsed object.
 */
function parseSimpleYaml(yaml) {
  const result = {};
  const lines = yaml.split('\n');
  const stack = [{ obj: result, indent: -1 }];

  for (const line of lines) {
    // Skip comments and empty lines
    if (/^\s*#/.test(line) || /^\s*$/.test(line)) continue;

    const indent = line.search(/\S/);
    const content = line.trim();

    // Handle key: value pairs
    const kvMatch = content.match(/^([^:]+?):\s*(.*)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1].trim();
    let value = kvMatch[2].trim();

    // Pop stack to find parent
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].obj;

    if (value === '' || value === '|' || value === '>') {
      // Nested object or block scalar — treat as nested object for simplicity
      parent[key] = {};
      stack.push({ obj: parent[key], indent });
    } else {
      // Parse value
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (value === 'null') value = null;
      else if (/^-?\d+$/.test(value)) value = parseInt(value, 10);
      else if (/^-?\d+\.\d+$/.test(value)) value = parseFloat(value);
      else if (/^["'].*["']$/.test(value)) value = value.slice(1, -1);

      parent[key] = value;
    }
  }

  return result;
}

/**
 * Deep merge two objects. Source (project) wins on conflict.
 *
 * @param {object} target - Global config (lower priority).
 * @param {object} source - Project config (higher priority).
 * @returns {object} Merged config.
 */
function deepMerge(target, source) {
  const output = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
      target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
    ) {
      output[key] = deepMerge(target[key], source[key]);
    } else {
      output[key] = source[key];
    }
  }
  return output;
}

/**
 * Flatten an object to dot-notation keys.
 *
 * @param {object} obj - Object to flatten.
 * @param {string} [prefix] - Key prefix.
 * @returns {object} Flattened key-value pairs.
 */
function flatten(obj, prefix = '') {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flatten(value, fullKey));
    } else {
      result[fullKey] = value;
    }
  }
  return result;
}

/**
 * Load and merge global + project configuration.
 *
 * @param {object} input - Loader options.
 * @param {string} [input.root] - Project root.
 * @param {string} [input.global_path] - Path to global config.
 * @returns {object} Merged configuration.
 */
async function loadConfig(input) {
  const { root = '.', global_path } = input;
  const resolvedRoot = path.resolve(root);

  // Determine global config path
  const globalConfigPath = global_path
    ? path.resolve(global_path.replace(/^~/, os.homedir()))
    : path.join(os.homedir(), '.jumpstart', 'config.yaml');

  const projectConfigPath = path.join(resolvedRoot, '.jumpstart', 'config.yaml');

  let globalConfig = {};
  let projectConfig = {};
  const sources = { global: null, project: null };

  // Load global config
  if (fs.existsSync(globalConfigPath)) {
    try {
      const raw = fs.readFileSync(globalConfigPath, 'utf8');
      globalConfig = parseSimpleYaml(raw);
      sources.global = globalConfigPath;
    } catch {
      // Global config is optional
    }
  }

  // Load project config
  if (fs.existsSync(projectConfigPath)) {
    try {
      const raw = fs.readFileSync(projectConfigPath, 'utf8');
      projectConfig = parseSimpleYaml(raw);
      sources.project = projectConfigPath;
    } catch {
      return { error: `Failed to parse project config: ${projectConfigPath}`, config: {}, sources };
    }
  }

  // Merge: project wins over global
  let merged = deepMerge(globalConfig, projectConfig);

  // ─── Ceremony Profile Expansion (UX Feature 3) ─────────────────────────
  // If a ceremony profile is set, expand it as a base layer.
  // Merge order: ceremony profile (lowest) → global → project (highest)
  let profileApplied = null;
  const ceremonyProfile = merged.ceremony?.profile;
  if (ceremonyProfile && ceremonyProfile !== 'standard') {
    try {
      // Dynamic import to avoid circular dependency
      const { applyProfile } = await import('./ceremony.js');
      const profileResult = applyProfile(merged, ceremonyProfile);
      merged = profileResult.config;
      profileApplied = {
        profile: ceremonyProfile,
        settings_applied: profileResult.applied.length,
        settings_skipped: profileResult.skipped.length,
        applied: profileResult.applied,
        skipped: profileResult.skipped
      };
    } catch {
      // ceremony.js not available — skip profile expansion
    }
  }

  // Track what the global config overrides
  const globalFlat = flatten(globalConfig);
  const projectFlat = flatten(projectConfig);
  const overridesApplied = [];

  for (const [key, value] of Object.entries(globalFlat)) {
    if (!(key in projectFlat)) {
      overridesApplied.push({ key, value, source: 'global' });
    }
  }

  return {
    config: merged,
    sources,
    overrides_applied: overridesApplied,
    profile_applied: profileApplied,
    global_keys: Object.keys(globalFlat).length,
    project_keys: Object.keys(projectFlat).length
  };
}

// ─── CLI Entry Point ──────────────────────────────────────────────────────────

if (process.argv[1] && (
  process.argv[1].endsWith('config-loader.js') ||
  process.argv[1].endsWith('config-loader')
)) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', async () => {
    try {
      const parsed = input.trim() ? JSON.parse(input) : {};
      const result = await loadConfig(parsed);
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } catch (err) {
      process.stdout.write(JSON.stringify({ error: err.message }) + '\n');
      process.exit(2);
    }
  });

  if (process.stdin.isTTY) {
    loadConfig({}).then(result => {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    });
  }
}

export { loadConfig, parseSimpleYaml, deepMerge };
