/**
 * impact-analysis.js — Agentic Change Impact Analysis
 *
 * Before editing, maps what requirements, tests, services, APIs, and
 * consumers will be affected by a given change.
 *
 * Usage:
 *   node bin/lib/impact-analysis.js analyze|report [--file <path>] [--symbol <name>]
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Analyse the impact of changing a given file or symbol.
 *
 * @param {string} root - Project root.
 * @param {object} target - { file?, symbol?, specId? } — what is being changed.
 * @param {object} [options]
 * @returns {object} Impact analysis result.
 */
function analyzeImpact(root, target, options = {}) {
  if (!target || (!target.file && !target.symbol && !target.specId)) {
    return { success: false, error: 'target.file, target.symbol, or target.specId is required' };
  }

  const result = {
    target,
    affected_requirements: [],
    affected_tests: [],
    affected_services: [],
    affected_apis: [],
    affected_consumers: [],
    risk_level: 'low',
    summary: {}
  };

  const specsDir = path.join(root, 'specs');
  const testsDir = path.join(root, options.testsDir || 'tests');
  const srcDir = path.join(root, options.srcDir || 'src');

  // Determine the key to search for (filename stem, symbol name, or spec ID)
  const searchTerms = [];
  if (target.file) {
    searchTerms.push(path.basename(target.file, path.extname(target.file)));
    searchTerms.push(path.basename(target.file));
  }
  if (target.symbol) {
    searchTerms.push(target.symbol);
  }
  if (target.specId) {
    searchTerms.push(target.specId);
  }

  function grepDir(dir, label) {
    if (!fs.existsSync(dir)) return [];
    const hits = [];
    const walk = (d) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          try {
            const content = fs.readFileSync(full, 'utf8');
            const rel = path.relative(root, full).replace(/\\/g, '/');
            for (const term of searchTerms) {
              if (content.includes(term)) {
                hits.push({ file: rel, label, matched_term: term });
                break;
              }
            }
          } catch {
            // skip unreadable files
          }
        }
      }
    };
    walk(dir);
    return hits;
  }

  // Find affected spec requirements
  const specHits = grepDir(specsDir, 'requirement');
  for (const h of specHits) {
    if (!result.affected_requirements.some(r => r.file === h.file)) {
      result.affected_requirements.push(h);
    }
  }

  // Find affected tests
  const testHits = grepDir(testsDir, 'test');
  for (const h of testHits) {
    if (!result.affected_tests.some(r => r.file === h.file)) {
      result.affected_tests.push(h);
    }
  }

  // Find affected services and API consumers within src
  const srcHits = grepDir(srcDir, 'source');
  for (const h of srcHits) {
    // Rough heuristic: files with "service", "api", "controller", "route" in name are services/APIs
    const lower = h.file.toLowerCase();
    if (lower.includes('service') || lower.includes('controller') || lower.includes('route')) {
      result.affected_services.push(h);
    } else if (lower.includes('api') || lower.includes('endpoint') || lower.includes('handler')) {
      result.affected_apis.push(h);
    } else {
      result.affected_consumers.push(h);
    }
  }

  // Compute risk level
  const totalAffected =
    result.affected_requirements.length +
    result.affected_tests.length +
    result.affected_services.length +
    result.affected_apis.length +
    result.affected_consumers.length;

  if (totalAffected > 20) {
    result.risk_level = 'critical';
  } else if (totalAffected > 10) {
    result.risk_level = 'high';
  } else if (totalAffected > 4) {
    result.risk_level = 'medium';
  } else {
    result.risk_level = 'low';
  }

  result.summary = {
    total_affected: totalAffected,
    requirements: result.affected_requirements.length,
    tests: result.affected_tests.length,
    services: result.affected_services.length,
    apis: result.affected_apis.length,
    consumers: result.affected_consumers.length,
    risk_level: result.risk_level
  };

  return { success: true, ...result };
}

/**
 * Render a human-readable impact report.
 *
 * @param {object} analysis - Result from analyzeImpact().
 * @returns {string}
 */
function renderImpactReport(analysis) {
  if (!analysis.success) {
    return `❌ Impact analysis failed: ${analysis.error}`;
  }

  const lines = [];
  const riskEmoji = { low: '🟢', medium: '🟡', high: '🟠', critical: '🔴' };
  const emoji = riskEmoji[analysis.risk_level] || '⚪';

  lines.push(`\n${emoji} Impact Analysis — Risk: ${analysis.risk_level.toUpperCase()}`);
  lines.push(`\nTarget: ${JSON.stringify(analysis.target)}`);
  lines.push(`Total affected: ${analysis.summary.total_affected}`);
  lines.push('');

  const sections = [
    ['Requirements', analysis.affected_requirements],
    ['Tests', analysis.affected_tests],
    ['Services', analysis.affected_services],
    ['APIs', analysis.affected_apis],
    ['Consumers', analysis.affected_consumers]
  ];

  for (const [label, items] of sections) {
    if (items.length > 0) {
      lines.push(`${label} (${items.length}):`);
      for (const item of items) {
        lines.push(`  • ${item.file}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

module.exports = {
  analyzeImpact,
  renderImpactReport
};
