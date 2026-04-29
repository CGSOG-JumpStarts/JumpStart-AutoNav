/**
 * runners.ts — Runners cluster (T4.7.2 batch 4).
 *
 * Ports the runners cluster of CLI subcommands into citty `defineCommand`s:
 *   - verify       (verify-diagrams.run, lib-ts) — Mermaid diagram verifier
 *   - holodeck     (holodeck.runHolodeck/runAllScenarios, lib-ts) — E2E sim
 *   - headless     (headless-runner.HeadlessRunner, lib-ts) — agent runner
 *   - smoke        (smoke-tester.runSmokeTest, lib-ts) — build + health probe
 *   - regression   (regression.runRegressionSuite, lib-ts) — golden master
 *   - test         (legacy: spawns `npx vitest run`, no lib backing) — quality test runner
 *
 * Pattern: each leaf command is a `defineCommand` exported as
 * `<name>Command`. Pure logic lives in `<name>Impl(deps, args)`.
 *
 * Top-level ES imports for lib-ts modules per the lifecycle.ts canonical
 * (batch 2). Inline `legacyRequire` only used for commands without a
 * lib-ts port (none in this batch — `test` uses `child_process.spawnSync`
 * directly because it is a CLI-orchestration concern, not a lib).
 *
 * **Skipped**:
 *   - `freshness-audit` — already ported in spec-validation.ts (batch 1).
 *
 * @see bin/cli.js (lines ~972–977 for `verify`, ~1166–1188 for `test`;
 *      `holodeck`/`headless`/`smoke` were standalone scripts in legacy)
 * @see specs/implementation-plan.md T4.7.2
 */

import { spawnSync } from 'node:child_process';
import { defineCommand } from 'citty';
import { HeadlessRunner } from '../../../bin/lib-ts/headless-runner.js';
import { runAllScenarios, runHolodeck } from '../../../bin/lib-ts/holodeck.js';
import { runRegressionSuite } from '../../../bin/lib-ts/regression.js';
import { runSmokeTest } from '../../../bin/lib-ts/smoke-tester.js';
import { run as runVerifyDiagrams } from '../../../bin/lib-ts/verify-diagrams.js';
import { type CommandResult, createRealDeps, type Deps } from '../deps.js';
import { assertUserPath } from './_helpers.js';

// ─────────────────────────────────────────────────────────────────────────
// verify — Mermaid diagram verification
// ─────────────────────────────────────────────────────────────────────────

export interface VerifyArgs {
  rest: string[];
}

export function verifyImpl(deps: Deps, args: VerifyArgs): CommandResult {
  // verify-diagrams.run takes a full argv with at least 2 elements (the
  // legacy `bin/cli.js` line 974 prepended `['node', 'verify', ...]`).
  // Preserve that contract here.
  const argv = ['node', 'verify', ...(args.rest ?? [])];
  const outcome = runVerifyDiagrams(argv);
  if (outcome.output) {
    // outcome.output is a complete report — write to logger.info verbatim
    // (no per-line decoration since the report is already styled).
    deps.logger.info(outcome.output);
  }
  return { exitCode: outcome.exitCode };
}

export const verifyCommand = defineCommand({
  meta: { name: 'verify', description: 'Verify Mermaid diagrams in markdown files' },
  args: {
    rest: { type: 'positional', description: 'verify-diagrams flags', required: false },
  },
  run({ args }) {
    const rest = Array.isArray(args.rest) ? args.rest.map(String) : [];
    const r = verifyImpl(createRealDeps(), { rest });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'verify failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// holodeck — E2E simulation runner
// ─────────────────────────────────────────────────────────────────────────

export interface HolodeckArgs {
  scenario?: string;
  all?: boolean;
  output?: string;
  verbose?: boolean;
  verifySubagents?: boolean;
}

export async function holodeckImpl(deps: Deps, args: HolodeckArgs): Promise<CommandResult> {
  // `output` is a user-supplied path — gate via assertUserPath. The
  // scenario name is NOT a path; holodeck.runHolodeck performs its own
  // assertInsideRoot check internally on `scenarioDir`.
  const safeOutput = args.output ? assertUserPath(deps, args.output, 'holodeck:output') : undefined;

  try {
    if (args.all) {
      await runAllScenarios({
        projectRoot: deps.projectRoot,
        output: safeOutput,
        verbose: args.verbose,
        verifySubagents: args.verifySubagents,
      });
      return { exitCode: 0 };
    }

    if (!args.scenario) {
      deps.logger.error(
        'Usage: jumpstart-mode holodeck <scenario> [--output <dir>] [--verbose] [--verify-subagents]'
      );
      deps.logger.error('       jumpstart-mode holodeck --all');
      return { exitCode: 1 };
    }

    const report = await runHolodeck(args.scenario, {
      projectRoot: deps.projectRoot,
      output: safeOutput,
      verbose: args.verbose,
      verifySubagents: args.verifySubagents,
    });
    return { exitCode: report.success === true ? 0 : 1 };
  } catch (err) {
    deps.logger.error(`Holodeck failed: ${(err as Error).message}`);
    return { exitCode: 1 };
  }
}

export const holodeckCommand = defineCommand({
  meta: { name: 'holodeck', description: 'Run an agent simulation scenario (E2E)' },
  args: {
    scenario: { type: 'positional', description: 'Scenario name', required: false },
    all: { type: 'boolean', description: 'Run all available scenarios', required: false },
    output: { type: 'string', description: 'Output report directory', required: false },
    verbose: { type: 'boolean', description: 'Verbose console output', required: false },
    verifySubagents: {
      type: 'boolean',
      description: 'Strict subagent trace verification',
      required: false,
    },
  },
  async run({ args }) {
    const r = await holodeckImpl(createRealDeps(), {
      scenario: args.scenario,
      all: Boolean(args.all),
      output: args.output,
      verbose: Boolean(args.verbose),
      verifySubagents: Boolean(args.verifySubagents),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'holodeck failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// headless — Agent runner (LLM-backed)
// ─────────────────────────────────────────────────────────────────────────

export interface HeadlessArgs {
  agent?: string;
  persona?: string;
  model?: string;
  proxyModel?: string;
  scenario?: string;
  output?: string;
  mock?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  maxTurns?: string;
}

export async function headlessImpl(deps: Deps, args: HeadlessArgs): Promise<CommandResult> {
  if (!args.agent) {
    deps.logger.error(
      'Usage: jumpstart-mode headless --agent <name>[,<name>...] [--persona <p>] [--scenario <s>] [--mock]'
    );
    return { exitCode: 1 };
  }

  const agents = args.agent
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (agents.length === 0) {
    deps.logger.error('Headless: --agent must list at least one agent name.');
    return { exitCode: 1 };
  }

  const safeOutput = args.output ? assertUserPath(deps, args.output, 'headless:output') : undefined;

  const maxTurns = args.maxTurns ? parseInt(args.maxTurns, 10) : undefined;
  if (maxTurns !== undefined && Number.isNaN(maxTurns)) {
    deps.logger.error('Headless: --max-turns must be an integer.');
    return { exitCode: 1 };
  }

  try {
    const runner = new HeadlessRunner({
      agents,
      persona: args.persona,
      model: args.model,
      proxyModel: args.proxyModel,
      scenario: args.scenario,
      output: safeOutput,
      mock: args.mock,
      dryRun: args.dryRun,
      verbose: args.verbose,
      maxTurns,
      projectRoot: deps.projectRoot,
    });
    const exitCode = await runner.run();
    return { exitCode };
  } catch (err) {
    deps.logger.error(`Headless runner failed: ${(err as Error).message}`);
    return { exitCode: 1 };
  }
}

export const headlessCommand = defineCommand({
  meta: { name: 'headless', description: 'Run Jump Start agents headlessly with an LLM proxy' },
  args: {
    agent: {
      type: 'string',
      description: 'Comma-separated agent names',
      required: false,
    },
    persona: { type: 'string', description: 'User-proxy persona name', required: false },
    model: { type: 'string', description: 'Agent LLM model', required: false },
    proxyModel: { type: 'string', description: 'User-proxy LLM model', required: false },
    scenario: { type: 'string', description: 'Scenario name', required: false },
    output: { type: 'string', description: 'Output directory', required: false },
    mock: { type: 'boolean', description: 'Mock provider mode (no API calls)', required: false },
    dryRun: { type: 'boolean', description: 'Simulation mode (no writes)', required: false },
    verbose: { type: 'boolean', description: 'Verbose logging', required: false },
    maxTurns: { type: 'string', description: 'Max conversation turns', required: false },
  },
  async run({ args }) {
    const r = await headlessImpl(createRealDeps(), {
      agent: args.agent,
      persona: args.persona,
      model: args.model,
      proxyModel: args.proxyModel,
      scenario: args.scenario,
      output: args.output,
      mock: Boolean(args.mock),
      dryRun: Boolean(args.dryRun),
      verbose: Boolean(args.verbose),
      maxTurns: args.maxTurns,
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'headless failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// smoke — Build + health-probe smoke tester
// ─────────────────────────────────────────────────────────────────────────

export interface SmokeArgs {
  root?: string;
  buildCommand?: string;
  startCommand?: string;
  healthUrl?: string;
  healthTimeout?: string;
  skipHealthCheck?: boolean;
  json?: boolean;
}

export async function smokeImpl(deps: Deps, args: SmokeArgs): Promise<CommandResult> {
  const safeRoot = args.root ? assertUserPath(deps, args.root, 'smoke:root') : deps.projectRoot;

  const healthTimeout = args.healthTimeout ? parseInt(args.healthTimeout, 10) : undefined;
  if (healthTimeout !== undefined && Number.isNaN(healthTimeout)) {
    deps.logger.error('Smoke: --health-timeout must be an integer (ms).');
    return { exitCode: 1 };
  }

  try {
    const result = await runSmokeTest({
      root: safeRoot,
      config: {
        build_command: args.buildCommand ?? null,
        start_command: args.startCommand ?? null,
        health_url: args.healthUrl,
        health_timeout: healthTimeout,
        skip_health_check: args.skipHealthCheck,
      },
    });

    if (args.json) {
      deps.logger.info(JSON.stringify(result, null, 2));
    } else if (result.pass) {
      deps.logger.success(`Smoke test PASSED (project type: ${result.project_type})`);
    } else {
      deps.logger.error(`Smoke test FAILED (project type: ${result.project_type})`);
      if (result.build && !result.build.pass) {
        deps.logger.warn(`Build (${result.build.command}): exit=${result.build.exit_code}`);
      }
      if (result.health && !result.health.pass) {
        deps.logger.warn(
          `Health (${result.health.url ?? '?'}): ${result.health.error ?? 'no response'}`
        );
      }
    }
    return { exitCode: result.pass ? 0 : 1 };
  } catch (err) {
    deps.logger.error(`Smoke runner failed: ${(err as Error).message}`);
    return { exitCode: 1 };
  }
}

export const smokeCommand = defineCommand({
  meta: { name: 'smoke', description: 'Run a build + optional health-probe smoke test' },
  args: {
    root: { type: 'string', description: 'Project root (defaults to cwd)', required: false },
    buildCommand: { type: 'string', description: 'Override build command', required: false },
    startCommand: { type: 'string', description: 'Override start command', required: false },
    healthUrl: { type: 'string', description: 'Health check URL', required: false },
    healthTimeout: { type: 'string', description: 'Health check timeout (ms)', required: false },
    skipHealthCheck: {
      type: 'boolean',
      description: 'Skip the health probe',
      required: false,
    },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  async run({ args }) {
    const r = await smokeImpl(createRealDeps(), {
      root: args.root,
      buildCommand: args.buildCommand,
      startCommand: args.startCommand,
      healthUrl: args.healthUrl,
      healthTimeout: args.healthTimeout,
      skipHealthCheck: Boolean(args.skipHealthCheck),
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'smoke failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// regression — Golden Master regression suite
// ─────────────────────────────────────────────────────────────────────────

export interface RegressionArgs {
  mastersDir?: string;
  threshold?: string;
  json?: boolean;
}

export async function regressionImpl(deps: Deps, args: RegressionArgs): Promise<CommandResult> {
  const safeDir = args.mastersDir
    ? assertUserPath(deps, args.mastersDir, 'regression:mastersDir')
    : assertUserPath(deps, 'tests/golden-masters', 'regression:default');

  const threshold = args.threshold ? parseInt(args.threshold, 10) : undefined;
  if (threshold !== undefined && Number.isNaN(threshold)) {
    deps.logger.error('Regression: --threshold must be a percentage integer (e.g., 85).');
    return { exitCode: 1 };
  }

  try {
    // No actualGenerator passed — runs in no-op mode (returns
    // pass:true, results:[]) per regression.ts. The CLI is the
    // documented entry to `runRegressionSuite`; an actualGenerator
    // is supplied programmatically by integration callers.
    const result = await runRegressionSuite(safeDir, { threshold });

    if (args.json) {
      deps.logger.info(JSON.stringify(result, null, 2));
    } else if (result.results.length === 0) {
      deps.logger.warn(
        'Regression: no golden masters found (or no actualGenerator wired). Suite is a no-op.'
      );
    } else {
      const passed = result.results.filter((r) => r.pass).length;
      const failed = result.results.length - passed;
      deps.logger.info(
        `Regression: ${result.results.length} masters | ${passed} passed | ${failed} failed`
      );
      for (const r of result.results) {
        const icon = r.pass ? '✓' : '✗';
        deps.logger.info(`  ${icon} ${r.name}: ${r.similarity}%`);
      }
    }
    return { exitCode: result.pass ? 0 : 1 };
  } catch (err) {
    deps.logger.error(`Regression failed: ${(err as Error).message}`);
    return { exitCode: 1 };
  }
}

export const regressionCommand = defineCommand({
  meta: { name: 'regression', description: 'Run the Golden Master regression suite' },
  args: {
    mastersDir: {
      type: 'string',
      description: 'Golden masters directory (default: tests/golden-masters)',
      required: false,
    },
    threshold: {
      type: 'string',
      description: 'Similarity threshold percentage (default: 85)',
      required: false,
    },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  async run({ args }) {
    const r = await regressionImpl(createRealDeps(), {
      mastersDir: args.mastersDir,
      threshold: args.threshold,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'regression failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// test — Quality test-suite runner (legacy: spawns `npx vitest run`)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Allowlist of test-flag names that map to vitest invocations. Each
 * value is the concrete `[args...]` to append after `vitest run`. We
 * route through this map (instead of substituting user input directly
 * into the argv) because spawnSync with `shell: false` rejects shell
 * features but argv injection through `testArgs.push(userInput)` would
 * still let an attacker name a file outside the project tree. The
 * legacy `bin/cli.js:1166-1188` had no such allowlist.
 */
const TEST_FLAG_TARGETS: Record<string, string[]> = {
  '--unit': ['tests/test-schema.test.js', 'tests/test-spec-quality.test.js'],
  '--integration': ['tests/test-handoffs.test.js'],
  '--regression': ['tests/test-regression.test.js'],
};

export interface TestArgs {
  flag?: string;
}

export function testImpl(deps: Deps, args: TestArgs): CommandResult {
  if (args.flag === '--adversarial') {
    deps.logger.info('Running adversarial review...');
    deps.logger.warn(
      'Adversarial review requires LLM invocation. Use /jumpstart.adversary in chat.'
    );
    return { exitCode: 0 };
  }

  // Build argv. Default invocation runs ALL tests (no extra args).
  const baseArgs = ['vitest', 'run'];
  let extraArgs: string[] = [];
  if (args.flag) {
    const target = TEST_FLAG_TARGETS[args.flag];
    if (!target) {
      deps.logger.error(
        `Unknown test flag: "${args.flag}". Allowed: ${Object.keys(TEST_FLAG_TARGETS).join(', ')}, --adversarial`
      );
      return { exitCode: 1 };
    }
    extraArgs = ['--config', 'vitest.config.js', ...target];
  }

  const result = spawnSync('npx', [...baseArgs, ...extraArgs], {
    cwd: deps.projectRoot,
    stdio: 'inherit',
    shell: false,
  });
  return { exitCode: result.status ?? 1 };
}

export const testCommand = defineCommand({
  meta: { name: 'test', description: 'Run quality test suites (5-layer testing)' },
  args: {
    flag: {
      type: 'positional',
      description: '--unit | --integration | --regression | --adversarial (omit for all)',
      required: false,
    },
  },
  run({ args }) {
    const r = testImpl(createRealDeps(), { flag: args.flag });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'test failed');
  },
});
