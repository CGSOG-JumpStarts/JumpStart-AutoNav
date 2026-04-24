#!/usr/bin/env node
/**
 * check-dist-exports.mjs — build-output integrity gate (QA finding).
 *
 * Asserts that tsdown's emitted dist/ matches the contract of the source:
 *   1. For every entry in tsdown.config.ts, dist/ contains:
 *        - <entry>.mjs        (compiled module)
 *        - <entry>.d.mts      (type declaration)
 *        - <entry>.mjs.map    (sourcemap)
 *   2. For every named export in the source, the .d.mts exports the same name.
 *      (Catches "tsdown silently dropped a symbol" regressions that otherwise
 *      only surface when a downstream consumer fails to resolve an import.)
 *   3. Shebang preservation on CLI entries (anything matching cli|main).
 *
 * This is the killer QA gate: without it, a tsdown bug or a misconfigured
 * `entry` array could ship a stripped d.ts to npm and we'd find out when a
 * Claude Code agent's `import { ... } from 'jumpstart-mode'` fails at
 * runtime in a customer environment.
 *
 * Dormant pattern: until tsdown.config.ts has more than the smoke entry,
 * the script only checks the smoke artifact. As ports add entries, the
 * check expands automatically.
 *
 * @see specs/decisions/adr-001-build-tool.md
 * @see specs/architecture.md SEC-005 (post-build assertion)
 * @see specs/implementation-plan.md T2.1 + Pit Crew QA finding
 */

import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = process.cwd();
const DIST_DIR = path.join(REPO_ROOT, 'dist');
const TSDOWN_CONFIG = path.join(REPO_ROOT, 'tsdown.config.ts');

if (!existsSync(DIST_DIR)) {
  console.log('[check-dist-exports] dormant: dist/ not built yet (run `npm run build`).');
  process.exit(0);
}

if (!existsSync(TSDOWN_CONFIG)) {
  console.error('[check-dist-exports] FAIL: tsdown.config.ts not found.');
  process.exit(1);
}

// Parse entry list out of tsdown.config.ts via regex — we deliberately don't
// import the config (that would require ts-node or compiled config). The
// regex matches the literal-string entries inside the entry: [ ... ] block.
//
// We strip line- and block-comments first so commented-out future entries
// (e.g. "// 'src/cli/main.ts',") don't get treated as live. This is
// regex-grade not parser-grade: a string literal containing a literal "//"
// would lose tail content, but the tsdown config never contains those.
const configRaw = readFileSync(TSDOWN_CONFIG, 'utf8');
const config = configRaw
  .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // line comments (preserve URLs after `:`)

const entryBlock = config.match(/entry:\s*\[([\s\S]*?)\]/);
if (!entryBlock) {
  console.error(
    '[check-dist-exports] FAIL: could not locate `entry: [ ... ]` in tsdown.config.ts.'
  );
  process.exit(1);
}

const entries = [...entryBlock[1].matchAll(/['"]([^'"]+\.ts)['"]/g)].map((m) => m[1]);

if (entries.length === 0) {
  console.log('[check-dist-exports] dormant: tsdown.config.ts entry list is empty.');
  process.exit(0);
}

const failures = [];

for (const entry of entries) {
  const sourcePath = path.join(REPO_ROOT, entry);
  const baseName = path.basename(entry, '.ts');
  const mjsPath = path.join(DIST_DIR, `${baseName}.mjs`);
  const dtsPath = path.join(DIST_DIR, `${baseName}.d.mts`);
  const mapPath = path.join(DIST_DIR, `${baseName}.mjs.map`);

  if (!existsSync(sourcePath)) {
    failures.push(`source missing: ${entry}`);
    continue;
  }
  if (!existsSync(mjsPath)) {
    failures.push(`compiled module missing: dist/${baseName}.mjs (entry: ${entry})`);
    continue;
  }
  if (!existsSync(dtsPath)) {
    failures.push(`type declaration missing: dist/${baseName}.d.mts (entry: ${entry})`);
    continue;
  }
  if (!existsSync(mapPath)) {
    failures.push(`sourcemap missing: dist/${baseName}.mjs.map (entry: ${entry})`);
    continue;
  }

  // Extract named exports from source. This is regex-grade not parser-grade
  // — sufficient for the contract we care about (named exports, exported
  // function/const/class/type/interface declarations).
  const source = readFileSync(sourcePath, 'utf8');
  const sourceExports = new Set();
  for (const m of source.matchAll(
    /export\s+(?:async\s+)?(?:function|const|let|var|class|type|interface)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g
  )) {
    sourceExports.add(m[1]);
  }
  for (const m of source.matchAll(/export\s*\{\s*([^}]+)\s*\}/g)) {
    for (const name of m[1].split(',')) {
      const trimmed = name
        .trim()
        .split(/\s+as\s+/)[0]
        .trim();
      if (trimmed) sourceExports.add(trimmed);
    }
  }

  if (sourceExports.size === 0) continue; // no named exports to verify

  const dts = readFileSync(dtsPath, 'utf8');
  for (const name of sourceExports) {
    // Match: `export ... <name>` or `export { ..., <name>, ... }` or
    //        `<name>` appearing after `declare`. The d.ts may rename or
    //        wrap, but the symbol must appear somewhere in an export
    //        position.
    const exportRe = new RegExp(
      `export\\s+(?:declare\\s+)?(?:async\\s+)?(?:function|const|let|var|class|type|interface|\\{[^}]*\\b${name}\\b)`,
      'g'
    );
    if (!exportRe.test(dts) || !dts.includes(name)) {
      failures.push(
        `export drift: source ${entry} exports \`${name}\` but dist/${baseName}.d.mts does not.`
      );
    }
  }

  // Shebang preservation for CLI-flagged entries.
  if (/(?:^|\/)(?:cli|main|bootstrap)\b/.test(entry)) {
    const sourceShebang = source.startsWith('#!');
    if (sourceShebang) {
      const compiled = readFileSync(mjsPath, 'utf8');
      if (!compiled.startsWith('#!')) {
        failures.push(
          `shebang stripped: ${entry} starts with #! but dist/${baseName}.mjs does not.`
        );
      }
    }
  }
}

if (failures.length === 0) {
  console.log(
    `[check-dist-exports] OK: ${entries.length} entries verified (mjs + d.mts + map present, exports match, shebangs preserved).`
  );
  process.exit(0);
}

console.error('[check-dist-exports] FAIL: dist/ does not match source contract.');
for (const f of failures) console.error(`  - ${f}`);
process.exit(1);
