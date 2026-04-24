#!/usr/bin/env node
/**
 * check-process-exit.mjs — T3.8 + ADR-006 enforcement.
 *
 * Greps source TypeScript for the `process.exit(` call. Allowlist is exactly
 * the sites ADR-006 sanctions:
 *   1. src/cli/main.ts          (CLI top-level catch — 2.0 home)
 *   2. src/lib/ipc.ts           (IPC subprocess runner — 2.0 home)
 * plus the strangler-phase staging paths that may host the same code during
 * 1.x while modules port into bin/lib-ts/:
 *   3. bin/lib-ts/cli.ts
 *   4. bin/lib-ts/ipc.ts
 *
 * Roots scanned: bin/lib-ts/ (strangler) + src/ (final 2.0 layout, empty
 * until M8). dist/ is intentionally NOT scanned: it is generated, gitignored,
 * and any exit call there is a faithful echo of source we already flag.
 * Including dist/ would create a circular gate (build emits dist; gate
 * fails; can't build to fix; loop).
 *
 * Match semantics: paths are normalized and compared with strict set lookup
 * so an attacker can't smuggle a violation past the gate by nesting an
 * allowlisted suffix (e.g. bin/lib-ts/foo/src/cli/main.ts).
 *
 * Dormant pattern: until the first qualifying file lands, both roots are
 * empty and the script exits 0 trivially. Once ports begin, it becomes
 * blocking.
 *
 * @see specs/decisions/adr-006-error-model.md
 * @see specs/implementation-plan.md T3.8, E2-S7
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

const ROOTS = ['bin/lib-ts', 'src'];

// Normalize the allowlist once so cross-platform path separators don't matter.
const ALLOWLIST = new Set(
  ['src/cli/main.ts', 'src/lib/ipc.ts', 'bin/lib-ts/cli.ts', 'bin/lib-ts/ipc.ts'].map((p) =>
    path.normalize(p)
  )
);

const PATTERN = /process\.exit\s*\(/g;

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      yield* walk(fullPath);
    } else if (
      entry.isFile() &&
      /\.(m?[jt]s)$/.test(entry.name) &&
      !/\.d\.m?ts$/.test(entry.name)
    ) {
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
    const relPath = path.normalize(path.relative('.', file));
    if (ALLOWLIST.has(relPath)) continue;

    const contents = readFileSync(file, 'utf8');
    PATTERN.lastIndex = 0;
    for (const match of contents.matchAll(PATTERN)) {
      const before = contents.slice(0, match.index);
      const line = before.split('\n').length;
      violations.push({
        file: relPath,
        line,
        snippet: contents.split('\n')[line - 1].trim(),
      });
    }
  }
}

if (scanned === 0) {
  console.log(
    '[check-process-exit] dormant: no bin/lib-ts/ or src/ TS source found yet (pre-port).'
  );
  process.exit(0);
}

if (violations.length === 0) {
  console.log(
    `[check-process-exit] OK: ${scanned} files scanned; only allowlisted exit sites found.`
  );
  process.exit(0);
}

console.error('[check-process-exit] FAIL: disallowed early-exit call outside the allowlist.');
console.error('Allowlist (per ADR-006):');
for (const a of ALLOWLIST) console.error(`  - ${a}`);
console.error('');
console.error('Violations:');
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  ${v.snippet}`);
}
process.exit(1);
