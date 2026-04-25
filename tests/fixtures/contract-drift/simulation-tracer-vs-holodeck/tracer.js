/**
 * Synthetic contract-drift fixture (T3.2). Replicates the pre-v1.1.14 state
 * of `bin/lib/simulation-tracer.js`: 4 methods declared, holodeck.js calls
 * 12. The harness must report exactly 8 `missing_method` drift incidents.
 *
 * DO NOT "fix" by adding the missing methods — that defeats the test.
 * If this fixture's drift count changes, the harness has regressed.
 *
 * @see ./README.md
 */

'use strict';

class Tracer {
  constructor() {
    this.events = [];
  }

  // 1. Declared.
  startPhase(name) {
    this.events.push({ kind: 'startPhase', name });
  }

  // 2. Declared.
  endPhase(name) {
    this.events.push({ kind: 'endPhase', name });
  }

  // 3. Declared.
  logArtifact(artifact) {
    this.events.push({ kind: 'logArtifact', artifact });
  }

  // 4. Declared.
  getReport() {
    return { events: this.events };
  }

  // (logError, logWarning, logSubagentVerified, logDocumentCreation,
  //  logCostTracking, logHandoffValidation, printSummary, saveReport
  //  are all called by holodeck.js but NOT declared here. That is the
  //  drift the harness must catch.)
}

module.exports = Tracer;
