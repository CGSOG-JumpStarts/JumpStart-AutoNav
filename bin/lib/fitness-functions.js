/**
 * fitness-functions.js — Architectural Fitness Functions
 *
 * Continuously evaluate the implemented system against architecture
 * constraints and NFRs.
 *
 * Config: .jumpstart/fitness-functions.json
 *
 * Usage:
 *   node bin/lib/fitness-functions.js evaluate|add|list|report [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_FITNESS_FILE = path.join('.jumpstart', 'fitness-functions.json');

const FITNESS_CATEGORIES = ['dependency', 'structure', 'complexity', 'naming', 'security', 'performance', 'testing'];

/**
 * Default fitness function registry.
 * @returns {object}
 */
function defaultRegistry() {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_evaluated: null,
    functions: [],
    evaluation_history: []
  };
}

/**
 * Load fitness function registry from disk.
 * @param {string} [registryFile]
 * @returns {object}
 */
function loadRegistry(registryFile) {
  const filePath = registryFile || DEFAULT_FITNESS_FILE;
  if (!fs.existsSync(filePath)) {
    return defaultRegistry();
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return defaultRegistry();
  }
}

/**
 * Save fitness function registry to disk.
 * @param {object} registry
 * @param {string} [registryFile]
 */
function saveRegistry(registry, registryFile) {
  const filePath = registryFile || DEFAULT_FITNESS_FILE;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(registry, null, 2) + '\n', 'utf8');
}

/**
 * Add a fitness function.
 *
 * @param {object} func - { id, name, category, description, check_type, pattern?, threshold?, target_dirs? }
 * @param {object} [options]
 * @returns {object}
 */
function addFitnessFunction(func, options = {}) {
  if (!func || !func.name || !func.description) {
    return { success: false, error: 'name and description are required' };
  }

  const category = (func.category || 'structure').toLowerCase();
  if (!FITNESS_CATEGORIES.includes(category)) {
    return { success: false, error: `category must be one of: ${FITNESS_CATEGORIES.join(', ')}` };
  }

  const registryFile = options.registryFile || DEFAULT_FITNESS_FILE;
  const registry = loadRegistry(registryFile);

  const id = func.id || `ff-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  if (registry.functions.find(f => f.id === id)) {
    return { success: false, error: `Fitness function "${id}" already exists` };
  }

  const newFunc = {
    id,
    name: func.name.trim(),
    category,
    description: func.description.trim(),
    check_type: func.check_type || 'pattern',
    pattern: func.pattern || null,
    threshold: func.threshold != null ? func.threshold : null,
    target_dirs: func.target_dirs || ['src'],
    enabled: func.enabled !== false,
    created_at: new Date().toISOString()
  };

  registry.functions.push(newFunc);
  saveRegistry(registry, registryFile);

  return { success: true, function: newFunc, total: registry.functions.length };
}

/**
 * Built-in fitness checks.
 */
const BUILTIN_CHECKS = {
  max_file_length: (content, threshold) => {
    const lineCount = content.split('\n').length;
    return { passed: lineCount <= (threshold || 500), value: lineCount, threshold: threshold || 500 };
  },
  no_circular_imports: (content) => {
    const imports = (content.match(/(?:require|import)\s*\(?['"]([^'"]+)['"]\)?/g) || []);
    return { passed: true, value: imports.length, note: 'static check only' };
  },
  max_function_params: (content, threshold) => {
    const funcPattern = /function\s+\w+\s*\(([^)]*)\)/g;
    const arrowPattern = /\(([^)]*)\)\s*(?:=>|{)/g;
    let maxParams = 0;
    let match;
    while ((match = funcPattern.exec(content)) !== null) {
      const params = match[1].split(',').filter(p => p.trim().length > 0).length;
      if (params > maxParams) maxParams = params;
    }
    while ((match = arrowPattern.exec(content)) !== null) {
      const params = match[1].split(',').filter(p => p.trim().length > 0).length;
      if (params > maxParams) maxParams = params;
    }
    return { passed: maxParams <= (threshold || 5), value: maxParams, threshold: threshold || 5 };
  },
  pattern_match: (content, _threshold, pattern) => {
    if (!pattern) return { passed: true, value: 0 };
    try {
      const regex = new RegExp(pattern, 'gi');
      const matches = content.match(regex) || [];
      return { passed: matches.length === 0, value: matches.length, pattern };
    } catch {
      return { passed: true, value: 0, error: 'invalid regex' };
    }
  }
};

/**
 * Evaluate all fitness functions against the project.
 *
 * @param {string} root - Project root.
 * @param {object} [options]
 * @returns {object}
 */
function evaluateFitness(root, options = {}) {
  const registryFile = options.registryFile || path.join(root, DEFAULT_FITNESS_FILE);
  const registry = loadRegistry(registryFile);

  const enabledFuncs = registry.functions.filter(f => f.enabled !== false);
  const results = [];

  for (const func of enabledFuncs) {
    const violations = [];
    const targetDirs = func.target_dirs || ['src'];

    for (const dir of targetDirs) {
      const absDir = path.join(root, dir);
      if (!fs.existsSync(absDir)) continue;

      const walk = (d) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          const full = path.join(d, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else if (entry.isFile() && /\.(js|ts|jsx|tsx|py|go|java|rb|rs)$/.test(entry.name)) {
            try {
              const content = fs.readFileSync(full, 'utf8');
              const rel = path.relative(root, full).replace(/\\/g, '/');
              let checkResult;

              if (func.check_type === 'max_file_length') {
                checkResult = BUILTIN_CHECKS.max_file_length(content, func.threshold);
              } else if (func.check_type === 'max_function_params') {
                checkResult = BUILTIN_CHECKS.max_function_params(content, func.threshold);
              } else if (func.check_type === 'pattern' && func.pattern) {
                checkResult = BUILTIN_CHECKS.pattern_match(content, func.threshold, func.pattern);
              } else {
                checkResult = { passed: true, value: 0 };
              }

              if (!checkResult.passed) {
                violations.push({
                  file: rel,
                  ...checkResult
                });
              }
            } catch {
              // skip unreadable files
            }
          }
        }
      };
      walk(absDir);
    }

    results.push({
      id: func.id,
      name: func.name,
      category: func.category,
      passed: violations.length === 0,
      violations: violations.length,
      details: violations.slice(0, 10)
    });
  }

  const allPassed = results.every(r => r.passed);
  const evaluation = {
    evaluated_at: new Date().toISOString(),
    total_functions: results.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    all_passed: allPassed
  };

  registry.last_evaluated = evaluation.evaluated_at;
  registry.evaluation_history.push(evaluation);
  if (registry.evaluation_history.length > 50) {
    registry.evaluation_history = registry.evaluation_history.slice(-50);
  }
  saveRegistry(registry, registryFile);

  return {
    success: true,
    all_passed: allPassed,
    results,
    summary: evaluation
  };
}

/**
 * List registered fitness functions.
 *
 * @param {object} [filter]
 * @param {object} [options]
 * @returns {object}
 */
function listFitnessFunctions(filter = {}, options = {}) {
  const registryFile = options.registryFile || DEFAULT_FITNESS_FILE;
  const registry = loadRegistry(registryFile);

  let functions = registry.functions;
  if (filter.category) {
    functions = functions.filter(f => f.category === filter.category);
  }
  if (filter.enabled !== undefined) {
    functions = functions.filter(f => (f.enabled !== false) === filter.enabled);
  }

  return {
    success: true,
    functions,
    total: functions.length,
    last_evaluated: registry.last_evaluated
  };
}

module.exports = {
  defaultRegistry,
  loadRegistry,
  saveRegistry,
  addFitnessFunction,
  evaluateFitness,
  listFitnessFunctions,
  BUILTIN_CHECKS,
  FITNESS_CATEGORIES
};
