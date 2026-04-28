/**
 * holodeck.ts — Jump Start E2E Simulation Runner port (T4.6.1, cluster M7).
 *
 * Pure-library port of `bin/holodeck.js` AND `bin/lib/holodeck.js` — the
 * two legacy files are byte-identical (verified via `diff`; both 512L).
 * This single TS module replaces both.
 *
 * Public surface preserved verbatim by name + signature shape:
 *
 *   - `runHolodeck(scenario, options?)` => Promise<HolodeckReport>
 *   - `runAllScenarios(options)` => Promise<ScenarioRunResult[]>
 *   - `listScenarios(options?)` => string[]
 *   - `setupTempProject(scenario, options?)` => string
 *   - `copyArtifacts(srcDir, targetDir, artifacts, tracer)` => string[]
 *   - `validateCurrentArtifacts(targetDir, phase, tracer, verbose?)` => string[]
 *   - `verifySubagentTraces(targetDir, phase, expectedSubagents, tracer)` => void
 *   - `verifyFinalState(targetDir, tracer)` => void
 *   - `PHASE_CONFIG` constant
 *
 * Behavior parity:
 *   - Six-phase Golden Master simulation (scout/challenger/analyst/pm/
 *     architect/developer) runs scenarios from `tests/e2e/scenarios/`.
 *   - Per-phase: INJECT (copy fixtures) → MOCK (write usage log) →
 *     VALIDATE (artifact + structure) → VERIFY-SUBAGENTS (optional) →
 *     HANDOFF (contract check vs upstream) → STATE (update workflow).
 *   - Subagent trace verification regex catalog preserved.
 *   - Reports persisted as timestamped JSON.
 *
 * **ADR-012 redaction (NEW in this port).**
 *   The simulation report is the only persistence path holodeck owns
 *   directly (everything else delegates to other modules whose redaction
 *   is enforced at their own boundary). `tracer.saveReport` is the
 *   delegated path, but we ALSO redact at `runHolodeck` level for the
 *   `report` value before any caller-controlled persistence in
 *   `runAllScenarios`. The tracer port (sibling, T4.6.x) is responsible
 *   for redacting its own `saveReport` write.
 *
 * **Path-safety hardening (NEW in this port).**
 *   Every `path.join(projectRoot, scenarioOrUserInput)` is gated by
 *   `assertInsideRoot`. Scenarios from `tests/e2e/scenarios/` come from
 *   the filesystem and could theoretically be a symlink; the boundary
 *   asserts containment within the project root.
 *
 * **JSON shape validation.**
 *   Holodeck doesn't load JSON config of its own — the only JSON it
 *   touches is the report it writes (no parse path). Scenario fixtures
 *   are markdown files, which are validated by `validator.ts`.
 *
 * **Deferred to M9 ESM cutover:**
 *   - The `main()` CLI entry block at the bottom of legacy
 *     `bin/holodeck.js` (lines 473-512) is NOT ported. It uses
 *     `process.exit` which library code is forbidden to call per
 *     ADR-006. CLI orchestration moves back into `bin/holodeck.js` at
 *     M8 (T4.7.x) or stays as legacy until M9 ESM.
 *   - `parseArgs()` and `printHelp()` are NOT ported — they are CLI
 *     concerns. Caller (CLI wrapper at M8/M9) constructs the
 *     `HolodeckOptions` directly.
 *   - `__dirname` removed: legacy used `path.join(__dirname, '..', ...)`
 *     to compute SCENARIOS_DIR/REPORTS_DIR. The TS port accepts these
 *     as optional `projectRoot` / `scenariosDir` / `reportsDir` options
 *     defaulting to `process.cwd()`-relative paths. Caller (CLI wrapper)
 *     resolves the package root explicitly.
 *
 * @see bin/holodeck.js (legacy reference — byte-identical to bin/lib/holodeck.js)
 * @see bin/lib/holodeck.js (legacy reference — byte-identical to bin/holodeck.js)
 * @see specs/decisions/adr-012-secrets-redaction-in-logs.md
 * @see specs/implementation-plan.md T4.6.1
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import * as path from 'node:path';
// Sibling-module ports (simulation-tracer, handoff-validator) landed under
// T4.6.x. They expose typed surfaces; the duck-typed `any` shims used
// during the strangler phase are no longer required.
import { generateHandoffReport } from './handoff-validator.js';
import { assertInsideRoot } from './path-safety.js';
import { redactSecrets } from './secret-scanner.js';
import { SimulationTracer } from './simulation-tracer.js';
import { resetState, updateState } from './state-store.js';
import { logUsage, summarizeUsage } from './usage.js';
import { checkApproval, validateMarkdownStructure } from './validator.js';

// ─────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────

export interface PhaseDefinition {
  name: string;
  dir: string;
  artifacts: string[];
  hasSubagents: boolean;
  expectedSubagents?: string[];
}

export interface HolodeckOptions {
  /** Run subagent trace verification (strict mode). */
  verifySubagents?: boolean;
  /** Verbose console logging. */
  verbose?: boolean;
  /** Output directory for the run report. Defaults to `<projectRoot>/tests/e2e/reports`. */
  output?: string;
  /** Project root for default path resolution. Defaults to `process.cwd()`. */
  projectRoot?: string;
  /** Scenarios directory. Defaults to `<projectRoot>/tests/e2e/scenarios`. */
  scenariosDir?: string;
  /** Reports directory. Defaults to `<projectRoot>/tests/e2e/reports`. */
  reportsDir?: string;
  /** Handoffs directory (handoff schemas). Defaults to `<projectRoot>/.jumpstart/handoffs`. */
  handoffsDir?: string;
}

export interface PhaseReport {
  name: string;
  status: string;
  startTime?: number;
  endTime?: number | null;
  artifacts?: string[];
  toolCalls?: number;
  llmCalls?: number;
  errors?: string[];
  promptTokens?: number;
  completionTokens?: number;
}

export interface HolodeckReport {
  scenario?: string;
  timestamp?: string;
  success?: boolean;
  phases?: PhaseReport[];
  errors?: Array<{ message: string; phase?: string }>;
  warnings?: Array<{ message: string }>;
  verifiedSubagents?: Array<{ agent: string; phase?: string }>;
  documentCreations?: Array<{ document: string; status: string }>;
  handoffValidations?: Array<{ status: string; errors?: string[] }>;
  costTracking?: { totalPromptTokens: number; totalCompletionTokens: number };
  headless?: Record<string, unknown>;
  // Forward-compatible: tracer can attach arbitrary fields.
  [key: string]: unknown;
}

export interface ScenarioRunResult {
  scenario: string;
  success: boolean;
  report?: HolodeckReport;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Constants (preserved verbatim from legacy)
// ─────────────────────────────────────────────────────────────────────────

export const PHASE_CONFIG: PhaseDefinition[] = [
  {
    name: 'scout',
    dir: '00-scout',
    artifacts: ['codebase-context.md', 'insights.md'],
    hasSubagents: false,
  },
  {
    name: 'challenger',
    dir: '01-challenger',
    artifacts: ['challenger-brief.md', 'insights.md'],
    hasSubagents: false,
  },
  {
    name: 'analyst',
    dir: '02-analyst',
    artifacts: ['product-brief.md', 'insights.md'],
    hasSubagents: false,
  },
  {
    name: 'pm',
    dir: '03-pm',
    artifacts: ['prd.md', 'insights.md'],
    hasSubagents: false,
  },
  {
    name: 'architect',
    dir: '04-architect',
    artifacts: ['architecture.md', 'implementation-plan.md', 'insights.md'],
    hasSubagents: true,
    expectedSubagents: ['Jump Start: Security'],
  },
  {
    name: 'developer',
    dir: '05-developer',
    artifacts: ['TODO.md'],
    hasSubagents: false,
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Path resolution helpers
// ─────────────────────────────────────────────────────────────────────────

interface ResolvedPaths {
  projectRoot: string;
  scenariosDir: string;
  reportsDir: string;
  handoffsDir: string;
}

function resolvePaths(options: HolodeckOptions = {}): ResolvedPaths {
  const projectRoot = options.projectRoot || process.cwd();
  const scenariosDir = options.scenariosDir || path.join(projectRoot, 'tests', 'e2e', 'scenarios');
  const reportsDir = options.reportsDir || path.join(projectRoot, 'tests', 'e2e', 'reports');
  const handoffsDir = options.handoffsDir || path.join(projectRoot, '.jumpstart', 'handoffs');
  return { projectRoot, scenariosDir, reportsDir, handoffsDir };
}

// ─────────────────────────────────────────────────────────────────────────
// Scenario discovery
// ─────────────────────────────────────────────────────────────────────────

/**
 * List available scenario names. Each scenario is a subdirectory under
 * `<scenariosDir>` with an optional `config.yaml`. Returns only the
 * directory names; presence/absence of `config.yaml` is reported via
 * stdout when called as a CLI but is not part of the public return shape.
 */
export function listScenarios(options: HolodeckOptions = {}): string[] {
  const { scenariosDir } = resolvePaths(options);
  if (!existsSync(scenariosDir)) {
    return [];
  }

  const scenarios = readdirSync(scenariosDir).filter((f) => {
    // Defense in depth: refuse to list anything whose absolute resolution
    // escapes the scenarios root (symlink → /etc, etc.). `assertInsideRoot`
    // is called for each entry; failures are skipped (the read-side
    // semantics here are advisory, not security-critical — extraction
    // happens in `setupTempProject`/`copyArtifacts` where the same gate
    // is reapplied at write time).
    try {
      assertInsideRoot(f, scenariosDir, { schemaId: 'holodeck-listScenarios' });
    } catch {
      return false;
    }
    return statSync(path.join(scenariosDir, f)).isDirectory();
  });

  return scenarios;
}

// ─────────────────────────────────────────────────────────────────────────
// Workspace setup
// ─────────────────────────────────────────────────────────────────────────

/**
 * Create a temporary project directory under
 * `<projectRoot>/tests/e2e/.tmp/<scenario>` and prime it with the
 * directory layout the simulation expects. Existing tmpdir is cleaned.
 */
export function setupTempProject(scenario: string, options: HolodeckOptions = {}): string {
  const { projectRoot } = resolvePaths(options);
  // Pit Crew M7: scenario name is user-supplied (or comes from
  // `listScenarios`, which already filters). Re-validate at the
  // write boundary — `..` traversal would let a malicious scenario
  // name `rm -rf` outside the tmpdir.
  assertInsideRoot(scenario, path.join(projectRoot, 'tests', 'e2e', '.tmp'), {
    schemaId: 'holodeck-setupTempProject',
  });

  const tmpDir = path.join(projectRoot, 'tests', 'e2e', '.tmp', scenario);

  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true });
  }
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(path.join(tmpDir, 'specs', 'insights'), { recursive: true });
  mkdirSync(path.join(tmpDir, 'specs', 'decisions'), { recursive: true });
  mkdirSync(path.join(tmpDir, '.jumpstart', 'state'), { recursive: true });

  resetState(path.join(tmpDir, '.jumpstart', 'state', 'state.json'));

  return tmpDir;
}

// ─────────────────────────────────────────────────────────────────────────
// Tracer interface (duck-typed; sibling port lands T4.6.x)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Subset of the `SimulationTracer` API that holodeck depends on. Mirrors
 * what's pinned by `tests/test-headless.test.js` ("Holodeck Tracer API"
 * suite). Once the sibling tracer port lands the import above will
 * provide this interface natively; until then this `TracerLike` shape
 * lets us work against the JS class without TS narrowing complaints.
 */
export interface TracerLike {
  startPhase(name: string): void;
  endPhase(name: string, status: string): void;
  logArtifact(name: string): void;
  logError(message: string, phase?: string): void;
  logWarning(message: string): void;
  logSubagentVerified(agent: string): void;
  logDocumentCreation(document: string, status: string): void;
  logCostTracking(promptTokens: number, completionTokens: number): void;
  logHandoffValidation(status: string, report?: unknown): void;
  // Optional method (legacy didn't expose it on every code path).
  printSummary?(): void;
  saveReport?(reportPath: string): void;
  getReport(): HolodeckReport;
}

// ─────────────────────────────────────────────────────────────────────────
// Artifact handling
// ─────────────────────────────────────────────────────────────────────────

/**
 * Copy artifacts from a Golden Master scenario directory into the
 * simulation's `specs/` tree. `insights.md` is routed to
 * `specs/insights/`; everything else goes to `specs/`. Missing source
 * files are logged as warnings and skipped (not fatal — scout-only
 * scenarios may legitimately omit phases).
 */
export function copyArtifacts(
  srcDir: string,
  targetDir: string,
  artifacts: string[],
  tracer: TracerLike
): string[] {
  if (!existsSync(srcDir)) {
    tracer.logWarning(`Source directory not found: ${srcDir}`);
    return [];
  }

  const copied: string[] = [];
  for (const artifact of artifacts) {
    // Path-safety: artifact names come from PHASE_CONFIG (constants in
    // this module) but defense-in-depth still asserts the join lands
    // inside both srcDir and targetDir.
    try {
      assertInsideRoot(artifact, srcDir, { schemaId: 'holodeck-copyArtifacts-src' });
      const targetParent =
        artifact === 'insights.md'
          ? path.join(targetDir, 'specs', 'insights')
          : path.join(targetDir, 'specs');
      assertInsideRoot(artifact, targetParent, { schemaId: 'holodeck-copyArtifacts-target' });
    } catch {
      // Skip suspect artifact name silently — the tracer.logWarning hook
      // is reserved for missing-source semantics, not malicious-input
      // semantics. Production CLI surfaces a ValidationError separately.
      continue;
    }

    const srcPath = path.join(srcDir, artifact);
    if (existsSync(srcPath)) {
      const targetPath =
        artifact === 'insights.md'
          ? path.join(targetDir, 'specs', 'insights', artifact)
          : path.join(targetDir, 'specs', artifact);

      const targetDirPath = path.dirname(targetPath);
      if (!existsSync(targetDirPath)) {
        mkdirSync(targetDirPath, { recursive: true });
      }

      copyFileSync(srcPath, targetPath);
      copied.push(artifact);
      tracer.logArtifact(`specs/${artifact}`);
    } else {
      tracer.logWarning(`Artifact not found: ${artifact}`);
    }
  }
  return copied;
}

// ─────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────

/**
 * Run structural validation on the artifacts of a phase. Returns an
 * array of human-readable error strings; an empty array means valid.
 *
 * Skips `insights.md` (no schema) and skips missing artifacts (scout
 * may not run for greenfield projects).
 */
export function validateCurrentArtifacts(
  targetDir: string,
  phase: string,
  tracer: TracerLike,
  verbose = false
): string[] {
  // `tracer` is part of the legacy public surface but no longer used by
  // this function (logging migrated to runHolodeck callsite). Reference
  // it once so Biome doesn't flag the dead param — preserves API compat
  // with callers that pass a tracer through (legacy behavior).
  void tracer;
  const errors: string[] = [];
  const specsDir = path.join(targetDir, 'specs');

  const phaseConfig = PHASE_CONFIG.find((p) => p.name === phase);
  if (!phaseConfig) return errors;

  for (const artifact of phaseConfig.artifacts) {
    if (artifact === 'insights.md') continue;

    const artifactPath = path.join(specsDir, artifact);
    if (!existsSync(artifactPath)) {
      if (verbose) console.log(`  ○ Skipping missing artifact: ${artifact}`);
      continue;
    }

    const content = readFileSync(artifactPath, 'utf8');
    const structureResult = validateMarkdownStructure(content, ['Phase Gate Approval']);
    if (structureResult.missing.length > 0) {
      errors.push(`${artifact}: Missing sections: ${structureResult.missing.join(', ')}`);
    }

    const approvalResult = checkApproval(artifactPath);
    if (!approvalResult.approved && verbose) {
      console.log(`  ○ ${artifact} not yet approved`);
    }
    // Reference the result so Biome/TS don't flag the read as dead code;
    // the side effect is the verbose log above.
    void approvalResult;
  }

  return errors;
}

// ─────────────────────────────────────────────────────────────────────────
// Subagent trace verification
// ─────────────────────────────────────────────────────────────────────────

/**
 * Verify that an `insights.md` file (or `<phase>-insights.md`) records
 * a trace for every expected subagent. Throws an Error with the missing
 * agent list when verification fails.
 *
 * Trace patterns recognized (all case-insensitive):
 *   - "Invoked @<Agent>"
 *   - "**Contribution by <Agent>**"
 *   - "<Agent> ... consultation/invoked/integrated"
 */
export function verifySubagentTraces(
  targetDir: string,
  phase: string,
  expectedSubagents: string[],
  tracer: TracerLike
): void {
  const insightsPath = path.join(targetDir, 'specs', 'insights', 'insights.md');
  const phaseInsightsPath = path.join(targetDir, 'specs', 'insights', `${phase}-insights.md`);

  let content = '';
  if (existsSync(insightsPath)) {
    content += readFileSync(insightsPath, 'utf8');
  }
  if (existsSync(phaseInsightsPath)) {
    content += readFileSync(phaseInsightsPath, 'utf8');
  }

  const missing: string[] = [];
  for (const agent of expectedSubagents) {
    const escaped = agent.replace(':', '\\:');
    const patterns = [
      new RegExp(`Invoked @?${escaped}`, 'i'),
      new RegExp(`Contribution by ${escaped}`, 'i'),
      new RegExp(`${escaped}.*(?:consultation|invoked|integrated)`, 'i'),
    ];

    const found = patterns.some((p) => p.test(content));
    if (found) {
      tracer.logSubagentVerified(agent);
    } else {
      missing.push(agent);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing Subagent Traces: ${missing.join(', ')} not logged in ${phase} insights.`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Final state verification
// ─────────────────────────────────────────────────────────────────────────

/**
 * Record the presence/absence of the final-phase artifacts (TODO.md,
 * implementation-plan.md) in the tracer for the report.
 */
export function verifyFinalState(targetDir: string, tracer: TracerLike): void {
  const todoPath = path.join(targetDir, 'specs', 'TODO.md');
  if (existsSync(todoPath)) {
    tracer.logDocumentCreation('TODO.md', 'CREATED');
  } else {
    tracer.logDocumentCreation('TODO.md', 'MISSING');
  }

  const implPlanPath = path.join(targetDir, 'specs', 'implementation-plan.md');
  if (existsSync(implPlanPath)) {
    tracer.logDocumentCreation('implementation-plan.md', 'CREATED');
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Single-scenario runner
// ─────────────────────────────────────────────────────────────────────────

/**
 * Run a single scenario simulation end-to-end.
 *
 * Per phase: INJECT (copy fixtures) → MOCK (write usage) → VALIDATE →
 * VERIFY-SUBAGENTS (optional) → HANDOFF → STATE update.
 *
 * Returns the tracer report. The report's `success` field aggregates
 * phase status, recorded errors, and handoff validation outcomes.
 */
export async function runHolodeck(
  scenario: string,
  options: HolodeckOptions = {}
): Promise<HolodeckReport> {
  const { verifySubagents = false, verbose = false } = options;
  const { projectRoot, scenariosDir, reportsDir, handoffsDir } = resolvePaths(options);
  const outputDir = options.output || reportsDir;

  // Pit Crew M7 MED (Adversary 6): pre-fix path accepted any
  // `options.output` without containment, so an orchestrator passing
  // `output: '../../.ssh'` would write reports outside the project
  // tree. Post-fix: gate `outputDir` by `assertInsideRoot(projectRoot)`.
  assertInsideRoot(outputDir, projectRoot, { schemaId: 'holodeck-runHolodeck-output' });

  // Path-safety: scenario name may come from CLI argv or scripted callers.
  assertInsideRoot(scenario, scenariosDir, { schemaId: 'holodeck-runHolodeck' });
  const scenarioDir = path.join(scenariosDir, scenario);

  if (!existsSync(scenarioDir)) {
    throw new Error(`Scenario not found: ${scenario}`);
  }

  console.log(`\n🚀 Running Holodeck simulation: ${scenario}`);
  console.log(`   Subagent verification: ${verifySubagents ? 'ENABLED' : 'disabled'}\n`);

  const targetDir = setupTempProject(scenario, options);
  // SimulationTracer is a JS class (sibling port T4.6.x); construct it
  // and treat it as the duck-typed `TracerLike`. The cast is safe because
  // tests/test-headless.test.js pins the surface contract at CI time.
  const tracerInstance = new SimulationTracer(targetDir, scenario) as unknown as TracerLike;
  const tracer: TracerLike = tracerInstance;
  const usageLogPath = path.join(targetDir, '.jumpstart', 'usage-log.json');
  const statePath = path.join(targetDir, '.jumpstart', 'state', 'state.json');

  for (let i = 0; i < PHASE_CONFIG.length; i++) {
    const phase = PHASE_CONFIG[i];
    const phaseSrcDir = path.join(scenarioDir, phase.dir);

    if (!existsSync(phaseSrcDir)) {
      if (verbose) console.log(`  ○ Skipping ${phase.name} (no fixtures)`);
      continue;
    }

    if (verbose) console.log(`\n  ▸ Phase: ${phase.name}`);
    tracer.startPhase(phase.name);

    try {
      // 1. INJECT
      const copied = copyArtifacts(phaseSrcDir, targetDir, phase.artifacts, tracer);
      if (verbose) console.log(`    Copied ${copied.length} artifacts`);

      // 2. MOCK — Write Usage Logs
      logUsage(usageLogPath, {
        agent: phase.name.charAt(0).toUpperCase() + phase.name.slice(1),
        phase: phase.name,
        action: 'generation',
        estimated_tokens: 1000 + Math.floor(Math.random() * 500),
      });

      if (phase.hasSubagents && phase.expectedSubagents) {
        for (const subagent of phase.expectedSubagents) {
          logUsage(usageLogPath, {
            agent: subagent,
            phase: phase.name,
            action: 'consultation',
            estimated_tokens: 300 + Math.floor(Math.random() * 200),
          });
        }
        tracer.logCostTracking(1200, 500);
      } else {
        tracer.logCostTracking(1200, 0);
      }

      // 3. VALIDATE
      const validationErrors = validateCurrentArtifacts(targetDir, phase.name, tracer, verbose);
      if (validationErrors.length > 0) {
        for (const e of validationErrors) tracer.logError(e, phase.name);
        throw new Error(`Validation failed for ${phase.name}: ${validationErrors.join('; ')}`);
      }
      if (verbose) console.log(`    Validation: PASS`);

      // 4. VERIFY SUBAGENTS
      if (verifySubagents && phase.hasSubagents && phase.expectedSubagents) {
        verifySubagentTraces(targetDir, phase.name, phase.expectedSubagents, tracer);
        if (verbose) console.log(`    Subagent traces: VERIFIED`);
      }

      // 5. HANDOFF
      if (i > 0) {
        const upstream = PHASE_CONFIG[i - 1].name;
        const upstreamArtifact = PHASE_CONFIG[i - 1].artifacts[0];
        const upstreamPath = path.join(targetDir, 'specs', upstreamArtifact);

        if (existsSync(upstreamPath) && existsSync(handoffsDir)) {
          const report = generateHandoffReport(upstreamPath, upstream, phase.name, handoffsDir) as {
            valid: boolean;
            errors?: string[];
          };
          if (report.valid) {
            tracer.logHandoffValidation('PASS', report);
            if (verbose) console.log(`    Handoff (${upstream} → ${phase.name}): PASS`);
          } else {
            tracer.logHandoffValidation('FAIL', report);
            if (verbose) {
              const errs = report.errors ? report.errors.join(', ') : '';
              console.log(`    Handoff (${upstream} → ${phase.name}): FAIL - ${errs}`);
            }
          }
        } else {
          tracer.logHandoffValidation('SKIP');
          if (verbose) console.log(`    Handoff: SKIPPED (missing artifacts or schemas)`);
        }
      }

      // 6. STATE
      updateState({ phase: phase.name, status: 'approved' } as never, statePath);

      tracer.endPhase(phase.name, 'PASS');
    } catch (err) {
      const message = (err as Error).message;
      tracer.logError(message, phase.name);
      tracer.endPhase(phase.name, 'FAIL');
      if (!verbose) console.log(`  ✗ ${phase.name}: ${message}`);
    }
  }

  // 7. FINAL
  verifyFinalState(targetDir, tracer);

  // Reference the usage summary so the legacy "side-effect read" is
  // preserved without relying on its return value.
  void summarizeUsage(usageLogPath);
  if (typeof tracer.printSummary === 'function') {
    tracer.printSummary();
  }

  // Persist the report. ADR-012 redaction applied at this boundary.
  // The sibling tracer port (T4.6.x) also redacts on `saveReport` —
  // double redaction is idempotent, so we apply it here as well to
  // cover the path where the JS-class tracer has not yet adopted
  // the redaction shim.
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  const reportPath = path.join(outputDir, `${scenario}-${Date.now()}.json`);

  const rawReport = tracer.getReport();
  const redacted = redactSecrets(rawReport);
  writeFileSync(reportPath, `${JSON.stringify(redacted, null, 2)}\n`, 'utf8');

  console.log(`Report saved: ${reportPath}\n`);

  return redacted;
}

// ─────────────────────────────────────────────────────────────────────────
// Multi-scenario runner
// ─────────────────────────────────────────────────────────────────────────

/**
 * Run every scenario in `<scenariosDir>` sequentially and emit a summary.
 */
export async function runAllScenarios(options: HolodeckOptions = {}): Promise<ScenarioRunResult[]> {
  const scenarios = listScenarios(options);
  if (scenarios.length === 0) {
    console.log('No scenarios to run.');
    return [];
  }

  const results: ScenarioRunResult[] = [];
  for (const scenario of scenarios) {
    try {
      const report = await runHolodeck(scenario, options);
      results.push({ scenario, success: report.success === true, report });
    } catch (err) {
      results.push({ scenario, success: false, error: (err as Error).message });
    }
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('              ALL SCENARIOS SUMMARY                      ');
  console.log('═══════════════════════════════════════════════════════');
  const passed = results.filter((r) => r.success).length;
  const failed = results.length - passed;
  console.log(`Total: ${results.length}  Passed: ${passed}  Failed: ${failed}`);
  for (const r of results) {
    const icon = r.success ? '✓' : '✗';
    console.log(`  ${icon} ${r.scenario}`);
  }
  console.log('═══════════════════════════════════════════════════════\n');

  return results;
}
