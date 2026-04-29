/**
 * llm.ts — LLM / cost / model governance cluster (T4.7.2 batch 6).
 *
 * Ports the following bin/cli.js subcommands into citty `defineCommand`s:
 *   - cost-router        (lib-ts: routeByCost + generateReport)
 *   - model-router       (lib-ts: routeTask + generateReport)
 *   - model-governance   (lib-ts: registerModel + generateReport)
 *   - prompt-governance  (lib-ts: registerAsset + approveVersion + listAssets)
 *   - usage              (lib-ts: summarizeUsage + generateUsageReport)
 *   - ai-intake          (lib-ts: createIntake + listIntakes)
 *   - finops-planner     (legacy bin/lib/finops-planner.js — no lib-ts port yet)
 *
 * **Skipped**: `freshness-audit` already lives in spec-validation.ts batch 1.
 * No standalone `llm-providers` subcommand exists in `bin/cli.js`; the
 * model registry is exposed indirectly via `cost-router` + `model-router`
 * + `model-governance`. The lib-ts `llm-provider.ts` module is consumed
 * by other lib-ts ports rather than via a CLI surface.
 *
 * Pattern: each leaf command is a `defineCommand` exported as
 * `<name>Command`. Pure logic lives in `<name>Impl(deps, args)`. All
 * lib-ts imports are TOP-LEVEL ES imports; only `finops-planner`
 * (no lib-ts port) goes through `legacyRequire`.
 *
 * @see bin/cli.js (lines 1734-1746, 3643-3666, 3669-3691, 3694-3715,
 *       4096-4115, 4118-4135, 4997-5025 — legacy reference)
 * @see specs/implementation-plan.md T4.7.2
 */

import { defineCommand } from 'citty';
import { createIntake, listIntakes } from '../../../bin/lib-ts/ai-intake.js';
import {
  generateReport as costGenerateReport,
  routeByCost,
} from '../../../bin/lib-ts/cost-router.js';
import { writeResult } from '../../../bin/lib-ts/io.js';
import {
  generateReport as governanceGenerateReport,
  registerModel,
} from '../../../bin/lib-ts/model-governance.js';
import {
  generateReport as routerGenerateReport,
  routeTask,
} from '../../../bin/lib-ts/model-router.js';
import {
  approveVersion,
  listAssets,
  registerAsset,
} from '../../../bin/lib-ts/prompt-governance.js';
import { generateUsageReport, summarizeUsage } from '../../../bin/lib-ts/usage.js';
import { type CommandResult, createRealDeps, type Deps } from '../deps.js';
import { legacyRequire, safeJoin } from './_helpers.js';

// ─────────────────────────────────────────────────────────────────────────
// cost-router
// ─────────────────────────────────────────────────────────────────────────

export interface CostRouterArgs {
  action?: string;
  taskType?: string;
  json?: boolean;
}

export function costRouterImpl(deps: Deps, args: CostRouterArgs): CommandResult {
  const action = args.action ?? 'report';

  if (action === 'route') {
    const result = routeByCost({ type: args.taskType ?? 'coding' });
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else {
      deps.logger.success(`Cost route: ${result.selected_model} ($${result.estimated_cost})`);
    }
    return { exitCode: 0 };
  }

  // report (default)
  const result = costGenerateReport();
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info(`Cost Router: ${result.budget_profile} profile, $${result.total_cost} total`);
  }
  return { exitCode: 0 };
}

export const costRouterCommand = defineCommand({
  meta: { name: 'cost-router', description: 'Cost-aware model routing (route/report)' },
  args: {
    action: { type: 'positional', description: 'route | report', required: false },
    taskType: { type: 'positional', description: 'Task type (for route)', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = costRouterImpl(createRealDeps(), {
      action: args.action,
      taskType: args.taskType,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'cost-router failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// model-router
// ─────────────────────────────────────────────────────────────────────────

export interface ModelRouterArgs {
  action?: string;
  taskType?: string;
  json?: boolean;
}

export function modelRouterImpl(deps: Deps, args: ModelRouterArgs): CommandResult {
  const action = args.action ?? 'report';

  if (action === 'route') {
    if (!args.taskType) {
      deps.logger.error('Usage: jumpstart-mode model-router route <task-type>');
      return { exitCode: 1 };
    }
    const result = routeTask(args.taskType);
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success) {
      deps.logger.success(`Route: ${args.taskType} → ${result.model} (${result.reason})`);
    } else {
      deps.logger.error(result.error ?? 'route failed');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }

  // report (default)
  const result = routerGenerateReport();
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info(
      `Model Router: ${result.unique_models} models across ${result.task_types} task types`
    );
  }
  return { exitCode: 0 };
}

export const modelRouterCommand = defineCommand({
  meta: { name: 'model-router', description: 'Multi-model routing (route/report)' },
  args: {
    action: { type: 'positional', description: 'route | report', required: false },
    taskType: {
      type: 'positional',
      description: 'Task type (route)',
      required: false,
    },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = modelRouterImpl(createRealDeps(), {
      action: args.action,
      taskType: args.taskType,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'model-router failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// model-governance
// ─────────────────────────────────────────────────────────────────────────

export interface ModelGovernanceArgs {
  action?: string;
  name?: string;
  provider?: string;
  json?: boolean;
}

export function modelGovernanceImpl(deps: Deps, args: ModelGovernanceArgs): CommandResult {
  const stateFile = safeJoin(deps, '.jumpstart', 'state', 'model-governance.json');
  const action = args.action ?? 'report';

  if (action === 'register') {
    if (!args.name || !args.provider) {
      deps.logger.error('Usage: jumpstart-mode model-governance register <name> <provider>');
      return { exitCode: 1 };
    }
    const result = registerModel({ name: args.name, provider: args.provider }, { stateFile });
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success && result.model) {
      deps.logger.success(`Model registered: ${result.model.id}`);
    } else {
      deps.logger.error(result.error ?? 'register failed');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }

  // report (default)
  const result = governanceGenerateReport({ stateFile });
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info(
      `Model Governance: ${result.total_models} models, ${result.total_evaluations} evaluations`
    );
    if (result.high_risk_models.length > 0) {
      deps.logger.warn(`  High risk: ${result.high_risk_models.map((m) => m.name).join(', ')}`);
    }
  }
  return { exitCode: 0 };
}

export const modelGovernanceCommand = defineCommand({
  meta: {
    name: 'model-governance',
    description: 'Model governance workflows (register/report)',
  },
  args: {
    action: { type: 'positional', description: 'register | report', required: false },
    name: { type: 'positional', description: 'Model name (register)', required: false },
    provider: {
      type: 'positional',
      description: 'Model provider (register)',
      required: false,
    },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = modelGovernanceImpl(createRealDeps(), {
      action: args.action,
      name: args.name,
      provider: args.provider,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'model-governance failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// prompt-governance
// ─────────────────────────────────────────────────────────────────────────

export interface PromptGovernanceArgs {
  action?: string;
  arg1?: string;
  arg2?: string;
  json?: boolean;
}

export function promptGovernanceImpl(deps: Deps, args: PromptGovernanceArgs): CommandResult {
  const stateFile = safeJoin(deps, '.jumpstart', 'state', 'prompt-governance.json');
  const action = args.action ?? 'list';

  if (action === 'register') {
    if (!args.arg1) {
      deps.logger.error('Usage: jumpstart-mode prompt-governance register <name> [type]');
      return { exitCode: 1 };
    }
    const name = args.arg1;
    const type = args.arg2 ?? 'prompt';
    const result = registerAsset(name, type, 'content', { stateFile });
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success && result.asset) {
      deps.logger.success(`Asset ${result.asset.id} registered: ${name}`);
    } else {
      deps.logger.error(result.error ?? 'register failed');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }

  if (action === 'approve') {
    if (!args.arg1) {
      deps.logger.error('Usage: jumpstart-mode prompt-governance approve <asset-id> [version]');
      return { exitCode: 1 };
    }
    const assetId = args.arg1;
    const version = args.arg2 ?? '1.0.0';
    const result = approveVersion(assetId, version, { stateFile });
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success) {
      deps.logger.success(`Version ${version} approved`);
    } else {
      deps.logger.error(result.error ?? 'approve failed');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }

  // list (default)
  const result = listAssets({ stateFile });
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info(`Prompt Governance: ${result.total} assets`);
    for (const a of result.assets) {
      deps.logger.info(`  ${a.id}: ${a.name} [${a.type}] v${a.current_version}`);
    }
  }
  return { exitCode: 0 };
}

export const promptGovernanceCommand = defineCommand({
  meta: {
    name: 'prompt-governance',
    description: 'Prompt and agent version governance (register/approve/list)',
  },
  args: {
    action: {
      type: 'positional',
      description: 'register | approve | list',
      required: false,
    },
    arg1: {
      type: 'positional',
      description: 'Name (register) or asset id (approve)',
      required: false,
    },
    arg2: {
      type: 'positional',
      description: 'Type (register) or version (approve)',
      required: false,
    },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = promptGovernanceImpl(createRealDeps(), {
      action: args.action,
      arg1: args.arg1,
      arg2: args.arg2,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'prompt-governance failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// usage
// ─────────────────────────────────────────────────────────────────────────

export interface UsageArgs {
  action?: string;
  json?: boolean;
}

export function usageImpl(deps: Deps, args: UsageArgs): CommandResult {
  const logPath = safeJoin(deps, '.jumpstart', 'usage-log.json');
  const action = args.action ?? 'summary';

  if (action === 'report') {
    const report = generateUsageReport(logPath);
    deps.logger.info(report);
    return { exitCode: 0 };
  }

  // summary (default)
  const result = summarizeUsage(logPath);
  writeResult(result as unknown as Record<string, unknown>);
  return { exitCode: 0 };
}

export const usageCommand = defineCommand({
  meta: { name: 'usage', description: 'Usage summary / report (Item 99)' },
  args: {
    action: { type: 'positional', description: 'summary | report', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = usageImpl(createRealDeps(), {
      action: args.action,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'usage failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// ai-intake
// ─────────────────────────────────────────────────────────────────────────

export interface AiIntakeArgs {
  action?: string;
  name?: string;
  json?: boolean;
}

export function aiIntakeImpl(deps: Deps, args: AiIntakeArgs): CommandResult {
  const stateFile = safeJoin(deps, '.jumpstart', 'state', 'ai-intake.json');
  const action = args.action ?? 'list';

  if (action === 'create') {
    if (!args.name) {
      deps.logger.error('Usage: jumpstart-mode ai-intake create <name>');
      return { exitCode: 1 };
    }
    const result = createIntake({ name: args.name, description: args.name }, { stateFile });
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success && result.intake) {
      deps.logger.success(
        `AI intake created: ${result.intake.id} (Risk tier: ${result.intake.risk_tier})`
      );
    } else {
      deps.logger.error(result.error ?? 'create failed');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }

  // list (default)
  const result = listIntakes({}, { stateFile });
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info(`AI Use Case Intakes (${result.total})`);
    for (const i of result.intakes) {
      deps.logger.info(`  ${i.id}: ${i.name} (Tier ${i.risk_tier}: ${i.risk_label})`);
    }
  }
  return { exitCode: 0 };
}

export const aiIntakeCommand = defineCommand({
  meta: { name: 'ai-intake', description: 'AI use case intake (create/list)' },
  args: {
    action: { type: 'positional', description: 'create | list', required: false },
    name: { type: 'positional', description: 'Intake name (create)', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = aiIntakeImpl(createRealDeps(), {
      action: args.action,
      name: args.name,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'ai-intake failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// finops-planner
// ─────────────────────────────────────────────────────────────────────────

export interface FinopsPlannerArgs {
  action?: string;
  json?: boolean;
}

interface FinopsPlannerLib {
  generateReport: (opts: { stateFile: string }) => {
    total_monthly: number;
    total_annual: number;
    total_estimates: number;
  };
  getOptimizations: (opts: { stateFile: string }) => {
    total: number;
    recommendations: { recommendation: string; potential_savings: string }[];
  };
}

export function finopsPlannerImpl(deps: Deps, args: FinopsPlannerArgs): CommandResult {
  const lib = legacyRequire<FinopsPlannerLib>('finops-planner');
  const stateFile = safeJoin(deps, '.jumpstart', 'state', 'finops.json');
  const action = args.action ?? 'report';

  if (action === 'optimize') {
    const result = lib.getOptimizations({ stateFile });
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else {
      deps.logger.info(`FinOps Optimizations (${result.total})`);
      for (const r of result.recommendations) {
        deps.logger.info(`  ${r.recommendation} (${r.potential_savings})`);
      }
    }
    return { exitCode: 0 };
  }

  // report (default)
  const result = lib.generateReport({ stateFile });
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info(`FinOps Report: $${result.total_monthly}/mo ($${result.total_annual}/yr)`);
    deps.logger.info(`  Estimates: ${result.total_estimates}`);
  }
  return { exitCode: 0 };
}

export const finopsPlannerCommand = defineCommand({
  meta: { name: 'finops-planner', description: 'FinOps cost planning (optimize/report)' },
  args: {
    action: { type: 'positional', description: 'optimize | report', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = finopsPlannerImpl(createRealDeps(), {
      action: args.action,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'finops-planner failed');
  },
});
