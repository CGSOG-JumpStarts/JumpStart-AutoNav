/**
 * test-cli-cleanup.test.ts — T4.7.2 batch 10 (cleanup cluster, FINAL).
 *
 * Smoke + dispatcher coverage for the `src/cli/commands/cleanup.ts` commands.
 * Validates:
 *
 *   1. Each `<name>Command` has the expected `meta.name`.
 *   2. `main.subCommands` exposes the new lazy thunks.
 *
 * @see src/cli/commands/cleanup.ts
 * @see specs/implementation-plan.md T4.7.2
 */

import { describe, expect, it } from 'vitest';
import {
  adrCommand,
  aiEvaluationCommand,
  artifactComparisonCommand,
  artifactComparisonImpl,
  backlogSyncCommand,
  bcdrPlanningCommand,
  branchWorkflowCommand,
  cabOutputCommand,
  chatIntegrationCommand,
  ciCdIntegrationCommand,
  collaborationCommand,
  compliancePacksCommand,
  contextOnboardingCommand,
  credentialBoundaryCommand,
  dataClassificationCommand,
  dataContractsCommand,
  dbEvolutionCommand,
  decisionConflictsCommand,
  deliveryConfidenceCommand,
  dependencyUpgradeCommand,
  designSystemCommand,
  diagramStudioCommand,
  eaReviewPacketCommand,
  elicitationCommand,
  estimationStudioCommand,
  evidenceCollectorCommand,
  governanceDashboardCommand,
  guidedHandoffCommand,
  incidentFeedbackCommand,
  opsOwnershipCommand,
  playbackSummariesCommand,
  policyCommand,
  portfolioCommand,
  raciMatrixCommand,
  repoGraphCommand,
  requirementsBaselineCommand,
  revertCommand,
  revertImpl,
  riskRegisterCommand,
  roleApprovalCommand,
  roleViewsCommand,
  rootCauseCommand,
  runtimeDebuggerCommand,
  safeRenameCommand,
  scanCommand,
  semanticDiffCommand,
  slaSloCommand,
  specCommentsCommand,
  specMaturityCommand,
  sreIntegrationCommand,
  telemetryFeedbackCommand,
  testGeneratorCommand,
  timestampCommand,
  timestampImpl,
  toolGuardrailsCommand,
  transcriptIngestionCommand,
  vendorRiskCommand,
  waiverWorkflowCommand,
  webDashboardCommand,
  workshopModeCommand,
  workstreamOwnershipCommand,
} from '../src/cli/commands/cleanup.js';
import { createTestDeps } from '../src/cli/deps.js';
import { main } from '../src/cli/main.js';

async function metaName(cmd: { meta?: unknown }): Promise<string | undefined> {
  const m = cmd.meta;
  const resolved =
    typeof m === 'function'
      ? await (m as () => Promise<{ name?: string } | undefined>)()
      : await (m as Promise<{ name?: string } | undefined> | { name?: string } | undefined);
  return resolved?.name;
}

describe('cleanup cluster — defineCommand meta.name', () => {
  const cases: [string, { meta?: unknown }][] = [
    ['adr', adrCommand],
    ['ai-evaluation', aiEvaluationCommand],
    ['artifact-comparison', artifactComparisonCommand],
    ['backlog-sync', backlogSyncCommand],
    ['bcdr-planning', bcdrPlanningCommand],
    ['branch-workflow', branchWorkflowCommand],
    ['cab-output', cabOutputCommand],
    ['chat-integration', chatIntegrationCommand],
    ['ci-cd-integration', ciCdIntegrationCommand],
    ['collaboration', collaborationCommand],
    ['compliance-packs', compliancePacksCommand],
    ['context-onboarding', contextOnboardingCommand],
    ['credential-boundary', credentialBoundaryCommand],
    ['data-classification', dataClassificationCommand],
    ['data-contracts', dataContractsCommand],
    ['db-evolution', dbEvolutionCommand],
    ['decision-conflicts', decisionConflictsCommand],
    ['delivery-confidence', deliveryConfidenceCommand],
    ['dependency-upgrade', dependencyUpgradeCommand],
    ['design-system', designSystemCommand],
    ['diagram-studio', diagramStudioCommand],
    ['ea-review-packet', eaReviewPacketCommand],
    ['elicitation', elicitationCommand],
    ['estimation-studio', estimationStudioCommand],
    ['evidence-collector', evidenceCollectorCommand],
    ['governance-dashboard', governanceDashboardCommand],
    ['guided-handoff', guidedHandoffCommand],
    ['incident-feedback', incidentFeedbackCommand],
    ['ops-ownership', opsOwnershipCommand],
    ['playback-summaries', playbackSummariesCommand],
    ['policy', policyCommand],
    ['portfolio', portfolioCommand],
    ['raci-matrix', raciMatrixCommand],
    ['repo-graph', repoGraphCommand],
    ['requirements-baseline', requirementsBaselineCommand],
    ['revert', revertCommand],
    ['risk-register', riskRegisterCommand],
    ['role-approval', roleApprovalCommand],
    ['role-views', roleViewsCommand],
    ['root-cause', rootCauseCommand],
    ['runtime-debugger', runtimeDebuggerCommand],
    ['safe-rename', safeRenameCommand],
    ['scan', scanCommand],
    ['semantic-diff', semanticDiffCommand],
    ['sla-slo', slaSloCommand],
    ['spec-comments', specCommentsCommand],
    ['spec-maturity', specMaturityCommand],
    ['sre-integration', sreIntegrationCommand],
    ['telemetry-feedback', telemetryFeedbackCommand],
    ['test-generator', testGeneratorCommand],
    ['timestamp', timestampCommand],
    ['tool-guardrails', toolGuardrailsCommand],
    ['transcript-ingestion', transcriptIngestionCommand],
    ['vendor-risk', vendorRiskCommand],
    ['waiver-workflow', waiverWorkflowCommand],
    ['web-dashboard', webDashboardCommand],
    ['workshop-mode', workshopModeCommand],
    ['workstream-ownership', workstreamOwnershipCommand],
  ];
  for (const [expected, cmd] of cases) {
    it(`${expected}Command.meta.name === '${expected}'`, async () => {
      expect(await metaName(cmd)).toBe(expected);
    });
  }
});

describe('cleanup cluster — Impl missing-required-args smoke', () => {
  it('revertImpl returns exitCode=1 with no artifact', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = revertImpl(deps, {});
    expect(r.exitCode).toBe(1);
  });

  it('artifactComparisonImpl returns exitCode=1 for compare with missing args', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = artifactComparisonImpl(deps, { action: 'compare' });
    expect(r.exitCode).toBe(1);
  });

  it('timestampImpl returns exitCode=1 for validate with no value', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = timestampImpl(deps, { action: 'validate' });
    expect(r.exitCode).toBe(1);
  });

  it('timestampImpl returns exitCode=1 for audit with no file', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = timestampImpl(deps, { action: 'audit' });
    expect(r.exitCode).toBe(1);
  });
});

describe('cleanup cluster — main.subCommands wiring', () => {
  it('main.subCommands contains every cleanup command name', async () => {
    const subs =
      typeof main.subCommands === 'function' ? await main.subCommands() : await main.subCommands;
    expect(subs).toBeDefined();
    if (!subs) return;
    const expected = [
      'adr',
      'ai-evaluation',
      'artifact-comparison',
      'backlog-sync',
      'bcdr-planning',
      'branch-workflow',
      'cab-output',
      'chat-integration',
      'ci-cd-integration',
      'collaboration',
      'compliance-packs',
      'context-onboarding',
      'credential-boundary',
      'data-classification',
      'data-contracts',
      'db-evolution',
      'decision-conflicts',
      'delivery-confidence',
      'dependency-upgrade',
      'design-system',
      'diagram-studio',
      'ea-review-packet',
      'elicitation',
      'estimation-studio',
      'evidence-collector',
      'governance-dashboard',
      'guided-handoff',
      'incident-feedback',
      'ops-ownership',
      'playback-summaries',
      'policy',
      'portfolio',
      'raci-matrix',
      'repo-graph',
      'requirements-baseline',
      'revert',
      'risk-register',
      'role-approval',
      'role-views',
      'root-cause',
      'runtime-debugger',
      'safe-rename',
      'scan',
      'semantic-diff',
      'sla-slo',
      'spec-comments',
      'spec-maturity',
      'sre-integration',
      'telemetry-feedback',
      'test-generator',
      'timestamp',
      'tool-guardrails',
      'transcript-ingestion',
      'vendor-risk',
      'waiver-workflow',
      'web-dashboard',
      'workshop-mode',
      'workstream-ownership',
    ];
    for (const name of expected) {
      expect(name in subs).toBe(true);
    }
  });
});
