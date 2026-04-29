/**
 * governance.ts — Governance / risk cluster (T4.7.2 batch 7).
 *
 * Ports the following bin/cli.js subcommands into citty `defineCommand`s:
 *   - adr                   (lib-ts: adr-index.buildIndex/searchIndex)
 *   - policy                (lib-ts: policy-engine)
 *   - role-approval         (lib-ts: role-approval)
 *   - raci-matrix           (lib-ts: raci-matrix)
 *   - compliance-packs      (lib-ts: compliance-packs)
 *   - evidence-collector    (lib-ts: evidence-collector)
 *   - waiver-workflow       (lib-ts: waiver-workflow)
 *   - risk-register         (lib-ts: risk-register)
 *   - data-classification   (lib-ts: data-classification)
 *   - credential-boundary   (lib-ts: credential-boundary)
 *   - vendor-risk           (lib-ts: vendor-risk)
 *   - ops-ownership         (lib-ts: ops-ownership)
 *   - governance-dashboard  (lib-ts: governance-dashboard)
 *   - incident-feedback     (lib-ts: incident-feedback)
 *   - workstream-ownership  (lib-ts: workstream-ownership)
 *   - ai-evaluation         (lib-ts: ai-evaluation)
 *
 * Pattern: each leaf command is a `defineCommand` exported as
 * `<name>Command`. Pure logic lives in `<name>Impl(deps, args)`.
 * All lib-ts imports are TOP-LEVEL ES imports (per marketplace.ts /
 * lifecycle.ts canonical example).
 *
 * @see bin/cli.js (lines 2557-2613, 2743-2817, 3357-3389, 3392-3421,
 *      3424-3447, 3480-3515, 3550-3578, 3581-3608, 3611-3625, 3718-3738,
 *      3788-3814, 3817-3826, 4053-4074, 4752-4771, 4973-4994, 5148-5172
 *      — legacy reference)
 * @see specs/implementation-plan.md T4.7.2
 */

import { defineCommand } from 'citty';
import { buildIndex, searchIndex } from '../../../bin/lib-ts/adr-index.js';
import {
  evaluate as aiEvaluate,
  generateReport as aiEvaluationReport,
} from '../../../bin/lib-ts/ai-evaluation.js';
import {
  applyFramework,
  checkCompliance as checkComplianceFrameworks,
  listFrameworks,
} from '../../../bin/lib-ts/compliance-packs.js';
import { scanProject as scanCredentialBoundary } from '../../../bin/lib-ts/credential-boundary.js';
import {
  checkCompliance as checkDataClassification,
  classifyAsset,
  generateReport as dataClassificationReport,
} from '../../../bin/lib-ts/data-classification.js';
import {
  collectEvidence,
  getStatus as evidenceStatus,
  packageEvidence,
} from '../../../bin/lib-ts/evidence-collector.js';
import {
  gatherGovernanceData,
  renderDashboardText,
} from '../../../bin/lib-ts/governance-dashboard.js';
import {
  generateReport as incidentReport,
  logIncident,
} from '../../../bin/lib-ts/incident-feedback.js';
import { writeResult } from '../../../bin/lib-ts/io.js';
import {
  checkCompleteness as opsCheckCompleteness,
  defineOwnership as opsDefineOwnership,
  generateReport as opsReport,
} from '../../../bin/lib-ts/ops-ownership.js';
import { addPolicy, checkPolicies, listPolicies } from '../../../bin/lib-ts/policy-engine.js';
import {
  checkPermission,
  defineAssignment,
  generateReport as raciReport,
} from '../../../bin/lib-ts/raci-matrix.js';
import {
  addRisk,
  listRisks,
  generateReport as riskReport,
} from '../../../bin/lib-ts/risk-register.js';
import {
  assignApprovers,
  getApprovalStatus,
  listApprovalWorkflows,
  recordRoleAction,
} from '../../../bin/lib-ts/role-approval.js';
import {
  scanDependencies,
  generateReport as vendorReport,
} from '../../../bin/lib-ts/vendor-risk.js';
import {
  expireWaivers,
  listWaivers,
  requestWaiver,
  resolveWaiver,
} from '../../../bin/lib-ts/waiver-workflow.js';
import {
  defineWorkstream,
  generateReport as workstreamReport,
} from '../../../bin/lib-ts/workstream-ownership.js';
import { type CommandResult, createRealDeps, type Deps } from '../deps.js';
import { asRest, parseFlag, safeJoin } from './_helpers.js';

// ─────────────────────────────────────────────────────────────────────────
// adr
// ─────────────────────────────────────────────────────────────────────────

export interface AdrArgs {
  action?: string;
  query?: string;
  tag?: string;
  json?: boolean;
}

export function adrImpl(deps: Deps, args: AdrArgs): CommandResult {
  const action = args.action ?? 'build';
  if (action === 'search') {
    const result = searchIndex(deps.projectRoot, {
      query: args.query ?? '',
      tag: args.tag,
    });
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else {
      deps.logger.info(`ADR Search: "${args.query ?? ''}" — ${result.total} results`);
      for (const r of result.results) {
        deps.logger.info(`  ${r.id}: ${r.title} [${r.status}]`);
      }
    }
    return { exitCode: 0 };
  }
  const result = buildIndex(deps.projectRoot);
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info(`ADR Index: ${result.indexed} records indexed`);
    deps.logger.info(`  Index path: ${result.index_path}`);
  }
  return { exitCode: 0 };
}

export const adrCommand = defineCommand({
  meta: { name: 'adr', description: 'ADR index — build/search architectural decision records' },
  args: {
    action: { type: 'positional', description: 'build | search', required: false },
    query: { type: 'positional', description: 'Search query (for search)', required: false },
    tag: { type: 'string', description: 'Tag filter (for search)', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = adrImpl(createRealDeps(), {
      action: args.action,
      query: args.query,
      tag: args.tag,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'adr failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// policy
// ─────────────────────────────────────────────────────────────────────────

export interface PolicyArgs {
  action?: string;
  rest: string[];
  json?: boolean;
}

export function policyImpl(deps: Deps, args: PolicyArgs): CommandResult {
  const policyFile = safeJoin(deps, '.jumpstart', 'policies.json');
  const action = args.action ?? 'check';

  if (action === 'check') {
    const result = checkPolicies(deps.projectRoot, { policyFile });
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else {
      deps.logger.info(`Policy Check: ${result.summary.passed ? 'PASSED' : 'FAILED'}`);
      deps.logger.info(`  Policies: ${result.summary.total_policies_checked}`);
      deps.logger.info(
        `  Violations: ${result.summary.violations}  Warnings: ${result.summary.warnings}`
      );
    }
    return { exitCode: 0 };
  }
  if (action === 'list') {
    const result = listPolicies({}, { policyFile });
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else {
      deps.logger.info(`Policies (${result.total})`);
      for (const p of result.policies) {
        deps.logger.info(`  [${p.category}/${p.severity}] ${p.name} — ${p.id}`);
      }
    }
    return { exitCode: 0 };
  }
  if (action === 'add') {
    const name = parseFlag(args.rest, 'name');
    const desc = parseFlag(args.rest, 'desc');
    if (!name || !desc) {
      deps.logger.error(
        'Usage: jumpstart-mode policy add --name <name> --desc <desc> [--category <cat>] [--severity <sev>]'
      );
      return { exitCode: 1 };
    }
    const result = addPolicy(
      {
        name,
        description: desc,
        category: parseFlag(args.rest, 'category') ?? 'other',
        severity: parseFlag(args.rest, 'severity') ?? 'warning',
        pattern: parseFlag(args.rest, 'pattern'),
      },
      { policyFile }
    );
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success && result.policy) {
      deps.logger.success(`Policy added: ${result.policy.id}`);
    } else {
      deps.logger.error(result.error ?? 'failed to add policy');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }
  deps.logger.error('Usage: jumpstart-mode policy [check|list|add] [options]');
  return { exitCode: 1 };
}

export const policyCommand = defineCommand({
  meta: { name: 'policy', description: 'Policy engine — check, list, add policy rules' },
  args: {
    action: { type: 'positional', description: 'check | list | add', required: false },
    rest: { type: 'positional', description: 'Optional flags', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = policyImpl(createRealDeps(), {
      action: args.action,
      rest: asRest(args.rest),
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'policy failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// role-approval
// ─────────────────────────────────────────────────────────────────────────

export interface RoleApprovalArgs {
  action?: string;
  artifact?: string;
  rolesOrRole?: string;
  rest: string[];
  json?: boolean;
}

export function roleApprovalImpl(deps: Deps, args: RoleApprovalArgs): CommandResult {
  const stateFile = safeJoin(deps, '.jumpstart', 'state', 'role-approvals.json');
  const action = args.action ?? 'status';

  if (action === 'assign') {
    if (!args.artifact || !args.rolesOrRole) {
      deps.logger.error('Usage: jumpstart-mode role-approval assign <artifact> <role1,role2,...>');
      return { exitCode: 1 };
    }
    const roles = args.rolesOrRole.split(',').map((r) => ({ role: r.trim(), required: true }));
    const result = assignApprovers(args.artifact, roles, { stateFile });
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success) {
      deps.logger.success(`Approvers assigned to ${args.artifact}`);
    } else {
      deps.logger.error(result.error ?? 'assign failed');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }
  if (action === 'approve' || action === 'reject') {
    if (!args.artifact || !args.rolesOrRole) {
      deps.logger.error(
        `Usage: jumpstart-mode role-approval ${action} <artifact> <role> [--approver <name>]`
      );
      return { exitCode: 1 };
    }
    const result = recordRoleAction(args.artifact, args.rolesOrRole, action, {
      stateFile,
      approverName: parseFlag(args.rest, 'approver'),
    });
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success) {
      deps.logger.success(
        `${action === 'approve' ? 'Approved' : 'Rejected'} [${args.rolesOrRole}]: ${args.artifact}`
      );
    } else {
      deps.logger.error(result.error ?? `${action} failed`);
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }
  // status (default)
  if (args.artifact) {
    const result = getApprovalStatus(args.artifact, { stateFile });
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.has_workflow) {
      deps.logger.info(`Approval Status: ${args.artifact}  Status: ${result.status}`);
    } else {
      deps.logger.info(result.message ?? 'No workflow');
    }
    return { exitCode: 0 };
  }
  const result = listApprovalWorkflows({}, { stateFile });
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info(`Approval Workflows (${result.total})`);
    for (const w of result.workflows) {
      deps.logger.info(`  [${w.status}] ${w.artifact}  roles=${w.approvers.length}`);
    }
  }
  return { exitCode: 0 };
}

export const roleApprovalCommand = defineCommand({
  meta: {
    name: 'role-approval',
    description: 'Role-based approval workflows — assign / approve / reject / status',
  },
  args: {
    action: {
      type: 'positional',
      description: 'assign | approve | reject | status',
      required: false,
    },
    artifact: { type: 'positional', description: 'Artifact path', required: false },
    rolesOrRole: { type: 'positional', description: 'Role(s)', required: false },
    rest: { type: 'positional', description: 'Optional flags', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = roleApprovalImpl(createRealDeps(), {
      action: args.action,
      artifact: args.artifact,
      rolesOrRole: args.rolesOrRole,
      rest: asRest(args.rest),
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'role-approval failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// raci-matrix
// ─────────────────────────────────────────────────────────────────────────

export interface RaciArgs {
  action?: string;
  artifact?: string;
  arg2?: string;
  json?: boolean;
}

export function raciMatrixImpl(deps: Deps, args: RaciArgs): CommandResult {
  const stateFile = safeJoin(deps, '.jumpstart', 'state', 'raci-matrix.json');
  const action = args.action ?? 'report';

  if (action === 'define') {
    if (!args.artifact || !args.arg2) {
      deps.logger.error('Usage: jumpstart-mode raci-matrix define <artifact> <accountable>');
      return { exitCode: 1 };
    }
    const result = defineAssignment(args.artifact, { accountable: args.arg2 }, { stateFile });
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success) {
      deps.logger.success(`RACI defined for ${args.artifact}`);
    } else {
      deps.logger.error(result.error ?? 'define failed');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }
  if (action === 'check') {
    if (!args.artifact || !args.arg2) {
      deps.logger.error('Usage: jumpstart-mode raci-matrix check <artifact> <actor>');
      return { exitCode: 1 };
    }
    const result = checkPermission(args.artifact, args.arg2, 'approve', { stateFile });
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.allowed) {
      deps.logger.success(result.reason ?? 'allowed');
    } else {
      deps.logger.error(result.reason ?? 'denied');
    }
    return { exitCode: 0 };
  }
  // report (default)
  const result = raciReport({ stateFile });
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info(
      `RACI Matrix (${result.total_assignments} assignments, ${result.coverage}% coverage)`
    );
  }
  return { exitCode: 0 };
}

export const raciMatrixCommand = defineCommand({
  meta: { name: 'raci-matrix', description: 'RACI matrix — define / check / report' },
  args: {
    action: { type: 'positional', description: 'define | check | report', required: false },
    artifact: { type: 'positional', description: 'Artifact path', required: false },
    arg2: { type: 'positional', description: 'Accountable / actor', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = raciMatrixImpl(createRealDeps(), {
      action: args.action,
      artifact: args.artifact,
      arg2: args.arg2,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'raci-matrix failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// compliance-packs
// ─────────────────────────────────────────────────────────────────────────

export interface CompliancePacksArgs {
  action?: string;
  framework?: string;
  json?: boolean;
}

export function compliancePacksImpl(deps: Deps, args: CompliancePacksArgs): CommandResult {
  const stateFile = safeJoin(deps, '.jumpstart', 'state', 'compliance.json');
  const action = args.action ?? 'list';

  if (action === 'list') {
    const result = listFrameworks();
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else {
      deps.logger.info(`Compliance Frameworks (${result.total})`);
      for (const fw of result.frameworks) {
        deps.logger.info(`  ${fw.id}: ${fw.name} (${fw.controls} controls)`);
      }
    }
    return { exitCode: 0 };
  }
  if (action === 'apply') {
    if (!args.framework) {
      deps.logger.error('Usage: jumpstart-mode compliance-packs apply <framework-id>');
      return { exitCode: 1 };
    }
    const result = applyFramework(args.framework, { stateFile });
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success) {
      deps.logger.success(`Applied ${result.name} (${result.controls_added} controls)`);
    } else {
      deps.logger.error(result.error ?? 'apply failed');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }
  if (action === 'check') {
    const result = checkComplianceFrameworks({ stateFile });
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else {
      deps.logger.info('Compliance Check');
    }
    return { exitCode: 0 };
  }
  deps.logger.error('Usage: jumpstart-mode compliance-packs [list|apply|check]');
  return { exitCode: 1 };
}

export const compliancePacksCommand = defineCommand({
  meta: { name: 'compliance-packs', description: 'Compliance frameworks — list / apply / check' },
  args: {
    action: { type: 'positional', description: 'list | apply | check', required: false },
    framework: { type: 'positional', description: 'Framework id (apply)', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = compliancePacksImpl(createRealDeps(), {
      action: args.action,
      framework: args.framework,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'compliance-packs failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// evidence-collector
// ─────────────────────────────────────────────────────────────────────────

export interface EvidenceCollectorArgs {
  action?: string;
  json?: boolean;
}

export function evidenceCollectorImpl(deps: Deps, args: EvidenceCollectorArgs): CommandResult {
  const action = args.action ?? 'status';

  if (action === 'collect') {
    const result = collectEvidence(deps.projectRoot);
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else {
      deps.logger.success(`Collected ${result.items_collected} evidence items`);
    }
    return { exitCode: 0 };
  }
  if (action === 'package') {
    const result = packageEvidence(deps.projectRoot);
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else {
      deps.logger.success(`Evidence packaged: ${result.output}`);
    }
    return { exitCode: 0 };
  }
  // status (default)
  const result = evidenceStatus();
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info(
      `Evidence Status: ${result.total_items} items, ${result.collections} collections`
    );
  }
  return { exitCode: 0 };
}

export const evidenceCollectorCommand = defineCommand({
  meta: {
    name: 'evidence-collector',
    description: 'Evidence collector — collect / package / status',
  },
  args: {
    action: { type: 'positional', description: 'collect | package | status', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = evidenceCollectorImpl(createRealDeps(), {
      action: args.action,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'evidence-collector failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// waiver-workflow
// ─────────────────────────────────────────────────────────────────────────

export interface WaiverWorkflowArgs {
  action?: string;
  arg1?: string;
  arg2?: string;
  json?: boolean;
}

export function waiverWorkflowImpl(deps: Deps, args: WaiverWorkflowArgs): CommandResult {
  const stateFile = safeJoin(deps, '.jumpstart', 'state', 'waivers.json');
  const action = args.action ?? 'list';

  if (action === 'request') {
    if (!args.arg1 || !args.arg2) {
      deps.logger.error('Usage: jumpstart-mode waiver-workflow request <title> <owner>');
      return { exitCode: 1 };
    }
    const result = requestWaiver(
      { title: args.arg1, owner: args.arg2, justification: 'CLI request' },
      { stateFile }
    );
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success && result.waiver) {
      deps.logger.success(`Waiver requested: ${result.waiver.id}`);
    } else {
      deps.logger.error(result.error ?? 'request failed');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }
  if (action === 'approve') {
    if (!args.arg1) {
      deps.logger.error('Usage: jumpstart-mode waiver-workflow approve <waiver-id>');
      return { exitCode: 1 };
    }
    const result = resolveWaiver(args.arg1, 'approve', { stateFile });
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success) {
      deps.logger.success(`Waiver approved: ${args.arg1}`);
    } else {
      deps.logger.error(result.error ?? 'approve failed');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }
  if (action === 'expire') {
    const result = expireWaivers({ stateFile });
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else {
      deps.logger.success(`Expired ${result.expired} waivers`);
    }
    return { exitCode: 0 };
  }
  // list (default)
  const result = listWaivers({}, { stateFile });
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info(`Waivers (${result.total})`);
    for (const w of result.waivers) {
      deps.logger.info(`  [${w.status}] ${w.id}: ${w.title} (${w.owner})`);
    }
  }
  return { exitCode: 0 };
}

export const waiverWorkflowCommand = defineCommand({
  meta: {
    name: 'waiver-workflow',
    description: 'Waiver workflow — request / approve / expire / list',
  },
  args: {
    action: {
      type: 'positional',
      description: 'request | approve | expire | list',
      required: false,
    },
    arg1: { type: 'positional', description: 'Title or waiver-id', required: false },
    arg2: { type: 'positional', description: 'Owner (for request)', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = waiverWorkflowImpl(createRealDeps(), {
      action: args.action,
      arg1: args.arg1,
      arg2: args.arg2,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'waiver-workflow failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// risk-register
// ─────────────────────────────────────────────────────────────────────────

export interface RiskRegisterArgs {
  action?: string;
  title?: string;
  json?: boolean;
}

export function riskRegisterImpl(deps: Deps, args: RiskRegisterArgs): CommandResult {
  const stateFile = safeJoin(deps, '.jumpstart', 'state', 'risk-register.json');
  const action = args.action ?? 'report';

  if (action === 'add') {
    if (!args.title) {
      deps.logger.error('Usage: jumpstart-mode risk-register add <title>');
      return { exitCode: 1 };
    }
    const result = addRisk({ title: args.title, description: args.title }, { stateFile });
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success && result.risk) {
      deps.logger.success(`Risk added: ${result.risk.id} (score: ${result.risk.score})`);
    } else {
      deps.logger.error(result.error ?? 'add failed');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }
  if (action === 'list') {
    const result = listRisks({}, { stateFile });
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else {
      deps.logger.info(`Risk Register (${result.total})`);
      for (const r of result.risks) {
        deps.logger.info(
          `  [${r.status}] ${r.id}: ${r.title} (${r.likelihood}/${r.impact}, score=${r.score})`
        );
      }
    }
    return { exitCode: 0 };
  }
  // report (default)
  const result = riskReport({ stateFile });
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info(`Risk Report: ${result.total_risks} risks, avg score=${result.average_score}`);
    deps.logger.info(`  High: ${result.high_risks}  Unmitigated: ${result.unmitigated}`);
  }
  return { exitCode: 0 };
}

export const riskRegisterCommand = defineCommand({
  meta: { name: 'risk-register', description: 'Risk register — add / list / report' },
  args: {
    action: { type: 'positional', description: 'add | list | report', required: false },
    title: { type: 'positional', description: 'Risk title (add)', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = riskRegisterImpl(createRealDeps(), {
      action: args.action,
      title: args.title,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'risk-register failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// data-classification
// ─────────────────────────────────────────────────────────────────────────

export interface DataClassificationArgs {
  action?: string;
  name?: string;
  json?: boolean;
}

export function dataClassificationImpl(deps: Deps, args: DataClassificationArgs): CommandResult {
  const stateFile = safeJoin(deps, '.jumpstart', 'state', 'data-classification.json');
  const action = args.action ?? 'report';

  if (action === 'classify') {
    if (!args.name) {
      deps.logger.error('Usage: jumpstart-mode data-classification classify <asset-name>');
      return { exitCode: 1 };
    }
    const result = classifyAsset({ name: args.name }, { stateFile });
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success && result.asset) {
      deps.logger.success(`Classified: ${result.asset.classification}`);
    } else {
      deps.logger.error(result.error ?? 'classify failed');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }
  if (action === 'check') {
    const result = checkDataClassification({ stateFile });
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else {
      deps.logger.info(
        `Data Classification: ${result.total_assets} assets, ${result.violations} violations`
      );
    }
    return { exitCode: 0 };
  }
  // report (default)
  const result = dataClassificationReport({ stateFile });
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info(`Data Classification Report: ${result.total_assets} assets`);
  }
  return { exitCode: 0 };
}

export const dataClassificationCommand = defineCommand({
  meta: {
    name: 'data-classification',
    description: 'Data classification — classify / check / report',
  },
  args: {
    action: { type: 'positional', description: 'classify | check | report', required: false },
    name: { type: 'positional', description: 'Asset name (classify)', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = dataClassificationImpl(createRealDeps(), {
      action: args.action,
      name: args.name,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'data-classification failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// credential-boundary
// ─────────────────────────────────────────────────────────────────────────

export interface CredentialBoundaryArgs {
  json?: boolean;
}

export function credentialBoundaryImpl(deps: Deps, args: CredentialBoundaryArgs): CommandResult {
  const result = scanCredentialBoundary(deps.projectRoot);
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info('Credential Boundary Scan');
    deps.logger.info(`  Files scanned: ${result.files_scanned}`);
    deps.logger.info(
      `  Findings: ${result.total_findings} (${result.critical} critical, ${result.high} high)`
    );
    if (result.pass) deps.logger.success('PASS');
    else deps.logger.error('FAIL');
  }
  return { exitCode: 0 };
}

export const credentialBoundaryCommand = defineCommand({
  meta: {
    name: 'credential-boundary',
    description: 'Credential boundary scan — detect leaked credentials',
  },
  args: {
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = credentialBoundaryImpl(createRealDeps(), { json: Boolean(args.json) });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'credential-boundary failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// vendor-risk
// ─────────────────────────────────────────────────────────────────────────

export interface VendorRiskArgs {
  action?: string;
  json?: boolean;
}

export function vendorRiskImpl(deps: Deps, args: VendorRiskArgs): CommandResult {
  const stateFile = safeJoin(deps, '.jumpstart', 'state', 'vendor-risk.json');
  const action = args.action ?? 'report';

  if (action === 'scan') {
    const result = scanDependencies(deps.projectRoot);
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else {
      deps.logger.info(`Vendor Scan: ${result.total} dependencies found`);
    }
    return { exitCode: 0 };
  }
  // report (default)
  const result = vendorReport({ stateFile });
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info(`Vendor Risk Report: ${result.total_assessed} assessed`);
    deps.logger.info(`  Avg score: ${result.average_score}  High risk: ${result.high_risk.length}`);
  }
  return { exitCode: 0 };
}

export const vendorRiskCommand = defineCommand({
  meta: { name: 'vendor-risk', description: 'Vendor risk — scan / report' },
  args: {
    action: { type: 'positional', description: 'scan | report', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = vendorRiskImpl(createRealDeps(), {
      action: args.action,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'vendor-risk failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// ops-ownership
// ─────────────────────────────────────────────────────────────────────────

export interface OpsOwnershipArgs {
  action?: string;
  service?: string;
  owner?: string;
  json?: boolean;
}

export function opsOwnershipImpl(deps: Deps, args: OpsOwnershipArgs): CommandResult {
  const stateFile = safeJoin(deps, '.jumpstart', 'state', 'ops-ownership.json');
  const action = args.action ?? 'report';

  if (action === 'define') {
    if (!args.service || !args.owner) {
      deps.logger.error('Usage: jumpstart-mode ops-ownership define <service> <owner>');
      return { exitCode: 1 };
    }
    const result = opsDefineOwnership(
      { name: args.service, service_owner: args.owner },
      { stateFile }
    );
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success) {
      deps.logger.success(`Ownership defined for ${args.service}`);
    } else {
      deps.logger.error(result.error ?? 'define failed');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }
  if (action === 'check') {
    const result = opsCheckCompleteness({ stateFile });
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else {
      deps.logger.info(`Ops Ownership: ${result.complete}/${result.total_services} complete`);
    }
    return { exitCode: 0 };
  }
  // report (default)
  const result = opsReport({ stateFile });
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info(`Ops Ownership Report: ${result.total_services} services`);
  }
  return { exitCode: 0 };
}

export const opsOwnershipCommand = defineCommand({
  meta: { name: 'ops-ownership', description: 'Ops ownership — define / check / report' },
  args: {
    action: { type: 'positional', description: 'define | check | report', required: false },
    service: { type: 'positional', description: 'Service name (define)', required: false },
    owner: { type: 'positional', description: 'Owner (define)', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = opsOwnershipImpl(createRealDeps(), {
      action: args.action,
      service: args.service,
      owner: args.owner,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'ops-ownership failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// governance-dashboard
// ─────────────────────────────────────────────────────────────────────────

export interface GovernanceDashboardArgs {
  json?: boolean;
}

export function governanceDashboardImpl(deps: Deps, args: GovernanceDashboardArgs): CommandResult {
  const result = gatherGovernanceData(deps.projectRoot);
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info(renderDashboardText(result));
  }
  return { exitCode: 0 };
}

export const governanceDashboardCommand = defineCommand({
  meta: {
    name: 'governance-dashboard',
    description: 'Governance dashboard — aggregate governance metrics',
  },
  args: {
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = governanceDashboardImpl(createRealDeps(), { json: Boolean(args.json) });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'governance-dashboard failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// incident-feedback
// ─────────────────────────────────────────────────────────────────────────

export interface IncidentFeedbackArgs {
  action?: string;
  title?: string;
  severity?: string;
  json?: boolean;
}

export function incidentFeedbackImpl(deps: Deps, args: IncidentFeedbackArgs): CommandResult {
  const stateFile = safeJoin(deps, '.jumpstart', 'state', 'incidents.json');
  const action = args.action ?? 'report';

  if (action === 'log') {
    if (!args.title) {
      deps.logger.error('Usage: jumpstart-mode incident-feedback log <title> [severity]');
      return { exitCode: 1 };
    }
    const result = logIncident(
      { title: args.title, severity: args.severity ?? 'sev3', description: args.title },
      { stateFile }
    );
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success && result.incident) {
      deps.logger.success(`Incident logged: ${result.incident.id}`);
    } else {
      deps.logger.error(result.error ?? 'log failed');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }
  // report (default)
  const result = incidentReport({ stateFile });
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info(
      `Incident Feedback: ${result.total_incidents} incidents, ${result.total_spec_updates} spec updates`
    );
  }
  return { exitCode: 0 };
}

export const incidentFeedbackCommand = defineCommand({
  meta: { name: 'incident-feedback', description: 'Incident feedback — log / report' },
  args: {
    action: { type: 'positional', description: 'log | report', required: false },
    title: { type: 'positional', description: 'Incident title (log)', required: false },
    severity: { type: 'positional', description: 'Severity (log)', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = incidentFeedbackImpl(createRealDeps(), {
      action: args.action,
      title: args.title,
      severity: args.severity,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'incident-feedback failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// workstream-ownership
// ─────────────────────────────────────────────────────────────────────────

export interface WorkstreamOwnershipArgs {
  action?: string;
  name?: string;
  team?: string;
  json?: boolean;
}

export function workstreamOwnershipImpl(deps: Deps, args: WorkstreamOwnershipArgs): CommandResult {
  const action = args.action ?? 'report';

  if (action === 'define') {
    if (!args.name) {
      deps.logger.error('Usage: jumpstart-mode workstream-ownership define <name> [team]');
      return { exitCode: 1 };
    }
    const result = defineWorkstream(args.name, { team: args.team });
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success && result.workstream) {
      deps.logger.success(`Workstream ${result.workstream.id} defined: ${args.name}`);
    } else {
      deps.logger.error(result.error ?? 'define failed');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }
  // report (default)
  const result = workstreamReport();
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info(
      `Workstream Report: ${result.total_workstreams} workstreams, ${result.total_dependencies} dependencies`
    );
  }
  return { exitCode: 0 };
}

export const workstreamOwnershipCommand = defineCommand({
  meta: {
    name: 'workstream-ownership',
    description: 'Workstream ownership — define / report',
  },
  args: {
    action: { type: 'positional', description: 'define | report', required: false },
    name: { type: 'positional', description: 'Workstream name (define)', required: false },
    team: { type: 'positional', description: 'Team (define)', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = workstreamOwnershipImpl(createRealDeps(), {
      action: args.action,
      name: args.name,
      team: args.team,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'workstream-ownership failed');
  },
});

// ─────────────────────────────────────────────────────────────────────────
// ai-evaluation
// ─────────────────────────────────────────────────────────────────────────

export interface AiEvaluationArgs {
  action?: string;
  name?: string;
  json?: boolean;
}

export function aiEvaluationImpl(deps: Deps, args: AiEvaluationArgs): CommandResult {
  const action = args.action ?? 'report';

  if (action === 'evaluate') {
    if (!args.name) {
      deps.logger.error('Usage: jumpstart-mode ai-evaluation evaluate <name>');
      return { exitCode: 1 };
    }
    const result = aiEvaluate(args.name, { groundedness: 80, hallucination: 90, safety: 85 });
    if (args.json) {
      writeResult(result as unknown as Record<string, unknown>);
    } else if (result.success && result.evaluation) {
      deps.logger.info(`AI Evaluation: ${args.name}`);
      deps.logger.info(`  Overall: ${result.evaluation.overall}%`);
    } else {
      deps.logger.error(result.error ?? 'evaluate failed');
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }
  // report (default)
  const result = aiEvaluationReport();
  if (args.json) {
    writeResult(result as unknown as Record<string, unknown>);
  } else {
    deps.logger.info(`AI Evaluation Report: ${result.total_evaluations} evaluations`);
  }
  return { exitCode: 0 };
}

export const aiEvaluationCommand = defineCommand({
  meta: { name: 'ai-evaluation', description: 'AI evaluation — evaluate / report' },
  args: {
    action: { type: 'positional', description: 'evaluate | report', required: false },
    name: { type: 'positional', description: 'Evaluation name (evaluate)', required: false },
    json: { type: 'boolean', description: 'JSON output mode', required: false },
  },
  run({ args }) {
    const r = aiEvaluationImpl(createRealDeps(), {
      action: args.action,
      name: args.name,
      json: Boolean(args.json),
    });
    if (r.exitCode !== 0) throw new Error(r.message ?? 'ai-evaluation failed');
  },
});
