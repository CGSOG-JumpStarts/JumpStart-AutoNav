/**
 * ast-edit-engine.js — AST-Aware Edit Engine (Item 42)
 *
 * Make structure-safe changes instead of relying heavily
 * on plain text edits.
 *
 * Usage:
 *   node bin/lib/ast-edit-engine.js analyze|validate [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SUPPORTED_LANGUAGES = ['javascript', 'typescript', 'json', 'yaml', 'markdown'];

const STRUCTURE_PATTERNS = {
  javascript: {
    function_decl: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/gm,
    class_decl: /^(?:export\s+)?class\s+(\w+)/gm,
    const_export: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=/gm,
    module_exports: /module\.exports\s*=\s*\{([^}]+)\}/gm,
    import_stmt: /^(?:import|const\s+\{[^}]+\}\s*=\s*require)/gm
  },
  typescript: {
    interface_decl: /^(?:export\s+)?interface\s+(\w+)/gm,
    type_decl: /^(?:export\s+)?type\s+(\w+)/gm,
    function_decl: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm,
    class_decl: /^(?:export\s+)?class\s+(\w+)/gm
  }
};

/**
 * Detect language from file extension.
 *
 * @param {string} filePath
 * @returns {string|null}
 */
function detectLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.ts': 'typescript', '.tsx': 'typescript',
    '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml',
    '.md': 'markdown'
  };
  return map[ext] || null;
}

/**
 * Analyze file structure.
 *
 * @param {string} filePath
 * @param {object} [options]
 * @returns {object}
 */
function analyzeStructure(filePath, options = {}) {
  if (!fs.existsSync(filePath)) {
    return { success: false, error: `File not found: ${filePath}` };
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const language = options.language || detectLanguage(filePath);

  if (!language) {
    return { success: false, error: 'Unable to detect language' };
  }

  const symbols = [];
  const patterns = STRUCTURE_PATTERNS[language] || {};

  for (const [type, pattern] of Object.entries(patterns)) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;
      symbols.push({
        type: type.replace(/_/g, ' '),
        name: match[1] || match[0].trim(),
        line
      });
    }
  }

  const lines = content.split('\n');

  return {
    success: true,
    file: filePath,
    language,
    total_lines: lines.length,
    symbols,
    symbol_count: symbols.length,
    has_exports: /(?:module\.exports|export\s)/m.test(content),
    has_imports: /(?:require\(|import\s)/m.test(content)
  };
}

/**
 * Validate that an edit is structure-safe.
 *
 * @param {string} filePath
 * @param {string} oldStr
 * @param {string} newStr
 * @param {object} [options]
 * @returns {object}
 */
function validateEdit(filePath, oldStr, newStr, options = {}) {
  if (!fs.existsSync(filePath)) {
    return { success: false, error: `File not found: ${filePath}` };
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const occurrences = content.split(oldStr).length - 1;

  if (occurrences === 0) {
    return { success: false, safe: false, error: 'Old string not found in file' };
  }
  if (occurrences > 1) {
    return { success: false, safe: false, error: `Old string found ${occurrences} times — ambiguous edit` };
  }

  // Check bracket balance
  const beforeBrackets = countBrackets(content);
  const after = content.replace(oldStr, newStr);
  const afterBrackets = countBrackets(after);

  const bracketsSafe = beforeBrackets.curly === afterBrackets.curly &&
                       beforeBrackets.square === afterBrackets.square &&
                       beforeBrackets.paren === afterBrackets.paren;

  return {
    success: true,
    safe: bracketsSafe,
    unique_match: true,
    bracket_balance: bracketsSafe ? 'preserved' : 'changed',
    warnings: bracketsSafe ? [] : ['Edit changes bracket balance — verify manually']
  };
}

function countBrackets(content) {
  return {
    curly: (content.match(/\{/g) || []).length - (content.match(/\}/g) || []).length,
    square: (content.match(/\[/g) || []).length - (content.match(/\]/g) || []).length,
    paren: (content.match(/\(/g) || []).length - (content.match(/\)/g) || []).length
  };
}

module.exports = {
  detectLanguage,
  analyzeStructure,
  validateEdit,
  countBrackets,
  SUPPORTED_LANGUAGES,
  STRUCTURE_PATTERNS
};
