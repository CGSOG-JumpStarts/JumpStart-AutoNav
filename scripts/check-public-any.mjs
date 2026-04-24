#!/usr/bin/env node
/**
 * check-public-any.mjs — T3.4 + ADR-006 + NFR-D02 enforcement.
 *
 * Walks dist/**\/*.d.{ts,mts} after build and fails on bare `any` in exported
 * declarations. Biome catches `any` globally; this script guards the public
 * API surface that AI assistants consume.
 *
 * @see specs/architecture.md NFR-D02
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';

const DIST = 'dist';

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(fullPath);
    else if (entry.isFile() && /\.d\.m?ts$/.test(entry.name)) yield fullPath;
  }
}

const violations = [];
let scanned = 0;

for (const file of walk(DIST)) {
  scanned++;
  const contents = readFileSync(file, 'utf8');
  const stripped = contents.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const lines = stripped.split('\n');
  let inExport = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^export\s+(declare\s+)?(function|const|let|var|class|type|interface|enum)/.test(line)) {
      inExport = true;
    }
    if (inExport && /\bany\b/.test(line) && !/['"`].*\bany\b.*['"`]/.test(line)) {
      violations.push({ file: path.relative('.', file), line: i + 1, snippet: line.trim() });
      inExport = false;
    }
    if (inExport && (line.includes(';') || /^\}/.test(line.trim()))) inExport = false;
  }
}

if (scanned === 0) {
  console.log('[check-public-any] dormant: no dist/**/*.d.{ts,mts} found (pre-port build).');
  process.exit(0);
}

if (violations.length === 0) {
  console.log('[check-public-any] OK: ' + scanned + ' .d.ts files scanned; no bare any in exports.');
  process.exit(0);
}

console.error('[check-public-any] FAIL: bare `any` in exported declaration.');
for (const v of violations) {
  console.error('  ' + v.file + ':' + v.line + '  ' + v.snippet);
}
process.exit(1);
