#!/usr/bin/env node
/**
 * verify-baseline.mjs — T2.14 + E1-S4 + Checkpoint C2.
 *
 * Aggregates the M0 acceptance gate into one machine-readable JSON output:
 *   1. npm test (full suite green)
 *   2. tsc --noEmit
 *   3. biome check
 *   4. tsdown build (dist/ artifacts emitted)
 *   5. node bin/holodeck.js --scenario baseline (PASS)
 *   6. npm audit --audit-level=high
 *
 * Exits 0 only if all six pass. Used by Checkpoint C2 (Samuel approves M0
 * before M1 begins). Also locally by Developer to confirm baseline before
 * any commit.
 *
 * @see specs/implementation-plan.md T2.14
 */

import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';

const checks = [];

function run(name, cmd, args, opts = {}) {
  const start = Date.now();
  try {
    const stdout = execFileSync(cmd, args, {
      stdio: opts.captureStderr ? ['ignore', 'pipe', 'pipe'] : 'pipe',
      encoding: 'utf8',
      env: opts.env ?? process.env,
    });
    checks.push({
      name,
      status: 'PASS',
      durationMs: Date.now() - start,
      output: stdout.slice(-500),
    });
    return true;
  } catch (err) {
    const output = (err.stdout || '') + (err.stderr || '');
    checks.push({
      name,
      status: 'FAIL',
      durationMs: Date.now() - start,
      exitCode: err.status,
      output: String(output).slice(-1000),
    });
    return false;
  }
}

console.log('[verify-baseline] running M0 acceptance gates...');

run('vitest-full-suite', 'npx', ['vitest', 'run']);
run('tsc-noemit', 'npx', ['tsc', '--noEmit']);
run('biome-check', 'npx', ['biome', 'check', '--error-on-warnings', '.']);
run('tsdown-build', 'npx', ['tsdown']);
// dist-exports must run AFTER tsdown so dist/ is fresh.
run('dist-exports', 'node', ['scripts/check-dist-exports.mjs']);
run('check-public-any', 'node', ['scripts/check-public-any.mjs']);
run('check-process-exit', 'node', ['scripts/check-process-exit.mjs']);
// Cross-module contract harness (T3.1): drift detection. Runs default
// scan (bin/lib + bin/lib-ts) and writes .jumpstart/metrics/drift-catches.json.
// Failure mode: HARNESS_FAIL_ON_DRIFT=1 makes the script exit nonzero when
// incidents > 0. The vitest harness test independently asserts both the
// zero-drift main case AND the 8-incident synthetic-fixture case.
run('contract-harness', 'node', ['scripts/extract-public-surface.mjs'], {
  env: { ...process.env, HARNESS_FAIL_ON_DRIFT: '1' },
});
if (existsSync('bin/holodeck.js')) {
  run('holodeck-baseline', 'node', ['bin/holodeck.js', '--scenario', 'baseline']);
}
run('npm-audit-high', 'npm', ['audit', '--audit-level=high']);

const allPass = checks.every((c) => c.status === 'PASS');
const report = {
  timestamp: new Date().toISOString(),
  overall: allPass ? 'PASS' : 'FAIL',
  passed: checks.filter((c) => c.status === 'PASS').length,
  failed: checks.filter((c) => c.status === 'FAIL').length,
  total: checks.length,
  checks,
};

writeFileSync('.jumpstart/state/baseline-verification.json', JSON.stringify(report, null, 2));

console.log('');
console.log(
  `[verify-baseline] ${report.overall} — ${report.passed}/${report.total} checks passed.`
);
for (const c of checks) {
  const tag = c.status === 'PASS' ? 'OK' : 'FAIL';
  console.log(
    `  [${tag}] ${c.name} (${c.durationMs}ms)${c.status === 'FAIL' ? ` exit=${c.exitCode}` : ''}`
  );
}
console.log('');
console.log('Report written: .jumpstart/state/baseline-verification.json');

process.exit(allPass ? 0 : 1);
