/**
 * test-public-surface.test.ts — T3.1 + T3.3 acceptance gate.
 *
 * Two assertions per Checkpoint C3:
 *   1. Run harness against current `bin/lib/` + `bin/lib-ts/` (i.e. v1.1.14
 *      main + any sub-commits since the rewrite-baseline tag) — must
 *      report ZERO drift incidents.
 *   2. Run harness against the synthetic T3.2 fixture — must report
 *      EXACTLY 8 `missing_method` incidents, each with a `file:line`
 *      reference.
 *
 * If either fails, the harness has either (a) silently broken or (b)
 * accidentally surfaced a real drift in main that needs a fix-drift PR.
 *
 * @see scripts/extract-public-surface.mjs
 * @see specs/implementation-plan.md T3.1, T3.2, T3.3, Checkpoint C3
 * @see tests/fixtures/contract-drift/simulation-tracer-vs-holodeck/README.md
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const harness = path.join(repoRoot, 'scripts/extract-public-surface.mjs');

interface DriftReport {
  timestamp: string;
  scanned: {
    tsFiles: number;
    jsFiles: number;
    callSites: number;
  };
  incidents: Array<{
    type: 'missing_method';
    callSite: { file: string; line: number; snippet: string };
    expected: { class: string; declaredIn: string };
    actual: { calledMethod: string; varName: string };
  }>;
}

function runHarness(rootArg: string | null): DriftReport {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'drift-test-'));
  const outPath = path.join(tmpDir, 'drift.json');
  const args = [harness, `--out=${outPath}`];
  if (rootArg) args.push(`--root=${rootArg}`);

  execFileSync('node', args, { cwd: repoRoot, stdio: 'pipe' });
  const report = JSON.parse(readFileSync(outPath, 'utf8')) as DriftReport;
  rmSync(tmpDir, { recursive: true, force: true });
  return report;
}

describe('public-surface contract harness (T3.1 + T3.3 acceptance)', () => {
  beforeAll(() => {
    if (!existsSync(harness)) {
      throw new Error(`harness script missing at ${harness}; T3.1 implementation incomplete.`);
    }
  });

  it('reports zero drift on current main (T3.3 acceptance #1)', () => {
    // Default scan roots: bin/lib + bin/lib-ts (set by the script itself).
    const report = runHarness(null);

    // Strangler phase invariant: at least one TS file (the smoke canary)
    // and many JS files (~159 legacy modules at v1.1.14-baseline).
    expect(report.scanned.tsFiles).toBeGreaterThanOrEqual(1);
    expect(report.scanned.jsFiles).toBeGreaterThanOrEqual(100);
    expect(report.scanned.callSites).toBeGreaterThan(1000);

    // The killer assertion: ZERO drift on current main. If this regresses,
    // either a port introduced an accidental method-call drift, or the
    // harness has a false-positive bug. Either way, CI must block.
    if (report.incidents.length > 0) {
      const summary = report.incidents
        .slice(0, 5)
        .map(
          (i) =>
            `  ${i.callSite.file}:${i.callSite.line}  ${i.actual.varName}.${i.actual.calledMethod}() not declared on ${i.expected.class} (${i.expected.declaredIn})`
        )
        .join('\n');
      throw new Error(
        `Drift detected on current main (${report.incidents.length} incidents). First 5:\n${summary}`
      );
    }
    expect(report.incidents).toHaveLength(0);
  });

  it('reports EXACTLY 8 incidents on the simulation-tracer-vs-holodeck fixture (T3.3 acceptance #2)', () => {
    const fixtureRoot = 'tests/fixtures/contract-drift/simulation-tracer-vs-holodeck';
    const report = runHarness(fixtureRoot);

    expect(report.scanned.jsFiles).toBe(2);
    expect(report.incidents).toHaveLength(8);

    // Every incident must point to the holodeck.js call site (the bug
    // location), NOT the tracer.js declaration site.
    for (const incident of report.incidents) {
      expect(incident.type).toBe('missing_method');
      expect(incident.callSite.file).toContain('holodeck.js');
      expect(incident.expected.class).toBe('Tracer');
      expect(incident.actual.varName).toBe('tracer');
      expect(incident.callSite.line).toBeGreaterThan(0);
      expect(incident.callSite.snippet).toMatch(/tracer\.\w+\(/);
    }

    // The 8 missing methods are exactly these — anchored to the original
    // simulation-tracer.js bug. Order is by call-site line number.
    const missingMethods = report.incidents.map((i) => i.actual.calledMethod);
    expect(missingMethods).toEqual([
      'logError',
      'logWarning',
      'logSubagentVerified',
      'logDocumentCreation',
      'logCostTracking',
      'logHandoffValidation',
      'printSummary',
      'saveReport',
    ]);
  });
});
