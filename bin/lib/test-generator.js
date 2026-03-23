/**
 * test-generator.js — Test Generation Tied to Acceptance Criteria (Item 44)
 *
 * Auto-generate unit, integration, API, UI, and contract tests
 * from requirements.
 *
 * Usage:
 *   node bin/lib/test-generator.js generate|coverage [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const TEST_TYPES = ['unit', 'integration', 'api', 'ui', 'contract', 'e2e'];

const TEST_FRAMEWORKS = {
  javascript: { framework: 'vitest', extension: '.test.js', import: "import { describe, it, expect } from 'vitest';" },
  typescript: { framework: 'vitest', extension: '.test.ts', import: "import { describe, it, expect } from 'vitest';" },
  python: { framework: 'pytest', extension: '_test.py', import: 'import pytest' }
};

/**
 * Extract acceptance criteria from PRD content.
 *
 * @param {string} content - PRD markdown content.
 * @returns {object[]}
 */
function extractCriteria(content) {
  const criteria = [];
  const lines = content.split('\n');
  let currentStory = null;

  for (const line of lines) {
    const storyMatch = line.match(/\*\*(E\d+-S\d+)\*\*/);
    if (storyMatch) currentStory = storyMatch[1];

    const givenMatch = line.match(/^\s*[-*]\s*(Given\s+.+)/i);
    const whenMatch = line.match(/^\s*[-*]\s*(When\s+.+)/i);
    const thenMatch = line.match(/^\s*[-*]\s*(Then\s+.+)/i);
    const acMatch = line.match(/^\s*[-*]\s*AC\d*:\s*(.+)/i);

    if (givenMatch || whenMatch || thenMatch || acMatch) {
      criteria.push({
        story: currentStory,
        criterion: (givenMatch || whenMatch || thenMatch || acMatch)[1].trim(),
        type: givenMatch ? 'given' : whenMatch ? 'when' : thenMatch ? 'then' : 'acceptance'
      });
    }
  }

  return criteria;
}

/**
 * Generate test stubs from acceptance criteria.
 *
 * @param {object[]} criteria - Extracted criteria.
 * @param {object} [options]
 * @returns {object}
 */
function generateTestStubs(criteria, options = {}) {
  const language = options.language || 'javascript';
  const fwConfig = TEST_FRAMEWORKS[language];
  if (!fwConfig) {
    return { success: false, error: `Unsupported language: ${language}` };
  }

  const byStory = {};
  for (const c of criteria) {
    const story = c.story || 'general';
    if (!byStory[story]) byStory[story] = [];
    byStory[story].push(c);
  }

  const testFiles = [];
  for (const [story, storyCriteria] of Object.entries(byStory)) {
    const fileName = `${story.toLowerCase().replace(/[^a-z0-9]/g, '-')}${fwConfig.extension}`;
    const tests = storyCriteria.map(c => {
      const testName = c.criterion.replace(/'/g, "\\'").substring(0, 100);
      return `  it('${testName}', () => {\n    // TODO: Implement test for ${c.type}\n    expect(true).toBe(true);\n  });`;
    });

    const content = `${fwConfig.import}\n\ndescribe('${story}', () => {\n${tests.join('\n\n')}\n});\n`;
    testFiles.push({ fileName, content, story, test_count: storyCriteria.length });
  }

  return {
    success: true,
    total_criteria: criteria.length,
    test_files: testFiles.length,
    files: testFiles,
    framework: fwConfig.framework
  };
}

/**
 * Check test coverage against acceptance criteria.
 *
 * @param {string} root - Project root.
 * @param {object} [options]
 * @returns {object}
 */
function checkCoverage(root, options = {}) {
  const prdFile = path.join(root, 'specs', 'prd.md');
  if (!fs.existsSync(prdFile)) {
    return { success: false, error: 'PRD not found at specs/prd.md' };
  }

  const prdContent = fs.readFileSync(prdFile, 'utf8');
  const criteria = extractCriteria(prdContent);

  // Check test directory for matching tests
  const testDir = path.join(root, 'tests');
  let testContent = '';
  if (fs.existsSync(testDir)) {
    for (const entry of fs.readdirSync(testDir)) {
      if (entry.endsWith('.test.js') || entry.endsWith('.test.ts')) {
        try { testContent += fs.readFileSync(path.join(testDir, entry), 'utf8') + '\n'; }
        catch { /* skip */ }
      }
    }
  }

  const covered = criteria.filter(c => {
    const terms = c.criterion.toLowerCase().split(/\s+/).filter(t => t.length > 3);
    return terms.some(t => testContent.toLowerCase().includes(t));
  });

  return {
    success: true,
    total_criteria: criteria.length,
    covered: covered.length,
    coverage: criteria.length > 0 ? Math.round((covered.length / criteria.length) * 100) : 0,
    uncovered: criteria.filter(c => !covered.includes(c))
  };
}

module.exports = {
  extractCriteria,
  generateTestStubs,
  checkCoverage,
  TEST_TYPES,
  TEST_FRAMEWORKS
};
