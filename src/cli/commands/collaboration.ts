/**
 * collaboration.ts — Collaboration / UX cluster (T4.7.2 batch 8).
 *
 * Ports the following bin/cli.js subcommands into citty `defineCommand`s:
 *   - ai-intake             (lib-ts: createIntake + listIntakes)
 *   - backlog-sync          (lib-ts: extractBacklog + exportBacklog + loadSyncState)
 *   - bcdr-planning         (lib-ts: defineService + checkCoverage + generateReport)
 *   - branch-workflow       (lib-ts: trackBranch + getBranchStatus + listTrackedBranches)
 *   - cab-output            (lib-ts: generateCABSummary)
 *   - chat-integration      (lib-ts: configure + queueNotification + getStatus)
 *   - ci-cd-integration     (lib-ts: generatePipeline + validatePipeline + getStatus)
 *   - collaboration         (lib-ts: createSession + getStatus)
 *   - context-onboarding    (lib-ts: generateOnboarding)
 *   - data-contracts        (lib-ts: registerContract + generateReport)
 *   - db-evolution          (lib-ts: generateReport)
 *   - decision-conflicts    (lib-ts: detectConflicts)
 *   - delivery-confidence   (lib-ts: scoreFile + scoreProject)
 *   - dependency-upgrade    (lib-ts: scanUpgrades + generateReport)
 *   - design-system         (lib-ts: checkCompliance + generateReport)
 *   - diagram-studio        (lib-ts: generateDiagram + validateDiagram + listDiagramTypes)
 *   - elicitation           (lib-ts: startElicitation + generateReport — bin/cli.js
 *                              `subcommand === 'elicitation'`)
 *   - estimation-studio     (lib-ts: generateReport)
 *   - playback-summaries    (lib-ts: generateSummary + listAudiences)
 *
 * **Skipped**: anti-abstraction and contract-checker — neither has a matching
 * `subcommand === '<name>'` branch in `bin/cli.js` (their lib-ts modules
 * exist but the CLI surface uses different names, e.g. `contract-first`,
 * which is also skipped here pending the contract-cluster batch).
 *
 * Pattern: each leaf command is a `defineCommand` exported as
 * `<name>Command`. Pure logic lives in `<name>Impl(deps, args)`. All
 * lib-ts imports are TOP-LEVEL ES imports per lifecycle.ts canonical
 * pattern.
 *
 * @see bin/cli.js (lines ~2616-2654, 2921-2957, 2960-2993, 3161-3182,
 *       3292-3318, 3669-3691, 3741-3753, 3756-3784, 3989-3999, 4031-4049,
 *       4370-4390, 4393-4417, 4455-4477, 4481-4499, 4503-4534, 4565-4587,
 *       4646-4672, 4676-4691, 4898-4916 — legacy reference)
 * @see specs/implementation-plan.md T4.7.2
 */

import * as fs from 'node:fs';
import { defineCommand } from 'citty';
import * as aiIntakeLib from '../../../bin/lib-ts/ai-intake.js';
import * as backlogLib from '../../../bin/lib-ts/backlog-sync.js';
import * as bcdrLib from '../../../bin/lib-ts/bcdr-planning.js';
import * as branchLib from '../../../bin/lib-ts/branch-workflow.js';
import * as cabLib from '../../../bin/lib-ts/cab-output.js';
import * as chatLib from '../../../bin/lib-ts/chat-integration.js';
import * as cicdLib from '../../../bin/lib-ts/ci-cd-integration.js';
import * as collabLib from '../../../bin/lib-ts/collaboration.js';
import * as onboardingLib from '../../../bin/lib-ts/context-onboarding.js';
import * as dataContractsLib from '../../../bin/lib-ts/data-contracts.js';
import * as dbEvolutionLib from '../../../bin/lib-ts/db-evolution.js';
import * as decisionConflictsLib from '../../../bin/lib-ts/decision-conflicts.js';
import * as confLib from '../../../bin/lib-ts/delivery-confidence.js';
import * as depUpgradeLib from '../../../bin/lib-ts/dependency-upgrade.js';
import * as designLib from '../../../bin/lib-ts/design-system.js';
import * as diagramLib from '../../../bin/lib-ts/diagram-studio.js';
import * as estimationLib from '../../../bin/lib-ts/estimation-studio.js';
import { writeResult } from '../../../bin/lib-ts/io.js';
import * as playbackLib from '../../../bin/lib-ts/playback-summaries.js';
import * as elicitationLib from '../../../bin/lib-ts/structured-elicitation.js';
import { type CommandResult, createRealDeps, type Deps } from '../deps.js';
import { assertUserPath } from './_helpers.js';

// ─────────────────────────────────────────────────────────────────────────
// ai-intake
// ─────────────────────────────────────────────────────────────────────────

export interface AiIntakeArgs {
  action?: string;
  name?: string;
  json?: boolean;
}

export function aiIntakeImpl(deps: Deps, args: AiIntakeArgs): CommandResult {
  const action = args.action ?? 'list';

  if (action === 'create') {
    if (!args.name) {
      deps.logger.error('Usage: jumpstart-mode ai-intake create <name>');
      return { exitCode: 1 };
    }
    const result = aiIntakeLib.createIntake({ name: args.name, description: args.name });
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
  const result = aiIntakeLib.listIntakes();
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
  meta: { name: 'ai-intake', description: 'AI use-case intake (Item 34)' },
  args: {
    action: { type: 'positional', description: 'create | list', required: false },
    name: { type: 'positional', description: 'Intake name (for create)', required: false },
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
// backlog-sync
// ─────────────────────────────────────────────────────────────────────────

export interface BacklogSyncArgs {
  action?: string;
  target?: string;
  json?: boolean;
}

export function backlogSyncImpl(deps: Deps, args: BacklogSyncArgs): CommandResult {
  const action = args.action ?? 'extract';

  if (action === 'extract') {
    const result = backlogLib.extractBacklog(deps.projectRoot);
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else {
      deps.logger.info('Backlog Extraction');
      deps.logger.info(
        `  Epics: ${result.epics}  Stories: ${result.stories}  Tasks: ${result.tasks}`
      );
    }
    return { exitCode: 0 };
  }

  if (action === 'export') {
    if (!args.target) {
      deps.logger.error('Usage: jumpstart-mode backlog-sync export <github|jira|azure-devops>');
      return { exitCode: 1 };
    }
    const result = backlogLib.exportBacklog(deps.projectRoot, args.target);
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success) {
      deps.logger.success(`Backlog exported for ${args.target}`);
      deps.logger.info(`  Items: ${result.items_exported}`);
      if (result.output) deps.logger.info(`  Output: ${result.output}`);
    } else {
      deps.logger.error(result.error ?? 'export failed');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }

  // status (default)
  const stateFile = `${deps.projectRoot}/.jumpstart/state/backlog-sync.json`;
  const syncState = backlogLib.loadSyncState(stateFile);
  if (args.json) {
    writeResult(syncState as unknown as Record<string, unknown>);
  } else {
    deps.logger.info('Backlog Sync Status');
    deps.logger.info(`  Last sync: ${syncState.last_sync || 'never'}`);
    deps.logger.info(`  Exports: ${syncState.export_history.length}`);
  }
  return { exitCode: 0 };
}

export const backlogSyncCommand = defineCommand({
  meta: { name: 'backlog-sync', description: 'Native backlog synchronization (Feature 13)' },
  args: {
    action: { type: 'positional', description: 'extract | export | status', required: false },
    target: { type: 'positional', description: 'Export target', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = backlogSyncImpl(createRealDeps(), {
      action: args.action,
      target: args.target,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'backlog-sync failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// bcdr-planning
// ─────────────────────────────────────────────────────────────────────────

export interface BcdrPlanningArgs {
  action?: string;
  name?: string;
  tier?: string;
  json?: boolean;
}

export function bcdrPlanningImpl(deps: Deps, args: BcdrPlanningArgs): CommandResult {
  const action = args.action ?? 'report';

  if (action === 'define') {
    if (!args.name) {
      deps.logger.error('Usage: jumpstart-mode bcdr-planning define <service-name> [tier]');
      return { exitCode: 1 };
    }
    const result = bcdrLib.defineService({
      name: args.name,
      tier: (args.tier ?? 'silver') as 'platinum' | 'gold' | 'silver' | 'bronze',
    });
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success && result.service) {
      deps.logger.success(
        `BC/DR defined: RTO=${result.service.rto_hours}h RPO=${result.service.rpo_hours}h`
      );
    } else {
      deps.logger.error(result.error ?? 'define failed');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }

  if (action === 'check') {
    const result = bcdrLib.checkCoverage(deps.projectRoot);
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else {
      deps.logger.info(`BC/DR Coverage: ${result.coverage}%`);
      if (result.gaps.length > 0) deps.logger.warn(`  Gaps: ${result.gaps.join(', ')}`);
    }
    return { exitCode: 0 };
  }

  // report (default)
  const result = bcdrLib.generateReport();
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info(`BC/DR Report: ${result.total_services} services`);
  }
  return { exitCode: 0 };
}

export const bcdrPlanningCommand = defineCommand({
  meta: { name: 'bcdr-planning', description: 'BC/DR planning (Feature 38)' },
  args: {
    action: { type: 'positional', description: 'define | check | report', required: false },
    name: { type: 'positional', description: 'Service name', required: false },
    tier: { type: 'positional', description: 'Service tier', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = bcdrPlanningImpl(createRealDeps(), {
      action: args.action,
      name: args.name,
      tier: args.tier,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'bcdr-planning failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// branch-workflow
// ─────────────────────────────────────────────────────────────────────────

export interface BranchWorkflowArgs {
  action?: string;
  branch?: string;
  pr?: string;
  json?: boolean;
}

export function branchWorkflowImpl(deps: Deps, args: BranchWorkflowArgs): CommandResult {
  const action = args.action ?? 'status';

  if (action === 'track') {
    const prNum = args.pr ? parseInt(args.pr, 10) : undefined;
    const result = branchLib.trackBranch(deps.projectRoot, {
      pr_number: prNum && !Number.isNaN(prNum) ? prNum : undefined,
    });
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success && result.branch) {
      deps.logger.success(`Branch tracked: ${result.branch.branch}`);
    } else {
      deps.logger.error('track failed');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }

  if (action === 'sync') {
    const result = branchLib.listTrackedBranches();
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else {
      deps.logger.info(`Tracked Branches (${result.total})`);
      for (const b of result.branches) {
        deps.logger.info(
          `  ${b.branch}  phases=${b.phase_snapshots ? b.phase_snapshots.length : 0}  PR=${b.pr_number || '-'}`
        );
      }
    }
    return { exitCode: 0 };
  }

  // status (default)
  const result = branchLib.getBranchStatus(deps.projectRoot, { branch: args.branch });
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else if (result.tracked) {
    deps.logger.info(`Branch: ${result.branch}`);
    deps.logger.info(
      `  Phases recorded: ${result.phase_count}  Approvals: ${result.approved_count}`
    );
    if (result.data?.pr_number) deps.logger.info(`  PR #${result.data.pr_number}`);
  } else {
    deps.logger.warn(result.message ?? 'no branch tracked');
  }
  return { exitCode: 0 };
}

export const branchWorkflowCommand = defineCommand({
  meta: { name: 'branch-workflow', description: 'Branch tracking workflow (Feature 7)' },
  args: {
    action: { type: 'positional', description: 'track | status | sync', required: false },
    branch: { type: 'positional', description: 'Branch name (for status)', required: false },
    pr: { type: 'string', description: 'PR number (for track)', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = branchWorkflowImpl(createRealDeps(), {
      action: args.action,
      branch: args.branch,
      pr: args.pr,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'branch-workflow failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// cab-output
// ─────────────────────────────────────────────────────────────────────────

export interface CabOutputArgs {
  json?: boolean;
}

export function cabOutputImpl(deps: Deps, args: CabOutputArgs): CommandResult {
  const result = cabLib.generateCABSummary(deps.projectRoot);
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info(`CAB Summary: ${result.completeness}% complete (Risk: ${result.risk_level})`);
    deps.logger.info(`  ${result.recommendation}`);
    if (result.gaps.length > 0) deps.logger.warn(`  Gaps: ${result.gaps.join(', ')}`);
  }
  return { exitCode: 0 };
}

export const cabOutputCommand = defineCommand({
  meta: { name: 'cab-output', description: 'CAB summary output (Feature 37)' },
  args: {
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = cabOutputImpl(createRealDeps(), { json: Boolean(args.json) });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'cab-output failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// chat-integration
// ─────────────────────────────────────────────────────────────────────────

export interface ChatIntegrationArgs {
  action?: string;
  arg1?: string;
  arg2?: string;
  json?: boolean;
}

export function chatIntegrationImpl(deps: Deps, args: ChatIntegrationArgs): CommandResult {
  void deps.projectRoot;
  const action = args.action ?? 'status';

  if (action === 'configure') {
    const platform = args.arg1 ?? 'slack';
    const result = chatLib.configure(platform);
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success && result.configuration) {
      deps.logger.success(`${platform} integration configured: ${result.configuration.id}`);
    } else {
      deps.logger.error(result.error ?? 'configure failed');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }

  if (action === 'notify') {
    if (!args.arg1 || !args.arg2) {
      deps.logger.error('Usage: jumpstart-mode chat-integration notify <event-type> <message>');
      return { exitCode: 1 };
    }
    const result = chatLib.queueNotification(args.arg1, args.arg2);
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success && result.notification) {
      deps.logger.success(`Notification queued: ${result.notification.id}`);
    } else {
      deps.logger.error(result.error ?? 'notify failed');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }

  // status (default)
  const result = chatLib.getStatus();
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info('Chat Integration Status');
    deps.logger.info(
      `  Configurations: ${result.configurations}  Active: ${result.active}  Queued: ${result.notifications_queued}`
    );
  }
  return { exitCode: 0 };
}

export const chatIntegrationCommand = defineCommand({
  meta: { name: 'chat-integration', description: 'Slack/Teams chat integration (Item 75)' },
  args: {
    action: { type: 'positional', description: 'configure | notify | status', required: false },
    arg1: { type: 'positional', description: 'Platform or event type', required: false },
    arg2: { type: 'positional', description: 'Message (for notify)', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = chatIntegrationImpl(createRealDeps(), {
      action: args.action,
      arg1: args.arg1,
      arg2: args.arg2,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'chat-integration failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// ci-cd-integration
// ─────────────────────────────────────────────────────────────────────────

export interface CiCdIntegrationArgs {
  action?: string;
  platform?: string;
  json?: boolean;
}

export function ciCdIntegrationImpl(deps: Deps, args: CiCdIntegrationArgs): CommandResult {
  const action = args.action ?? 'status';

  if (action === 'generate') {
    const platform = args.platform ?? 'github-actions';
    const result = cicdLib.generatePipeline(platform);
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success) {
      deps.logger.success(`Pipeline generated for ${platform}: ${result.path}`);
    } else {
      deps.logger.error(result.error ?? 'generate failed');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }

  if (action === 'validate') {
    const result = cicdLib.validatePipeline(deps.projectRoot);
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else {
      deps.logger.info('CI/CD Pipeline Validation');
      for (const p of result.pipelines) {
        const tag = p.exists ? 'OK' : 'MISSING';
        deps.logger.info(`  [${tag}] ${p.platform}: ${p.path}`);
      }
    }
    return { exitCode: 0 };
  }

  // status (default)
  const result = cicdLib.getStatus();
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info('CI/CD Integration Status');
    deps.logger.info(`  Available checks: ${result.available_checks}`);
    deps.logger.info(`  Pipelines: ${result.pipelines}  Runs: ${result.total_runs}`);
  }
  return { exitCode: 0 };
}

export const ciCdIntegrationCommand = defineCommand({
  meta: { name: 'ci-cd-integration', description: 'CI/CD pipeline integration (Feature 21)' },
  args: {
    action: { type: 'positional', description: 'generate | validate | status', required: false },
    platform: { type: 'positional', description: 'Pipeline platform', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = ciCdIntegrationImpl(createRealDeps(), {
      action: args.action,
      platform: args.platform,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'ci-cd-integration failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// collaboration
// ─────────────────────────────────────────────────────────────────────────

export interface CollaborationArgs {
  action?: string;
  name?: string;
  json?: boolean;
}

export function collaborationImpl(deps: Deps, args: CollaborationArgs): CommandResult {
  void deps.projectRoot;
  const action = args.action ?? 'status';

  if (action === 'create') {
    const name = args.name ?? 'Session';
    const result = collabLib.createSession(name);
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success && result.session) {
      deps.logger.success(`Collaboration ${result.session.id} created`);
    } else {
      deps.logger.error(result.error ?? 'create failed');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }

  // status (default)
  const result = collabLib.getStatus();
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info('Collaboration Status');
    deps.logger.info(
      `  Active sessions: ${result.active_sessions}  Active locks: ${result.active_locks}`
    );
  }
  return { exitCode: 0 };
}

export const collaborationCommand = defineCommand({
  meta: { name: 'collaboration', description: 'Collaboration session manager (Item 65)' },
  args: {
    action: { type: 'positional', description: 'create | status', required: false },
    name: { type: 'positional', description: 'Session name (for create)', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = collaborationImpl(createRealDeps(), {
      action: args.action,
      name: args.name,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'collaboration failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// context-onboarding
// ─────────────────────────────────────────────────────────────────────────

export interface ContextOnboardingArgs {
  role?: string;
  json?: boolean;
}

export function contextOnboardingImpl(deps: Deps, args: ContextOnboardingArgs): CommandResult {
  const role = args.role ?? 'engineer';
  const result = onboardingLib.generateOnboarding(deps.projectRoot, { role });
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else if (result.success && result.onboarding) {
    const ob = result.onboarding;
    deps.logger.info(`Onboarding Package (${ob.role})`);
    if (ob.sections) {
      const decisions = ob.sections.decisions as { total?: number } | undefined;
      const risks = ob.sections.risks as { total?: number } | undefined;
      const specs = ob.sections.specs as { total?: number } | undefined;
      const status = ob.sections.project_status as { current_phase?: number } | undefined;
      deps.logger.info(
        `  Decisions: ${decisions?.total ?? 0}  Risks: ${risks?.total ?? 0}  Specs: ${specs?.total ?? 0}  Phase: ${status?.current_phase ?? 0}`
      );
    }
  } else {
    deps.logger.error('onboarding failed');
    return { exitCode: 1 };
  }
  return { exitCode: 0 };
}

export const contextOnboardingCommand = defineCommand({
  meta: { name: 'context-onboarding', description: 'Role-based onboarding package (Item 76)' },
  args: {
    role: { type: 'positional', description: 'Role (engineer|pm|...)', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = contextOnboardingImpl(createRealDeps(), {
      role: args.role,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'context-onboarding failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// data-contracts
// ─────────────────────────────────────────────────────────────────────────

export interface DataContractsArgs {
  action?: string;
  name?: string;
  json?: boolean;
}

export function dataContractsImpl(deps: Deps, args: DataContractsArgs): CommandResult {
  void deps.projectRoot;
  const action = args.action ?? 'report';

  if (action === 'register') {
    if (!args.name) {
      deps.logger.error('Usage: jumpstart-mode data-contracts register <name>');
      return { exitCode: 1 };
    }
    const result = dataContractsLib.registerContract(args.name, { field1: 'string' });
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success && result.contract) {
      deps.logger.success(`Contract ${result.contract.id} registered: ${args.name}`);
    } else {
      deps.logger.error(result.error ?? 'register failed');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }

  // report (default)
  const result = dataContractsLib.generateReport();
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info(
      `Data Contracts: ${result.total_contracts} contracts, ${result.total_lineage} lineage entries`
    );
  }
  return { exitCode: 0 };
}

export const dataContractsCommand = defineCommand({
  meta: { name: 'data-contracts', description: 'Data contract registry (Item 84)' },
  args: {
    action: { type: 'positional', description: 'register | report', required: false },
    name: { type: 'positional', description: 'Contract name (for register)', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = dataContractsImpl(createRealDeps(), {
      action: args.action,
      name: args.name,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'data-contracts failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// db-evolution
// ─────────────────────────────────────────────────────────────────────────

export interface DbEvolutionArgs {
  json?: boolean;
}

export function dbEvolutionImpl(deps: Deps, args: DbEvolutionArgs): CommandResult {
  void deps.projectRoot;
  const result = dbEvolutionLib.generateReport();
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info(`DB Evolution: ${result.total_migrations} migrations`);
  }
  return { exitCode: 0 };
}

export const dbEvolutionCommand = defineCommand({
  meta: { name: 'db-evolution', description: 'DB evolution / migrations (Feature 49)' },
  args: {
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = dbEvolutionImpl(createRealDeps(), { json: Boolean(args.json) });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'db-evolution failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// decision-conflicts
// ─────────────────────────────────────────────────────────────────────────

export interface DecisionConflictsArgs {
  json?: boolean;
}

export function decisionConflictsImpl(deps: Deps, args: DecisionConflictsArgs): CommandResult {
  const result = decisionConflictsLib.detectConflicts(deps.projectRoot);
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else if (result.success) {
    deps.logger.info('Decision Conflict Analysis');
    deps.logger.info(`  Decisions analyzed: ${result.total_decisions ?? 0}`);
    deps.logger.info(`  Conflicts found: ${result.summary?.total_conflicts ?? 0}`);
    for (const c of result.conflicts) {
      deps.logger.info(`  ${c.type}: ${c.description}`);
      deps.logger.info(`    Sources: ${c.sources.join(', ')}`);
    }
  } else {
    deps.logger.error(result.message ?? 'detect failed');
    return { exitCode: 1 };
  }
  return { exitCode: 0 };
}

export const decisionConflictsCommand = defineCommand({
  meta: {
    name: 'decision-conflicts',
    description: 'Detect cross-spec decision conflicts (Feature 18)',
  },
  args: {
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = decisionConflictsImpl(createRealDeps(), { json: Boolean(args.json) });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'decision-conflicts failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// delivery-confidence
// ─────────────────────────────────────────────────────────────────────────

export interface DeliveryConfidenceArgs {
  action?: string;
  file?: string;
  json?: boolean;
}

export function deliveryConfidenceImpl(deps: Deps, args: DeliveryConfidenceArgs): CommandResult {
  const action = args.action ?? 'project';

  if (action === 'score') {
    if (!args.file) {
      deps.logger.error('Usage: jumpstart-mode delivery-confidence score <file>');
      return { exitCode: 1 };
    }
    const safeFile = assertUserPath(deps, args.file, 'delivery-confidence:file');
    const result = confLib.scoreFile(safeFile, { root: deps.projectRoot });
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success) {
      deps.logger.info(
        `Delivery Confidence: ${result.overall_score}% (${result.confidence_level})`
      );
      if (result.dimensions) {
        for (const [dim, data] of Object.entries(result.dimensions)) {
          const d = data as { score?: number };
          deps.logger.info(`  ${dim}: ${d.score ?? 0}%`);
        }
      }
      if (result.top_gaps && result.top_gaps.length > 0) {
        deps.logger.info(`  Gaps: ${result.top_gaps.join(', ')}`);
      }
    } else {
      deps.logger.error(result.error ?? 'score failed');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }

  // project (default)
  const result = confLib.scoreProject(deps.projectRoot);
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else if (result.success) {
    deps.logger.info(`Project Confidence: ${result.project_score}% (${result.project_confidence})`);
    for (const a of result.artifacts ?? []) {
      deps.logger.info(`  ${a.artifact}: ${a.overall_score ?? 0}%`);
    }
  } else {
    deps.logger.error(result.error ?? 'project score failed');
    return { exitCode: 1 };
  }
  return { exitCode: 0 };
}

export const deliveryConfidenceCommand = defineCommand({
  meta: { name: 'delivery-confidence', description: 'Delivery confidence scoring (Feature 14)' },
  args: {
    action: { type: 'positional', description: 'score | project', required: false },
    file: { type: 'positional', description: 'File path (for score)', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = deliveryConfidenceImpl(createRealDeps(), {
      action: args.action,
      file: args.file,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'delivery-confidence failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// dependency-upgrade
// ─────────────────────────────────────────────────────────────────────────

export interface DependencyUpgradeArgs {
  action?: string;
  json?: boolean;
}

export function dependencyUpgradeImpl(deps: Deps, args: DependencyUpgradeArgs): CommandResult {
  const action = args.action ?? 'report';

  if (action === 'scan') {
    const result = depUpgradeLib.scanUpgrades(deps.projectRoot);
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else {
      deps.logger.info(`Dependency Scan: ${result.total} dependencies`);
    }
    return { exitCode: 0 };
  }

  // report (default)
  const result = depUpgradeLib.generateReport();
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info(`Dependency Upgrade Report: ${result.total_plans} plans`);
  }
  return { exitCode: 0 };
}

export const dependencyUpgradeCommand = defineCommand({
  meta: { name: 'dependency-upgrade', description: 'Dependency upgrade planner (Feature 51)' },
  args: {
    action: { type: 'positional', description: 'scan | report', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = dependencyUpgradeImpl(createRealDeps(), {
      action: args.action,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'dependency-upgrade failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// design-system
// ─────────────────────────────────────────────────────────────────────────

export interface DesignSystemArgs {
  action?: string;
  json?: boolean;
}

export function designSystemImpl(deps: Deps, args: DesignSystemArgs): CommandResult {
  void deps.projectRoot;
  const action = args.action ?? 'report';

  if (action === 'check') {
    const result = designLib.checkCompliance();
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else {
      deps.logger.info('Design System Compliance');
      deps.logger.info(`  Compliant: ${result.compliant}  Issues: ${result.issues.length}`);
    }
    return { exitCode: 0 };
  }

  // report (default)
  const result = designLib.generateReport();
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info('Design System Report');
    deps.logger.info(`  Components: ${result.components}  Level: ${result.accessibility_level}`);
  }
  return { exitCode: 0 };
}

export const designSystemCommand = defineCommand({
  meta: {
    name: 'design-system',
    description: 'Design-system token + component compliance (Item 69)',
  },
  args: {
    action: { type: 'positional', description: 'check | report', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = designSystemImpl(createRealDeps(), {
      action: args.action,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'design-system failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// diagram-studio
// ─────────────────────────────────────────────────────────────────────────

export interface DiagramStudioArgs {
  action?: string;
  arg?: string;
  json?: boolean;
}

export function diagramStudioImpl(deps: Deps, args: DiagramStudioArgs): CommandResult {
  const action = args.action ?? 'list';

  if (action === 'generate') {
    const type = args.arg ?? 'sequence';
    const result = diagramLib.generateDiagram(type);
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success) {
      deps.logger.info(`Diagram: ${type}`);
      if (result.content) deps.logger.info(result.content);
    } else {
      deps.logger.error('generate failed');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }

  if (action === 'validate') {
    if (!args.arg) {
      deps.logger.error('File path required for validate');
      return { exitCode: 1 };
    }
    const safeFile = assertUserPath(deps, args.arg, 'diagram-studio:file');
    if (!fs.existsSync(safeFile)) {
      deps.logger.error('File path required for validate');
      return { exitCode: 1 };
    }
    const content = fs.readFileSync(safeFile, 'utf8');
    const result = diagramLib.validateDiagram(content);
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else {
      deps.logger.info(`Diagram Validation: ${result.valid ? 'Valid' : 'Issues Found'}`);
      for (const i of result.issues ?? []) deps.logger.info(`  [${i.type}] ${i.message}`);
    }
    return { exitCode: 0 };
  }

  // list (default)
  const result = diagramLib.listDiagramTypes();
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info('Diagram Types');
    for (const t of result.types) deps.logger.info(`  ${t}`);
  }
  return { exitCode: 0 };
}

export const diagramStudioCommand = defineCommand({
  meta: { name: 'diagram-studio', description: 'Mermaid/PlantUML diagram tools (Item 70)' },
  args: {
    action: { type: 'positional', description: 'generate | validate | list', required: false },
    arg: { type: 'positional', description: 'Type or file path', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = diagramStudioImpl(createRealDeps(), {
      action: args.action,
      arg: args.arg,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'diagram-studio failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// elicitation (structured-elicitation lib)
// ─────────────────────────────────────────────────────────────────────────

export interface ElicitationArgs {
  action?: string;
  arg?: string;
  json?: boolean;
}

export function elicitationImpl(deps: Deps, args: ElicitationArgs): CommandResult {
  void deps.projectRoot;
  const action = args.action ?? 'start';

  if (action === 'start') {
    const domain = args.arg ?? 'general';
    const result = elicitationLib.startElicitation(domain);
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success && result.session) {
      deps.logger.success(`Elicitation ${result.session.id} started for domain: ${domain}`);
      deps.logger.info(`  Questions: ${result.session.questions.length}`);
    } else {
      deps.logger.error(result.error ?? 'start failed');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }

  if (action === 'report') {
    if (!args.arg) {
      deps.logger.error('Usage: jumpstart-mode elicitation report <session-id>');
      return { exitCode: 1 };
    }
    const result = elicitationLib.generateReport(args.arg);
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success) {
      deps.logger.info(`Elicitation Report: ${result.completion_pct}% complete`);
      deps.logger.info(`  Answered: ${result.answered}/${result.total_questions}`);
    } else {
      deps.logger.error(result.error ?? 'report failed');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }

  deps.logger.error('Usage: jumpstart-mode elicitation <start|report> [args]');
  return { exitCode: 1 };
}

export const elicitationCommand = defineCommand({
  meta: { name: 'elicitation', description: 'Structured stakeholder elicitation (Item 66)' },
  args: {
    action: { type: 'positional', description: 'start | report', required: false },
    arg: {
      type: 'positional',
      description: 'Domain (start) or session id (report)',
      required: false,
    },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = elicitationImpl(createRealDeps(), {
      action: args.action,
      arg: args.arg,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'elicitation failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// estimation-studio
// ─────────────────────────────────────────────────────────────────────────

export interface EstimationStudioArgs {
  action?: string;
  name?: string;
  size?: string;
  json?: boolean;
}

export function estimationStudioImpl(deps: Deps, args: EstimationStudioArgs): CommandResult {
  void deps.projectRoot;
  const action = args.action ?? 'report';

  if (action === 'estimate') {
    if (!args.name || !args.size) {
      deps.logger.error('Usage: jumpstart-mode estimation-studio estimate <name> <size>');
      return { exitCode: 1 };
    }
    const result = estimationLib.estimateFeature(args.name, args.size);
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success && result.estimate) {
      deps.logger.info(`Estimate: ${args.name}`);
      deps.logger.info(
        `  Size: ${result.estimate.tshirt_size}  Points: ${result.estimate.story_points}  Days: ${result.estimate.ideal_days}`
      );
      deps.logger.info(`  ROM: $${result.estimate.rom_cost.min}–$${result.estimate.rom_cost.max}`);
    } else {
      deps.logger.error(result.error ?? 'estimate failed');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }

  // report (default)
  const result = estimationLib.generateReport();
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info(`Estimation Report: ${result.total_features} features`);
    deps.logger.info(
      `  Total points: ${result.total_story_points}  Total days: ${result.total_ideal_days}`
    );
  }
  return { exitCode: 0 };
}

export const estimationStudioCommand = defineCommand({
  meta: { name: 'estimation-studio', description: 'Story-point + ROM cost estimation (Item 72)' },
  args: {
    action: { type: 'positional', description: 'estimate | report', required: false },
    name: { type: 'positional', description: 'Feature name', required: false },
    size: { type: 'positional', description: 'T-shirt size (XS/S/M/L/XL/XXL)', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = estimationStudioImpl(createRealDeps(), {
      action: args.action,
      name: args.name,
      size: args.size,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'estimation-studio failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// playback-summaries
// ─────────────────────────────────────────────────────────────────────────

export interface PlaybackSummariesArgs {
  action?: string;
  audience?: string;
  json?: boolean;
}

export function playbackSummariesImpl(deps: Deps, args: PlaybackSummariesArgs): CommandResult {
  const action = args.action ?? 'list';

  if (action === 'generate') {
    const audience = args.audience ?? 'executive';
    const result = playbackLib.generateSummary(deps.projectRoot, audience);
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success && result.summary) {
      const s = result.summary;
      deps.logger.info(s.label);
      deps.logger.info(`  Tone: ${s.tone}  Focus: ${s.focus_areas.join(', ')}`);
    } else {
      deps.logger.error(result.error ?? 'generate failed');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }

  // list (default)
  const result = playbackLib.listAudiences();
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info('Available Audiences');
    for (const a of result.audiences) deps.logger.info(`  ${a.id}: ${a.label} (${a.tone})`);
  }
  return { exitCode: 0 };
}

export const playbackSummariesCommand = defineCommand({
  meta: {
    name: 'playback-summaries',
    description: 'Audience-targeted playback summaries (Item 68)',
  },
  args: {
    action: { type: 'positional', description: 'generate | list', required: false },
    audience: {
      type: 'positional',
      description: 'Audience (executive/technical/...)',
      required: false,
    },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = playbackSummariesImpl(createRealDeps(), {
      action: args.action,
      audience: args.audience,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'playback-summaries failed');
  },
});
