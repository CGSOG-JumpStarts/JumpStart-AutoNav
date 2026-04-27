/**
 * ast-edit-engine.ts — AST-aware edit engine port (T4.4.1, cluster J).
 *
 * Pure-library port of `bin/lib/ast-edit-engine.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `SUPPORTED_LANGUAGES` (constant array)
 *   - `STRUCTURE_PATTERNS` (constant map)
 *   - `detectLanguage(filePath)` => string | null
 *   - `analyzeStructure(filePath, options?)` => AnalyzeResult
 *   - `validateEdit(filePath, oldStr, newStr, options?)` => ValidateResult
 *   - `countBrackets(content)` => BracketCounts
 *
 * Behavior parity:
 *   - Language detection uses extension map; unknown extensions return null.
 *   - Symbol scan walks `STRUCTURE_PATTERNS[language]` and emits
 *     `{type, name, line}` entries (type is the underscore-replaced key).
 *   - `validateEdit` rejects 0 occurrences ("not found") and >1 ("ambiguous").
 *   - Bracket-balance heuristic compares `{`, `[`, `(` totals before/after.
 *
 * Hardening (F2/F4/F9/F13 lessons from M3/M4):
 *   - All `fs` calls use the static top-of-module import.
 *   - Symbol matching uses `String.matchAll(globalRegex)` instead of
 *     stateful `regex.exec()` looping (M4 cluster H pattern).
 *   - `STRUCTURE_PATTERNS` lookup guards prototype-pollution-shaped keys
 *     (`__proto__`/`constructor`/`prototype` would otherwise return the
 *     Object prototype methods and crash the regex iteration).
 *
 * @see bin/lib/ast-edit-engine.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.1
 */

import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';

// Public types

export interface StructurePatternMap {
  [patternName: string]: RegExp;
}

export interface SymbolEntry {
  type: string;
  name: string;
  line: number;
}

export interface AnalyzeOptions {
  language?: string;
}

export interface AnalyzeResult {
  success: boolean;
  error?: string;
  file?: string;
  language?: string;
  total_lines?: number;
  symbols?: SymbolEntry[];
  symbol_count?: number;
  has_exports?: boolean;
  has_imports?: boolean;
}

export interface ValidateEditOptions {
  language?: string;
}

export interface ValidateResult {
  success: boolean;
  safe?: boolean;
  unique_match?: boolean;
  bracket_balance?: 'preserved' | 'changed';
  warnings?: string[];
  error?: string;
}

export interface BracketCounts {
  curly: number;
  square: number;
  paren: number;
}

// Constants (verbatim from legacy)

export const SUPPORTED_LANGUAGES: string[] = [
  'javascript',
  'typescript',
  'json',
  'yaml',
  'markdown',
];

export const STRUCTURE_PATTERNS: Record<string, StructurePatternMap> = {
  javascript: {
    function_decl: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/gm,
    class_decl: /^(?:export\s+)?class\s+(\w+)/gm,
    const_export: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=/gm,
    module_exports: /module\.exports\s*=\s*\{([^}]+)\}/gm,
    import_stmt: /^(?:import|const\s+\{[^}]+\}\s*=\s*require)/gm,
  },
  typescript: {
    interface_decl: /^(?:export\s+)?interface\s+(\w+)/gm,
    type_decl: /^(?:export\s+)?type\s+(\w+)/gm,
    function_decl: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm,
    class_decl: /^(?:export\s+)?class\s+(\w+)/gm,
  },
};

const EXTENSION_MAP: Record<string, string> = {
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
};

/** Detect language from file extension. Returns null for unknown extensions. */
export function detectLanguage(filePath: string): string | null {
  const ext = extname(filePath).toLowerCase();
  return EXTENSION_MAP[ext] || null;
}

/** Reject prototype-pollution-shaped keys when indexing user-controlled lookups. */
function isSafeKey(key: string): boolean {
  return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

/** Analyze file structure: enumerate symbols + count exports/imports. */
export function analyzeStructure(filePath: string, options: AnalyzeOptions = {}): AnalyzeResult {
  if (!existsSync(filePath)) {
    return { success: false, error: `File not found: ${filePath}` };
  }

  const content = readFileSync(filePath, 'utf8');
  const language = options.language || detectLanguage(filePath);

  if (!language) {
    return { success: false, error: 'Unable to detect language' };
  }

  const symbols: SymbolEntry[] = [];
  const patterns: StructurePatternMap = isSafeKey(language)
    ? STRUCTURE_PATTERNS[language] || {}
    : {};

  for (const [type, pattern] of Object.entries(patterns)) {
    if (!isSafeKey(type)) continue;
    // Use String.matchAll over a fresh regex so we never leak
    // `lastIndex` state across calls (F2/F4 lesson).
    const globalRegex = new RegExp(pattern.source, pattern.flags);
    for (const match of content.matchAll(globalRegex)) {
      const idx = match.index ?? 0;
      const line = content.substring(0, idx).split('\n').length;
      symbols.push({
        type: type.replace(/_/g, ' '),
        name: match[1] || match[0].trim(),
        line,
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
    has_imports: /(?:require\(|import\s)/m.test(content),
  };
}

/** Count `{`, `[`, `(` balance deltas in `content`. */
export function countBrackets(content: string): BracketCounts {
  return {
    curly: (content.match(/\{/g) || []).length - (content.match(/\}/g) || []).length,
    square: (content.match(/\[/g) || []).length - (content.match(/\]/g) || []).length,
    paren: (content.match(/\(/g) || []).length - (content.match(/\)/g) || []).length,
  };
}

/**
 * Validate that a (oldStr → newStr) edit is structure-safe.
 *
 * Rejects ambiguous matches (0 or >1 occurrences) and warns when
 * applying the edit would change the curly/square/paren balance.
 */
export function validateEdit(
  filePath: string,
  oldStr: string,
  newStr: string,
  _options: ValidateEditOptions = {}
): ValidateResult {
  if (!existsSync(filePath)) {
    return { success: false, error: `File not found: ${filePath}` };
  }

  const content = readFileSync(filePath, 'utf8');
  const occurrences = content.split(oldStr).length - 1;

  if (occurrences === 0) {
    return { success: false, safe: false, error: 'Old string not found in file' };
  }
  if (occurrences > 1) {
    return {
      success: false,
      safe: false,
      error: `Old string found ${occurrences} times — ambiguous edit`,
    };
  }

  const beforeBrackets = countBrackets(content);
  const after = content.replace(oldStr, newStr);
  const afterBrackets = countBrackets(after);

  const bracketsSafe =
    beforeBrackets.curly === afterBrackets.curly &&
    beforeBrackets.square === afterBrackets.square &&
    beforeBrackets.paren === afterBrackets.paren;

  return {
    success: true,
    safe: bracketsSafe,
    unique_match: true,
    bracket_balance: bracketsSafe ? 'preserved' : 'changed',
    warnings: bracketsSafe ? [] : ['Edit changes bracket balance — verify manually'],
  };
}
