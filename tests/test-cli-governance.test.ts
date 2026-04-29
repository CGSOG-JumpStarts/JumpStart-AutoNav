/**
 * test-cli-governance.test.ts — T4.7.2 batch 7 (governance/risk cluster).
 *
 * Smoke + dispatcher coverage for the sixteen `src/cli/commands/governance.ts`
 * commands. Per the seed pattern in `test-cli-lifecycle.test.ts`, this file
 * only validates:
 *
 *   1. Each `<name>Command` has the expected `meta.name`.
 *   2. `<name>Impl(testDeps, {})` returns `exitCode: 1` (or 0 for default
 *      report actions) — smoke test only — full coverage lives in the
 *      individual lib-ts test files.
 *   3. `main.subCommands` exposes the new lazy thunks and they resolve.
 *
 * @see src/cli/commands/governance.ts
 * @see specs/implementation-plan.md T4.7.2
 */

import { describe, expect, it } from 'vitest';
import {
  adrCommand,
  aiEvaluationCommand,
  compliancePacksCommand,
  compliancePacksImpl,
  credentialBoundaryCommand,
  dataClassificationCommand,
  dataClassificationImpl,
  evidenceCollectorCommand,
  governanceDashboardCommand,
  incidentFeedbackCommand,
  incidentFeedbackImpl,
  opsOwnershipCommand,
  opsOwnershipImpl,
  policyCommand,
  policyImpl,
  raciMatrixCommand,
  raciMatrixImpl,
  riskRegisterCommand,
  riskRegisterImpl,
  roleApprovalCommand,
  roleApprovalImpl,
  vendorRiskCommand,
  waiverWorkflowCommand,
  waiverWorkflowImpl,
  workstreamOwnershipCommand,
  workstreamOwnershipImpl,
} from '../src/cli/commands/governance.js';
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

describe('governance cluster — defineCommand meta.name', () => {
  const cases: [string, { meta?: unknown }][] = [
    ['adr', adrCommand],
    ['policy', policyCommand],
    ['role-approval', roleApprovalCommand],
    ['raci-matrix', raciMatrixCommand],
    ['compliance-packs', compliancePacksCommand],
    ['evidence-collector', evidenceCollectorCommand],
    ['waiver-workflow', waiverWorkflowCommand],
    ['risk-register', riskRegisterCommand],
    ['data-classification', dataClassificationCommand],
    ['credential-boundary', credentialBoundaryCommand],
    ['vendor-risk', vendorRiskCommand],
    ['ops-ownership', opsOwnershipCommand],
    ['governance-dashboard', governanceDashboardCommand],
    ['incident-feedback', incidentFeedbackCommand],
    ['workstream-ownership', workstreamOwnershipCommand],
    ['ai-evaluation', aiEvaluationCommand],
  ];
  for (const [expected, cmd] of cases) {
    it(`${expected}Command.meta.name === '${expected}'`, async () => {
      expect(await metaName(cmd)).toBe(expected);
    });
  }
});

describe('governance cluster — Impl missing-required-args smoke', () => {
  it('policyImpl returns exitCode=1 for add without --name/--desc', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = policyImpl(deps, { action: 'add', rest: [] });
    expect(r.exitCode).toBe(1);
  });

  it('policyImpl returns exitCode=1 for unknown action', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = policyImpl(deps, { action: 'florp', rest: [] });
    expect(r.exitCode).toBe(1);
  });

  it('roleApprovalImpl returns exitCode=1 for assign without args', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = roleApprovalImpl(deps, { action: 'assign', rest: [] });
    expect(r.exitCode).toBe(1);
  });

  it('roleApprovalImpl returns exitCode=1 for approve without args', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = roleApprovalImpl(deps, { action: 'approve', rest: [] });
    expect(r.exitCode).toBe(1);
  });

  it('raciMatrixImpl returns exitCode=1 for define without args', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = raciMatrixImpl(deps, { action: 'define' });
    expect(r.exitCode).toBe(1);
  });

  it('raciMatrixImpl returns exitCode=1 for check without args', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = raciMatrixImpl(deps, { action: 'check' });
    expect(r.exitCode).toBe(1);
  });

  it('compliancePacksImpl returns exitCode=1 for apply without framework', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = compliancePacksImpl(deps, { action: 'apply' });
    expect(r.exitCode).toBe(1);
  });

  it('compliancePacksImpl returns exitCode=1 for unknown action', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = compliancePacksImpl(deps, { action: 'florp' });
    expect(r.exitCode).toBe(1);
  });

  it('waiverWorkflowImpl returns exitCode=1 for request without args', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = waiverWorkflowImpl(deps, { action: 'request' });
    expect(r.exitCode).toBe(1);
  });

  it('waiverWorkflowImpl returns exitCode=1 for approve without id', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = waiverWorkflowImpl(deps, { action: 'approve' });
    expect(r.exitCode).toBe(1);
  });

  it('riskRegisterImpl returns exitCode=1 for add without title', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = riskRegisterImpl(deps, { action: 'add' });
    expect(r.exitCode).toBe(1);
  });

  it('dataClassificationImpl returns exitCode=1 for classify without name', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = dataClassificationImpl(deps, { action: 'classify' });
    expect(r.exitCode).toBe(1);
  });

  it('opsOwnershipImpl returns exitCode=1 for define without args', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = opsOwnershipImpl(deps, { action: 'define' });
    expect(r.exitCode).toBe(1);
  });

  it('incidentFeedbackImpl returns exitCode=1 for log without title', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = incidentFeedbackImpl(deps, { action: 'log' });
    expect(r.exitCode).toBe(1);
  });

  it('workstreamOwnershipImpl returns exitCode=1 for define without name', () => {
    const deps = createTestDeps({ projectRoot: process.cwd() });
    const r = workstreamOwnershipImpl(deps, { action: 'define' });
    expect(r.exitCode).toBe(1);
  });
});

describe('governance cluster — main.subCommands wiring', () => {
  it('main.subCommands contains every governance command name', async () => {
    const subs =
      typeof main.subCommands === 'function' ? await main.subCommands() : await main.subCommands;
    expect(subs).toBeDefined();
    if (!subs) return;
    const expected = [
      'adr',
      'policy',
      'role-approval',
      'raci-matrix',
      'compliance-packs',
      'evidence-collector',
      'waiver-workflow',
      'risk-register',
      'data-classification',
      'credential-boundary',
      'vendor-risk',
      'ops-ownership',
      'governance-dashboard',
      'incident-feedback',
      'workstream-ownership',
      'ai-evaluation',
    ];
    for (const name of expected) {
      expect(name in subs).toBe(true);
    }
  });
});
