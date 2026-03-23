/**
 * contract-first.js — Contract-First Implementation Assistant (Item 45)
 *
 * Generate code from API and event contracts, then verify code
 * remains compliant.
 *
 * Usage:
 *   node bin/lib/contract-first.js extract|verify|report [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const CONTRACT_TYPES = ['rest-api', 'graphql', 'event', 'grpc', 'message-queue'];

/**
 * Extract API contracts from architecture spec.
 *
 * @param {string} root - Project root.
 * @param {object} [options]
 * @returns {object}
 */
function extractContracts(root, options = {}) {
  const archFile = path.join(root, 'specs', 'architecture.md');
  if (!fs.existsSync(archFile)) {
    return { success: false, error: 'Architecture spec not found at specs/architecture.md' };
  }

  const content = fs.readFileSync(archFile, 'utf8');
  const contracts = [];

  // Extract API endpoint definitions
  const endpointPattern = /(?:GET|POST|PUT|PATCH|DELETE)\s+\/[\w/{}:-]+/g;
  let match;
  while ((match = endpointPattern.exec(content)) !== null) {
    const [method, ...pathParts] = match[0].split(/\s+/);
    contracts.push({
      type: 'rest-api',
      method,
      path: pathParts.join(' '),
      line: content.substring(0, match.index).split('\n').length
    });
  }

  // Extract event definitions
  const eventPattern = /(?:event|topic|queue)[\s:]+["']?([a-zA-Z0-9._-]+)/gi;
  while ((match = eventPattern.exec(content)) !== null) {
    contracts.push({
      type: 'event',
      name: match[1],
      line: content.substring(0, match.index).split('\n').length
    });
  }

  return {
    success: true,
    total_contracts: contracts.length,
    contracts,
    by_type: contracts.reduce((acc, c) => { acc[c.type] = (acc[c.type] || 0) + 1; return acc; }, {})
  };
}

/**
 * Verify that implementation matches contracts.
 *
 * @param {string} root - Project root.
 * @param {object} [options]
 * @returns {object}
 */
function verifyCompliance(root, options = {}) {
  const contractResult = extractContracts(root, options);
  if (!contractResult.success) return contractResult;

  const srcDir = path.join(root, 'src');
  let srcContent = '';

  if (fs.existsSync(srcDir)) {
    function readDir(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name !== 'node_modules') {
          readDir(path.join(dir, entry.name));
        } else if (entry.isFile() && /\.(js|ts|py)$/.test(entry.name)) {
          try { srcContent += fs.readFileSync(path.join(dir, entry.name), 'utf8') + '\n'; }
          catch { /* skip */ }
        }
      }
    }
    readDir(srcDir);
  }

  const violations = [];
  const implemented = [];

  for (const contract of contractResult.contracts) {
    if (contract.type === 'rest-api') {
      const pathPattern = contract.path.replace(/\{[^}]+\}/g, '[^/]+');
      const found = new RegExp(pathPattern).test(srcContent) || srcContent.includes(contract.path);
      if (found) implemented.push(contract);
      else violations.push({ ...contract, issue: 'Endpoint not found in source' });
    } else if (contract.type === 'event') {
      const found = srcContent.includes(contract.name);
      if (found) implemented.push(contract);
      else violations.push({ ...contract, issue: 'Event handler not found in source' });
    }
  }

  return {
    success: true,
    total_contracts: contractResult.total_contracts,
    implemented: implemented.length,
    violations: violations.length,
    compliance: contractResult.total_contracts > 0
      ? Math.round((implemented.length / contractResult.total_contracts) * 100) : 100,
    findings: violations
  };
}

module.exports = {
  extractContracts,
  verifyCompliance,
  CONTRACT_TYPES
};
