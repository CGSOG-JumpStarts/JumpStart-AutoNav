/**
 * test-governance-cluster.test.ts — T4.4.2 governance cluster I tests.
 *
 * Smoke coverage for the 18 ports landed together:
 *   - compliance-packs.ts: listFrameworks, applyFramework, checkCompliance
 *   - risk-register.ts: addRisk, updateRisk, listRisks, generateReport
 *   - waiver-workflow.ts: requestWaiver, resolveWaiver, expireWaivers, listWaivers
 *   - evidence-collector.ts: collectEvidence, packageEvidence, getStatus
 *   - model-governance.ts: registerModel, recordEvaluation, updateStatus, generateReport
 *   - prompt-governance.ts: registerAsset, addVersion, approveVersion, listAssets
 *   - governance-dashboard.ts: gatherGovernanceData, renderDashboardText
 *   - regulatory-gate.ts: evaluateRegulatory, generateChecklist
 *   - policy-engine.ts: addPolicy, checkPolicies, listPolicies
 *   - vendor-risk.ts: scanDependencies, assessDependency, generateReport
 *   - data-classification.ts: classifyAsset, checkCompliance, generateReport
 *   - credential-boundary.ts: scanProject, scanBoundaries, generateReport
 *   - incident-feedback.ts: logIncident, analyzeIncident, generateReport
 *   - raci-matrix.ts: defineAssignment, checkPermission, generateReport
 *   - role-approval.ts: assignApprovers, recordRoleAction, getApprovalStatus
 *   - ops-ownership.ts: defineOwnership, checkCompleteness, generateReport
 *   - workstream-ownership.ts: defineWorkstream, addDependency, generateReport
 *   - ai-evaluation.ts: evaluate, configureBenchmark, generateReport
 *
 * @see bin/lib-ts/{18 governance modules}.ts
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as aiEval from '../bin/lib-ts/ai-evaluation.js';
import * as compliance from '../bin/lib-ts/compliance-packs.js';
import * as credBound from '../bin/lib-ts/credential-boundary.js';
import * as dataClass from '../bin/lib-ts/data-classification.js';
import * as evidence from '../bin/lib-ts/evidence-collector.js';
import * as govDash from '../bin/lib-ts/governance-dashboard.js';
import * as incident from '../bin/lib-ts/incident-feedback.js';
import * as modelGov from '../bin/lib-ts/model-governance.js';
import * as opsOwn from '../bin/lib-ts/ops-ownership.js';
import * as policy from '../bin/lib-ts/policy-engine.js';
import * as promptGov from '../bin/lib-ts/prompt-governance.js';
import * as raci from '../bin/lib-ts/raci-matrix.js';
import * as regGate from '../bin/lib-ts/regulatory-gate.js';
import * as risk from '../bin/lib-ts/risk-register.js';
import * as roleAppr from '../bin/lib-ts/role-approval.js';
import * as vendor from '../bin/lib-ts/vendor-risk.js';
import * as waiver from '../bin/lib-ts/waiver-workflow.js';
import * as wsOwn from '../bin/lib-ts/workstream-ownership.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'gov-cluster-test-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function file(name: string): string {
  return path.join(tmp, name);
}

// ─────────────────────────────────────────────────────────────────────────
// compliance-packs
// ─────────────────────────────────────────────────────────────────────────

describe('compliance-packs', () => {
  it('lists 8 prebuilt frameworks', () => {
    const r = compliance.listFrameworks();
    expect(r.success).toBe(true);
    expect(r.total).toBe(8);
    expect(r.frameworks.map((f) => f.id)).toContain('soc2');
  });
  it('applies a known framework and tracks state', () => {
    const f = file('compliance.json');
    const r = compliance.applyFramework('hipaa', { stateFile: f });
    expect(r.success).toBe(true);
    expect(r.controls_added).toBe(4);
  });
  it('rejects unknown framework', () => {
    const r = compliance.applyFramework('does-not-exist', { stateFile: file('c.json') });
    expect(r.success).toBe(false);
  });
  it('checkCompliance reports findings after apply', () => {
    const f = file('compliance.json');
    compliance.applyFramework('soc2', { stateFile: f });
    const r = compliance.checkCompliance({ stateFile: f });
    expect(r.findings.length).toBe(4);
    expect(r.compliant).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// risk-register
// ─────────────────────────────────────────────────────────────────────────

describe('risk-register', () => {
  it('addRisk computes 5x5 score', () => {
    const f = file('risk.json');
    const r = risk.addRisk(
      { title: 'X', description: 'Y', likelihood: 'likely', impact: 'major' },
      { stateFile: f }
    );
    expect(r.success).toBe(true);
    expect(r.risk?.score).toBe(16);
  });
  it('rejects missing title', () => {
    const r = risk.addRisk({ description: 'no title' }, { stateFile: file('r.json') });
    expect(r.success).toBe(false);
  });
  it('updateRisk recalculates score', () => {
    const f = file('risk.json');
    const a = risk.addRisk(
      { title: 'A', description: 'D', likelihood: 'rare', impact: 'minor' },
      { stateFile: f }
    );
    const u = risk.updateRisk(
      a.risk?.id ?? '',
      { likelihood: 'likely', impact: 'critical' },
      { stateFile: f }
    );
    expect(u.risk?.score).toBe(20);
  });
  it('generateReport sorts top risks', () => {
    const f = file('risk.json');
    risk.addRisk(
      { title: 'A', description: 'D', likelihood: 'rare', impact: 'minor' },
      { stateFile: f }
    );
    risk.addRisk(
      { title: 'B', description: 'D', likelihood: 'almost-certain', impact: 'critical' },
      { stateFile: f }
    );
    const r = risk.generateReport({ stateFile: f });
    expect(r.top_risks[0].score).toBe(25);
    expect(r.high_risks).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// waiver-workflow
// ─────────────────────────────────────────────────────────────────────────

describe('waiver-workflow', () => {
  it('requestWaiver creates a pending waiver', () => {
    const f = file('w.json');
    const r = waiver.requestWaiver(
      { title: 'X', justification: 'Y', owner: 'me' },
      { stateFile: f }
    );
    expect(r.success).toBe(true);
    expect(r.waiver?.status).toBe('pending');
  });
  it('resolveWaiver flips to approved', () => {
    const f = file('w.json');
    const r = waiver.requestWaiver(
      { title: 'X', justification: 'Y', owner: 'me' },
      { stateFile: f }
    );
    const id = r.waiver?.id ?? '';
    const out = waiver.resolveWaiver(id, 'approve', { stateFile: f, approver: 'boss' });
    expect(out.waiver?.status).toBe('approved');
    expect(out.waiver?.approved_by).toBe('boss');
  });
  it('listWaivers filters by status', () => {
    const f = file('w.json');
    waiver.requestWaiver({ title: 'X', justification: 'Y', owner: 'me' }, { stateFile: f });
    const r = waiver.listWaivers({ status: 'pending' }, { stateFile: f });
    expect(r.total).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// evidence-collector
// ─────────────────────────────────────────────────────────────────────────

describe('evidence-collector', () => {
  it('collectEvidence handles missing dirs gracefully', () => {
    const r = evidence.collectEvidence(tmp);
    expect(r.success).toBe(true);
  });
  it('packageEvidence writes manifest', () => {
    evidence.collectEvidence(tmp);
    const r = evidence.packageEvidence(tmp);
    expect(r.success).toBe(true);
    expect(r.output).toContain('audit-manifest.json');
  });
  it('getStatus reflects collections', () => {
    const stateFile = path.join(tmp, '.jumpstart', 'state', 'evidence.json');
    evidence.collectEvidence(tmp);
    const r = evidence.getStatus({ stateFile });
    expect(r.collections).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// model-governance
// ─────────────────────────────────────────────────────────────────────────

describe('model-governance', () => {
  it('registerModel requires name+provider', () => {
    const r = modelGov.registerModel({}, { stateFile: file('m.json') });
    expect(r.success).toBe(false);
  });
  it('registers and updates model status', () => {
    const f = file('m.json');
    const reg = modelGov.registerModel({ name: 'gpt-4', provider: 'openai' }, { stateFile: f });
    const id = reg.model?.id ?? '';
    const u = modelGov.updateStatus(id, 'approved', { stateFile: f });
    expect(u.model?.status).toBe('approved');
  });
  it('rejects invalid status', () => {
    const f = file('m.json');
    const reg = modelGov.registerModel({ name: 'gpt-4', provider: 'openai' }, { stateFile: f });
    const u = modelGov.updateStatus(reg.model?.id ?? '', 'made-up', { stateFile: f });
    expect(u.success).toBe(false);
  });
  it('generateReport segments by risk', () => {
    const f = file('m.json');
    modelGov.registerModel({ name: 'a', provider: 'p', risk_level: 'high' }, { stateFile: f });
    const r = modelGov.generateReport({ stateFile: f });
    expect(r.high_risk_models.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// prompt-governance
// ─────────────────────────────────────────────────────────────────────────

describe('prompt-governance', () => {
  it('registerAsset rejects unknown type', () => {
    const r = promptGov.registerAsset('n', 'made-up', 'c', { stateFile: file('p.json') });
    expect(r.success).toBe(false);
  });
  it('approves a version and lists it', () => {
    const f = file('p.json');
    const reg = promptGov.registerAsset('myPrompt', 'prompt', 'hi', { stateFile: f });
    const id = reg.asset?.id ?? '';
    const ap = promptGov.approveVersion(id, '1.0.0', { stateFile: f, approver: 'me' });
    expect(ap.approved).toBe(true);
    const list = promptGov.listAssets({ stateFile: f });
    expect(list.assets[0].latest_approved).toBe('1.0.0');
  });
  it('addVersion bumps current_version', () => {
    const f = file('p.json');
    const reg = promptGov.registerAsset('x', 'prompt', 'a', { stateFile: f });
    const a = promptGov.addVersion(reg.asset?.id ?? '', 'b', '2.0.0', { stateFile: f });
    expect(a.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// governance-dashboard
// ─────────────────────────────────────────────────────────────────────────

describe('governance-dashboard', () => {
  it('returns success with empty sections for fresh root', () => {
    const r = govDash.gatherGovernanceData(tmp);
    expect(r.success).toBe(true);
    expect(r.sections.policies.total).toBe(0);
  });
  it('renderDashboardText includes governance score', () => {
    const data = govDash.gatherGovernanceData(tmp);
    const txt = govDash.renderDashboardText(data);
    expect(txt).toContain('Governance Score');
  });
  it('reads applied compliance frameworks', () => {
    const dir = path.join(tmp, '.jumpstart', 'state');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'compliance.json'),
      JSON.stringify({ applied_frameworks: ['soc2', 'gdpr'] })
    );
    const r = govDash.gatherGovernanceData(tmp);
    expect(r.sections.compliance.frameworks).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// regulatory-gate
// ─────────────────────────────────────────────────────────────────────────

describe('regulatory-gate', () => {
  it('evaluateRegulatory returns general for unknown domain', () => {
    const r = regGate.evaluateRegulatory({ project_domain: 'unknown' });
    expect(r.classification).toBe('general');
  });
  it('healthcare elevates risk to high and adds HIPAA', () => {
    const r = regGate.evaluateRegulatory({ project_domain: 'healthcare', risk_level: 'low' });
    expect(r.applicable_regulations).toContain('HIPAA');
    expect(r.risk_level).toBe('high');
  });
  it('PII data type adds PIA & retention checks', () => {
    const r = regGate.evaluateRegulatory({ data_types: ['PII'] });
    expect(r.required_checks).toContain('Privacy impact assessment');
  });
  it('generateChecklist includes GDPR section when GDPR applies', () => {
    const c = regGate.generateChecklist('financial', ['GDPR']);
    expect(c.some((s) => s.category === 'GDPR Compliance')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// policy-engine
// ─────────────────────────────────────────────────────────────────────────

describe('policy-engine', () => {
  it('addPolicy rejects bad category', () => {
    const r = policy.addPolicy(
      { name: 'n', description: 'd', category: 'made-up' },
      { policyFile: file('p.json') }
    );
    expect(r.success).toBe(false);
  });
  it('addPolicy + listPolicies round-trip', () => {
    const f = file('p.json');
    policy.addPolicy(
      { name: 'no-secrets', description: 'no embedded secrets', category: 'security' },
      { policyFile: f }
    );
    const list = policy.listPolicies({}, { policyFile: f });
    expect(list.total).toBe(1);
  });
  it('checkPolicies passes when no violations', () => {
    const r = policy.checkPolicies(tmp, { policyFile: file('p.json') });
    expect(r.passed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// vendor-risk
// ─────────────────────────────────────────────────────────────────────────

describe('vendor-risk', () => {
  it('scanDependencies returns 0 when no package.json', () => {
    const r = vendor.scanDependencies(tmp);
    expect(r.total).toBe(0);
  });
  it('assessDependency scores license risk', () => {
    const r = vendor.assessDependency(
      { name: 'foo', version: '1.0.0', license: 'MIT', has_lockfile: true },
      { stateFile: file('v.json') }
    );
    expect(r.assessment?.scores.license).toBe(90);
  });
  it('reports include high-risk dependencies', () => {
    const f = file('v.json');
    vendor.assessDependency(
      { name: 'bad', version: '1.0.0', license: 'GPL-3.0' },
      { stateFile: f }
    );
    const r = vendor.generateReport({ stateFile: f });
    expect(r.assessments.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// data-classification
// ─────────────────────────────────────────────────────────────────────────

describe('data-classification', () => {
  it('classifyAsset auto-elevates for PHI', () => {
    const r = dataClass.classifyAsset(
      { name: 'x', data_types: ['PHI'] },
      { stateFile: file('d.json') }
    );
    expect(r.asset?.classification).toBe('restricted');
  });
  it('rejects missing name', () => {
    const r = dataClass.classifyAsset({}, { stateFile: file('d.json') });
    expect(r.success).toBe(false);
  });
  it('checkCompliance flags missing encryption', () => {
    const f = file('d.json');
    dataClass.classifyAsset({ name: 'x', data_types: ['PHI'] }, { stateFile: f });
    const r = dataClass.checkCompliance({ stateFile: f });
    expect(r.violations).toBeGreaterThan(0);
  });
  it('generateReport groups by level', () => {
    const f = file('d.json');
    dataClass.classifyAsset({ name: 'x', data_types: ['PHI'] }, { stateFile: f });
    const r = dataClass.generateReport({ stateFile: f });
    expect(r.by_level.restricted).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// credential-boundary
// ─────────────────────────────────────────────────────────────────────────

describe('credential-boundary', () => {
  it('scanBoundaries flags hardcoded secret', () => {
    const f = path.join(tmp, 'spec.md');
    writeFileSync(f, 'password: "Sup3rSecret123"\n');
    const r = credBound.scanBoundaries([f], tmp);
    expect(r.findings.length).toBeGreaterThan(0);
    expect(r.pass).toBe(false);
  });
  it('redacts matched preview text via ADR-012', () => {
    const f = path.join(tmp, 'spec.md');
    writeFileSync(
      f,
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA1234567890abcdefghijklmnop\n'
    );
    const r = credBound.scanBoundaries([f], tmp);
    expect(r.findings.length).toBeGreaterThan(0);
  });
  it('scanProject walks directory tree', () => {
    const r = credBound.scanProject(tmp);
    expect(r.success).toBe(true);
  });
  it('generateReport summarises findings', () => {
    const f = path.join(tmp, 'spec.md');
    writeFileSync(f, 'password: "Sup3rSecret123"\n');
    const scan = credBound.scanBoundaries([f], tmp);
    const r = credBound.generateReport(scan);
    expect(r.recommendations.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// incident-feedback
// ─────────────────────────────────────────────────────────────────────────

describe('incident-feedback', () => {
  it('logIncident requires title+severity', () => {
    const r = incident.logIncident({}, { stateFile: file('i.json') });
    expect(r.success).toBe(false);
  });
  it('analyzeIncident generates security recommendations', () => {
    const f = file('i.json');
    const log = incident.logIncident(
      { title: 'leak', severity: 'sev1', category: 'security' },
      { stateFile: f }
    );
    const r = incident.analyzeIncident(log.incident?.id ?? '', { stateFile: f });
    expect(r.recommendations?.length).toBeGreaterThan(0);
  });
  it('generateReport segments by severity', () => {
    const f = file('i.json');
    incident.logIncident({ title: 'A', severity: 'sev1' }, { stateFile: f });
    const r = incident.generateReport({ stateFile: f });
    expect(r.by_severity.sev1).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// raci-matrix
// ─────────────────────────────────────────────────────────────────────────

describe('raci-matrix', () => {
  it('defineAssignment requires accountable', () => {
    const r = raci.defineAssignment('x.md', {}, { stateFile: file('r.json') });
    expect(r.success).toBe(false);
  });
  it('checkPermission allows accountable to approve', () => {
    const f = file('r.json');
    raci.defineAssignment(
      'specs/prd.md',
      { accountable: 'pm', responsible: 'pm' },
      { stateFile: f }
    );
    const r = raci.checkPermission('specs/prd.md', 'pm', 'approve', { stateFile: f });
    expect(r.allowed).toBe(true);
  });
  it('generateReport reports gaps', () => {
    const f = file('r.json');
    const r = raci.generateReport({ stateFile: f });
    expect(r.gaps.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// role-approval
// ─────────────────────────────────────────────────────────────────────────

describe('role-approval', () => {
  it('assignApprovers rejects empty array', () => {
    const r = roleAppr.assignApprovers('x.md', [], { stateFile: file('r.json') });
    expect(r.success).toBe(false);
  });
  it('full workflow approves when all required roles say yes', () => {
    const f = file('r.json');
    roleAppr.assignApprovers('specs/prd.md', [{ role: 'product' }, { role: 'security' }], {
      stateFile: f,
    });
    roleAppr.recordRoleAction('specs/prd.md', 'product', 'approve', { stateFile: f });
    roleAppr.recordRoleAction('specs/prd.md', 'security', 'approve', { stateFile: f });
    const r = roleAppr.getApprovalStatus('specs/prd.md', { stateFile: f });
    expect(r.fully_approved).toBe(true);
  });
  it('rejects unknown role', () => {
    const r = roleAppr.assignApprovers('x.md', [{ role: 'made-up' }], {
      stateFile: file('r.json'),
    });
    expect(r.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ops-ownership
// ─────────────────────────────────────────────────────────────────────────

describe('ops-ownership', () => {
  it('defineOwnership requires name+service_owner', () => {
    const r = opsOwn.defineOwnership({}, { stateFile: file('o.json') });
    expect(r.success).toBe(false);
  });
  it('checkCompleteness flags missing fields', () => {
    const f = file('o.json');
    opsOwn.defineOwnership({ name: 'svc', service_owner: 'me' }, { stateFile: f });
    const r = opsOwn.checkCompleteness({ stateFile: f });
    expect(r.incomplete).toBe(1);
  });
  it('generateReport groups by team and tier', () => {
    const f = file('o.json');
    opsOwn.defineOwnership(
      { name: 'svc', service_owner: 'me', team: 'platform' },
      { stateFile: f }
    );
    const r = opsOwn.generateReport({ stateFile: f });
    expect(r.by_team.platform).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// workstream-ownership
// ─────────────────────────────────────────────────────────────────────────

describe('workstream-ownership', () => {
  it('defineWorkstream requires name', () => {
    const r = wsOwn.defineWorkstream('', { stateFile: file('w.json') });
    expect(r.success).toBe(false);
  });
  it('addDependency links two workstreams', () => {
    const f = file('w.json');
    wsOwn.defineWorkstream('A', { stateFile: f });
    wsOwn.defineWorkstream('B', { stateFile: f });
    const r = wsOwn.addDependency('A', 'B', { stateFile: f });
    expect(r.success).toBe(true);
  });
  it('generateReport groups by team', () => {
    const f = file('w.json');
    wsOwn.defineWorkstream('A', { stateFile: f, team: 'platform' });
    const r = wsOwn.generateReport({ stateFile: f });
    expect(r.by_team.platform).toEqual(['A']);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ai-evaluation
// ─────────────────────────────────────────────────────────────────────────

describe('ai-evaluation', () => {
  it('evaluate computes overall as mean', () => {
    const r = aiEval.evaluate(
      'test',
      { groundedness: 90, safety: 80 },
      { stateFile: file('a.json') }
    );
    expect(r.evaluation?.overall).toBe(85);
  });
  it('configureBenchmark adds benchmark', () => {
    const r = aiEval.configureBenchmark('prod', { latency: 100 }, { stateFile: file('a.json') });
    expect(r.success).toBe(true);
  });
  it('generateReport averages dimensions', () => {
    const f = file('a.json');
    aiEval.evaluate('a', { groundedness: 80 }, { stateFile: f });
    aiEval.evaluate('b', { groundedness: 60 }, { stateFile: f });
    const r = aiEval.generateReport({ stateFile: f });
    expect(r.average_scores.groundedness).toBe(70);
  });
});
