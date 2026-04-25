#!/usr/bin/env node
/**
 * count-drift-catches.mjs — T3.7 metrics rollup.
 *
 * Aggregates one or more contract-harness reports (produced by
 * `scripts/extract-public-surface.mjs`) into a regression-share summary
 * suitable for weekly trend reporting.
 *
 * Usage:
 *   node scripts/count-drift-catches.mjs [<input-dir-or-file> ...]
 *
 * Default input: `.jumpstart/metrics/drift-catches.json` (current run).
 * If invoked with multiple inputs (e.g. CI artifact rollup), it merges
 * incidents across runs and computes per-week aggregates from the
 * embedded `timestamp` field.
 *
 * Output: `.jumpstart/metrics/regression-share.json`. Schema:
 *   {
 *     "generatedAt": ISO8601,
 *     "windowStart": ISO8601,           // earliest timestamp seen
 *     "windowEnd": ISO8601,             // latest timestamp seen
 *     "totalRuns": N,
 *     "totalIncidents": N,
 *     "runsWithIncidents": N,
 *     "incidentsByType": { "missing_method": N, ... },
 *     "topClasses": [{ "class": "Foo", "count": N }, ...]   // most-drifted classes
 *   }
 *
 * Dormant pattern: with no inputs and no drift-catches.json on disk, the
 * script emits an empty rollup and exits 0. Once the harness has run at
 * least once, the rollup populates.
 *
 * @see scripts/extract-public-surface.mjs (input producer)
 * @see specs/architecture.md §Drift-catches log + Regression-share metric
 * @see specs/implementation-plan.md T3.7
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

const DEFAULT_INPUT = '.jumpstart/metrics/drift-catches.json';
const OUTPUT_PATH = '.jumpstart/metrics/regression-share.json';

const inputs = process.argv.slice(2);
const sources = inputs.length === 0 ? [DEFAULT_INPUT] : inputs;

const reports = [];
for (const src of sources) {
  if (!existsSync(src)) {
    console.warn(`[count-drift-catches] skipping missing input: ${src}`);
    continue;
  }
  const stat = statSync(src);
  if (stat.isDirectory()) {
    for (const f of readdirSync(src)) {
      if (f.endsWith('.json')) {
        reports.push(JSON.parse(readFileSync(path.join(src, f), 'utf8')));
      }
    }
  } else {
    reports.push(JSON.parse(readFileSync(src, 'utf8')));
  }
}

let windowStart = null;
let windowEnd = null;
let totalIncidents = 0;
let runsWithIncidents = 0;
const incidentsByType = {};
const classCounts = {};

for (const r of reports) {
  const ts = r.timestamp ?? null;
  if (ts) {
    if (!windowStart || ts < windowStart) windowStart = ts;
    if (!windowEnd || ts > windowEnd) windowEnd = ts;
  }
  const incidents = Array.isArray(r.incidents) ? r.incidents : [];
  totalIncidents += incidents.length;
  if (incidents.length > 0) runsWithIncidents++;
  for (const i of incidents) {
    incidentsByType[i.type] = (incidentsByType[i.type] ?? 0) + 1;
    const cls = i.expected?.class;
    if (cls) classCounts[cls] = (classCounts[cls] ?? 0) + 1;
  }
}

const topClasses = Object.entries(classCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .map(([cls, count]) => ({ class: cls, count }));

const rollup = {
  generatedAt: new Date().toISOString(),
  windowStart,
  windowEnd,
  totalRuns: reports.length,
  totalIncidents,
  runsWithIncidents,
  regressionShare: reports.length === 0 ? 0 : runsWithIncidents / reports.length,
  incidentsByType,
  topClasses,
};

mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(rollup, null, 2));

console.log(
  `[count-drift-catches] ${rollup.totalRuns} runs, ${rollup.totalIncidents} incidents, regression-share ${(rollup.regressionShare * 100).toFixed(1)}% — wrote ${OUTPUT_PATH}.`
);
