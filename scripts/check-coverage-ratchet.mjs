#!/usr/bin/env node
/**
 * check-coverage-ratchet.mjs — T2.2 + E1-S4.
 *
 * Reads a fresh coverage report (assumed at coverage/coverage-summary.json)
 * and compares against the committed baseline (tests/coverage-baseline.json).
 * Fails CI if any per-file line/branch/function coverage drops more than
 * RATCHET_TOLERANCE percentage points below baseline.
 *
 * Usage:
 *   1. npx vitest run --coverage  (produces coverage/coverage-summary.json)
 *   2. node scripts/check-coverage-ratchet.mjs
 *
 * Exit 0 = at-or-above baseline. Exit 1 = regression (CI block).
 *
 * Updating baseline: when coverage genuinely improves, the developer commits
 * the new tests/coverage-baseline.json in the same PR (the script auto-writes
 * a candidate to tests/coverage-baseline.candidate.json for review).
 *
 * @see specs/decisions/adr-005-module-layout.md
 * @see specs/implementation-plan.md T2.2, E1-S4
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const BASELINE_PATH = 'tests/coverage-baseline.json';
const SUMMARY_PATH = 'coverage/coverage-summary.json';
const CANDIDATE_PATH = 'tests/coverage-baseline.candidate.json';
const RATCHET_TOLERANCE = 0.5; // percentage points

if (!existsSync(SUMMARY_PATH)) {
  console.log(
    `[coverage-ratchet] no coverage report at ${SUMMARY_PATH}; run \`npx vitest run --coverage\` first.`
  );
  process.exit(0); // dormant — not a failure if coverage didn't run
}

const summary = JSON.parse(readFileSync(SUMMARY_PATH, 'utf8'));

if (!existsSync(BASELINE_PATH)) {
  // First run: emit candidate baseline for the developer to commit.
  writeFileSync(CANDIDATE_PATH, JSON.stringify(summary, null, 2));
  console.log(`[coverage-ratchet] no baseline at ${BASELINE_PATH}`);
  console.log(
    `[coverage-ratchet] candidate written to ${CANDIDATE_PATH}; review and commit as the baseline.`
  );
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));

const regressions = [];
for (const [file, current] of Object.entries(summary)) {
  if (file === 'total') continue;
  const base = baseline[file];
  if (!base) continue; // new file — accepted on next baseline rev
  for (const metric of ['lines', 'branches', 'functions', 'statements']) {
    const curPct = current[metric]?.pct ?? 100;
    const basePct = base[metric]?.pct ?? 100;
    if (curPct + RATCHET_TOLERANCE < basePct) {
      regressions.push({
        file,
        metric,
        from: basePct,
        to: curPct,
        delta: (curPct - basePct).toFixed(1),
      });
    }
  }
}

if (regressions.length === 0) {
  console.log(
    `[coverage-ratchet] OK: per-file coverage at or above baseline (tolerance ${RATCHET_TOLERANCE}pp).`
  );
  process.exit(0);
}

console.error('[coverage-ratchet] FAIL: per-file coverage regressed.');
for (const r of regressions) {
  console.error(`  ${r.file} [${r.metric}]: ${r.from}% -> ${r.to}% (${r.delta}pp)`);
}
console.error('');
console.error('Add tests OR document why this regression is acceptable in the PR description.');
console.error('To intentionally lower the baseline, edit tests/coverage-baseline.json directly.');
process.exit(1);
