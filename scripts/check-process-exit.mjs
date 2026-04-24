#!/usr/bin/env node
/**
 * check-process-exit.mjs — T3.8 + ADR-006 enforcement.
 *
 * Greps src/**\/*.ts and dist/**\/*.js for `process.exit(`. Allowlist contains
 * exactly two sites:
 *   1. src/cli/main.ts (CLI top-level catch)
 *   2. src/lib/ipc.ts (IPC subprocess runner)
 *
 * Dormant pattern: until the first port lands, src/ + dist/ are empty and the
 * script exits 0 trivially. Once ports begin, it becomes blocking.
 *
 * @see specs/decisions/adr-006-error-model.md
 * @see specs/implementation-plan.md T3.8, E2-S7
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';

const ROOTS = ['src', 'dist'];
const ALLOWLIST = [
  'src/cli/main.ts',
  'src/lib/ipc.ts',
  'dist/cli.js',
  'dist/lib/ipc.js',
  'dist/lib/ipc.mjs',
];
const PATTERN = /process\.exit\s*\(/g;

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      yield* walk(fullPath);
    } else if (entry.isFile() && /\.(m?[jt]s)$/.test(entry.name) && !/\.d\.m?ts$/.test(entry.name)) {
      yield fullPath;
    }
  }
}

const violations = [];
let scanned = 0;

for (const root of ROOTS) {
  if (!existsSync(root)) continue;
  for (const file of walk(root)) {
    scanned++;
    const relPath = path.relative('.', file);
    if (ALLOWLIST.some((a) => relPath === a || relPath.endsWith(a))) continue;

    const contents = readFileSync(file, 'utf8');
    let match;
    PATTERN.lastIndex = 0;
    while ((match = PATTERN.exec(contents)) !== null) {
      const before = contents.slice(0, match.index);
      const line = before.split('\n').length;
      violations.push({ file: relPath, line, snippet: contents.split('\n')[line - 1].trim() });
    }
  }
}

if (scanned === 0) {
  console.log('[check-process-exit] dormant: no src/ or dist/ TS output found yet (pre-port).');
  process.exit(0);
}

if (violations.length === 0) {
  console.log('[check-process-exit] OK: ' + scanned + ' files scanned; only allowlisted process.exit() sites found.');
  process.exit(0);
}

console.error('[check-process-exit] FAIL: process.exit() outside the allowlist.');
console.error('Allowlist (per ADR-006):');
for (const a of ALLOWLIST) console.error('  - ' + a);
console.error('');
console.error('Violations:');
for (const v of violations) {
  console.error('  ' + v.file + ':' + v.line + '  ' + v.snippet);
}
process.exit(1);
