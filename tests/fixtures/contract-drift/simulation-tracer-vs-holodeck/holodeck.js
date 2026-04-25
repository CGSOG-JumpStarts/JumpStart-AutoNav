/**
 * Synthetic contract-drift fixture (T3.2). Calls 12 methods on a Tracer
 * instance; only 4 are declared in tracer.js. The harness must report
 * exactly 8 `missing_method` drift incidents.
 *
 * DO NOT delete or rename the calls — that defeats the test.
 *
 * @see ./README.md
 */

'use strict';

const Tracer = require('./tracer');

function runScenario() {
  const tracer = new Tracer();

  // Calls 1-4: declared. No drift.
  tracer.startPhase('phase-1');
  tracer.endPhase('phase-1');
  tracer.logArtifact({ kind: 'spec', path: 'specs/foo.md' });
  tracer.getReport();

  // Calls 5-12: NOT declared on Tracer. Each is a drift incident.
  tracer.logError({ message: 'boom' });               // 5 — missing_method
  tracer.logWarning({ message: 'careful' });          // 6 — missing_method
  tracer.logSubagentVerified({ agent: 'qa' });        // 7 — missing_method
  tracer.logDocumentCreation({ path: 'docs/x.md' });  // 8 — missing_method
  tracer.logCostTracking({ tokens: 1234 });           // 9 — missing_method
  tracer.logHandoffValidation({ phase: 'developer' });// 10 — missing_method
  tracer.printSummary();                              // 11 — missing_method
  tracer.saveReport('/tmp/report.json');              // 12 — missing_method
}

module.exports = { runScenario };
