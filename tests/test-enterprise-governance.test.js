/**
 * test-enterprise-governance.test.js — Tests for Enterprise SDLC & Governance (Items 21-40)
 *
 * Tests for all governance modules covering:
 * - CI/CD Integration (21)
 * - Environment Promotion (22)
 * - RACI Matrix (23)
 * - Compliance Packs (24)
 * - Evidence Collector (25)
 * - Release Readiness (26)
 * - Waiver Workflow (27)
 * - SLA/SLO (28)
 * - Risk Register (29)
 * - Data Classification (30)
 * - Credential Boundary (31)
 * - EA Review Packet (32)
 * - Model Governance (33)
 * - AI Intake (34)
 * - FinOps Planner (35)
 * - Vendor Risk (36)
 * - CAB Output (37)
 * - BCDR Planning (38)
 * - Ops Ownership (39)
 * - Governance Dashboard (40)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempDir() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-gov-'));
  fs.mkdirSync(path.join(tmpDir, '.jumpstart', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'specs', 'decisions'), { recursive: true });
  return tmpDir;
}

function cleanupTempDir(tmpDir) {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ─── Item 21: CI/CD Integration ──────────────────────────────────────────────

describe('CI/CD Integration (Item 21)', () => {
  const lib = require('../bin/lib/ci-cd-integration');

  it('generates GitHub Actions pipeline', () => {
    const result = lib.generatePipeline('github-actions');
    expect(result.success).toBe(true);
    expect(result.platform).toBe('github-actions');
    expect(result.content).toBeDefined();
    expect(result.content.jobs).toBeDefined();
  });

  it('generates Azure DevOps pipeline', () => {
    const result = lib.generatePipeline('azure-devops');
    expect(result.success).toBe(true);
    expect(result.platform).toBe('azure-devops');
    expect(result.content.stages).toBeDefined();
  });

  it('rejects unsupported platforms', () => {
    const result = lib.generatePipeline('jenkins');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported');
  });

  it('validates pipeline configuration', () => {
    const tmpDir = createTempDir();
    try {
      const result = lib.validatePipeline(tmpDir);
      expect(result.success).toBe(true);
      expect(result.pipelines).toBeDefined();
    } finally { cleanupTempDir(tmpDir); }
  });

  it('exports BUILT_IN_CHECKS', () => {
    expect(lib.BUILT_IN_CHECKS.length).toBeGreaterThan(0);
    expect(lib.BUILT_IN_CHECKS[0]).toHaveProperty('id');
    expect(lib.BUILT_IN_CHECKS[0]).toHaveProperty('command');
  });
});

// ─── Item 22: Environment Promotion ──────────────────────────────────────────

describe('Environment Promotion (Item 22)', () => {
  const lib = require('../bin/lib/environment-promotion');
  let tmpDir, stateFile;

  beforeEach(() => {
    tmpDir = createTempDir();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'environment-promotion.json');
  });
  afterEach(() => cleanupTempDir(tmpDir));

  it('checks gates for an environment', () => {
    const result = lib.checkGates('dev', { stateFile });
    expect(result.success).toBe(true);
    expect(result.environment).toBe('dev');
    expect(result.pending).toBeDefined();
  });

  it('records gate results', () => {
    const result = lib.recordGateResult('dev', 'unit-tests', true, { stateFile });
    expect(result.success).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('rejects invalid environments', () => {
    const result = lib.checkGates('invalid', { stateFile });
    expect(result.success).toBe(false);
  });

  it('returns promotion status', () => {
    const result = lib.getStatus({ stateFile });
    expect(result.success).toBe(true);
    expect(result.current_environment).toBe('dev');
  });
});

// ─── Item 23: RACI Matrix ────────────────────────────────────────────────────

describe('RACI Matrix (Item 23)', () => {
  const lib = require('../bin/lib/raci-matrix');
  let tmpDir, stateFile;

  beforeEach(() => {
    tmpDir = createTempDir();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'raci-matrix.json');
  });
  afterEach(() => cleanupTempDir(tmpDir));

  it('defines RACI assignment', () => {
    const result = lib.defineAssignment('specs/prd.md', { accountable: 'PM', responsible: 'Analyst' }, { stateFile });
    expect(result.success).toBe(true);
    expect(result.assignment.accountable).toBe('PM');
  });

  it('checks permission for approvals', () => {
    lib.defineAssignment('specs/prd.md', { accountable: 'PM' }, { stateFile });
    const allowed = lib.checkPermission('specs/prd.md', 'PM', 'approve', { stateFile });
    expect(allowed.allowed).toBe(true);
    const denied = lib.checkPermission('specs/prd.md', 'Dev', 'approve', { stateFile });
    expect(denied.allowed).toBe(false);
  });

  it('generates RACI report', () => {
    lib.defineAssignment('specs/prd.md', { accountable: 'PM' }, { stateFile });
    const result = lib.generateReport({ stateFile });
    expect(result.success).toBe(true);
    expect(result.total_assignments).toBe(1);
  });
});

// ─── Item 24: Compliance Packs ───────────────────────────────────────────────

describe('Compliance Packs (Item 24)', () => {
  const lib = require('../bin/lib/compliance-packs');
  let tmpDir, stateFile;

  beforeEach(() => {
    tmpDir = createTempDir();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'compliance.json');
  });
  afterEach(() => cleanupTempDir(tmpDir));

  it('lists all frameworks', () => {
    const result = lib.listFrameworks();
    expect(result.success).toBe(true);
    expect(result.total).toBe(8);
    expect(result.frameworks.map(f => f.id)).toContain('soc2');
    expect(result.frameworks.map(f => f.id)).toContain('gdpr');
  });

  it('applies a compliance framework', () => {
    const result = lib.applyFramework('soc2', { stateFile });
    expect(result.success).toBe(true);
    expect(result.framework).toBe('soc2');
    expect(result.controls_added).toBeGreaterThan(0);
  });

  it('rejects unknown frameworks', () => {
    const result = lib.applyFramework('unknown', { stateFile });
    expect(result.success).toBe(false);
  });

  it('checks compliance', () => {
    lib.applyFramework('hipaa', { stateFile });
    const result = lib.checkCompliance({ stateFile });
    expect(result.success).toBe(true);
    expect(result.total_controls).toBeGreaterThan(0);
  });
});

// ─── Item 25: Evidence Collector ─────────────────────────────────────────────

describe('Evidence Collector (Item 25)', () => {
  const lib = require('../bin/lib/evidence-collector');
  let tmpDir;

  beforeEach(() => { tmpDir = createTempDir(); });
  afterEach(() => cleanupTempDir(tmpDir));

  it('collects evidence from project', () => {
    fs.writeFileSync(path.join(tmpDir, 'specs', 'architecture.md'), '# Arch\n', 'utf8');
    const result = lib.collectEvidence(tmpDir);
    expect(result.success).toBe(true);
    expect(result.items_collected).toBeGreaterThan(0);
  });

  it('packages evidence', () => {
    lib.collectEvidence(tmpDir);
    const result = lib.packageEvidence(tmpDir);
    expect(result.success).toBe(true);
    expect(result.package_id).toBeDefined();
  });
});

// ─── Item 26: Release Readiness ──────────────────────────────────────────────

describe('Release Readiness (Item 26)', () => {
  const lib = require('../bin/lib/release-readiness');
  let tmpDir;

  beforeEach(() => { tmpDir = createTempDir(); });
  afterEach(() => cleanupTempDir(tmpDir));

  it('assesses release readiness', () => {
    const result = lib.assessReadiness(tmpDir);
    expect(result.success).toBe(true);
    expect(result.total_score).toBeDefined();
    expect(result.recommendation).toBeDefined();
  });

  it('generates readiness report after assessment', () => {
    lib.assessReadiness(tmpDir);
    const stateFile = path.join(tmpDir, '.jumpstart', 'state', 'release-readiness.json');
    const result = lib.generateReport({ stateFile });
    expect(result.success).toBe(true);
    expect(result.categories.length).toBeGreaterThan(0);
  });
});

// ─── Item 27: Waiver Workflow ────────────────────────────────────────────────

describe('Waiver Workflow (Item 27)', () => {
  const lib = require('../bin/lib/waiver-workflow');
  let tmpDir, stateFile;

  beforeEach(() => {
    tmpDir = createTempDir();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'waivers.json');
  });
  afterEach(() => cleanupTempDir(tmpDir));

  it('requests a waiver', () => {
    const result = lib.requestWaiver({
      title: 'Skip E2E tests',
      justification: 'No E2E environment available',
      owner: 'team-lead'
    }, { stateFile });
    expect(result.success).toBe(true);
    expect(result.waiver.status).toBe('pending');
  });

  it('approves a waiver', () => {
    const created = lib.requestWaiver({ title: 'Test', justification: 'Because', owner: 'owner' }, { stateFile });
    const result = lib.resolveWaiver(created.waiver.id, 'approve', { stateFile });
    expect(result.success).toBe(true);
    expect(result.waiver.status).toBe('approved');
  });

  it('lists waivers with filter', () => {
    lib.requestWaiver({ title: 'W1', justification: 'J', owner: 'O' }, { stateFile });
    lib.requestWaiver({ title: 'W2', justification: 'J', owner: 'O' }, { stateFile });
    const result = lib.listWaivers({}, { stateFile });
    expect(result.total).toBe(2);
  });
});

// ─── Item 28: SLA/SLO ───────────────────────────────────────────────────────

describe('SLA/SLO (Item 28)', () => {
  const lib = require('../bin/lib/sla-slo');
  let tmpDir, stateFile;

  beforeEach(() => {
    tmpDir = createTempDir();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'sla-slo.json');
  });
  afterEach(() => cleanupTempDir(tmpDir));

  it('defines an SLO', () => {
    const result = lib.defineSLO({ name: 'API Availability', service: 'api', target: 99.9 }, { stateFile });
    expect(result.success).toBe(true);
    expect(result.slo.target).toBe(99.9);
  });

  it('applies a template', () => {
    const result = lib.applyTemplate('my-api', 'web-api', { stateFile });
    expect(result.success).toBe(true);
    expect(result.slos_created).toBe(3);
  });

  it('rejects invalid template', () => {
    const result = lib.applyTemplate('svc', 'unknown-type', { stateFile });
    expect(result.success).toBe(false);
  });
});

// ─── Item 29: Risk Register ─────────────────────────────────────────────────

describe('Risk Register (Item 29)', () => {
  const lib = require('../bin/lib/risk-register');
  let tmpDir, stateFile;

  beforeEach(() => {
    tmpDir = createTempDir();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'risk-register.json');
  });
  afterEach(() => cleanupTempDir(tmpDir));

  it('adds a risk with score', () => {
    const result = lib.addRisk({
      title: 'Data breach',
      description: 'Potential data exposure',
      likelihood: 'likely',
      impact: 'critical'
    }, { stateFile });
    expect(result.success).toBe(true);
    expect(result.risk.score).toBe(20);
  });

  it('updates risk status', () => {
    const created = lib.addRisk({ title: 'R1', description: 'D1' }, { stateFile });
    const result = lib.updateRisk(created.risk.id, { status: 'mitigating' }, { stateFile });
    expect(result.success).toBe(true);
    expect(result.risk.status).toBe('mitigating');
  });

  it('generates risk report', () => {
    lib.addRisk({ title: 'R1', description: 'D1', likelihood: 'possible', impact: 'major' }, { stateFile });
    const result = lib.generateReport({ stateFile });
    expect(result.success).toBe(true);
    expect(result.total_risks).toBe(1);
  });
});

// ─── Item 30: Data Classification ───────────────────────────────────────────

describe('Data Classification (Item 30)', () => {
  const lib = require('../bin/lib/data-classification');
  let tmpDir, stateFile;

  beforeEach(() => {
    tmpDir = createTempDir();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'data-classification.json');
  });
  afterEach(() => cleanupTempDir(tmpDir));

  it('classifies asset with auto-detection', () => {
    const result = lib.classifyAsset({ name: 'user-service', data_types: ['PII'] }, { stateFile });
    expect(result.success).toBe(true);
    expect(result.asset.classification).toBe('confidential');
  });

  it('classifies PHI as restricted', () => {
    const result = lib.classifyAsset({ name: 'health-records', data_types: ['PHI'] }, { stateFile });
    expect(result.asset.classification).toBe('restricted');
  });

  it('generates classification report', () => {
    lib.classifyAsset({ name: 'public-api', data_types: ['public-content'] }, { stateFile });
    const result = lib.generateReport({ stateFile });
    expect(result.total_assets).toBe(1);
  });
});

// ─── Item 31: Credential Boundary ───────────────────────────────────────────

describe('Credential Boundary (Item 31)', () => {
  const lib = require('../bin/lib/credential-boundary');
  let tmpDir;

  beforeEach(() => { tmpDir = createTempDir(); });
  afterEach(() => cleanupTempDir(tmpDir));

  it('detects hardcoded secrets', () => {
    const testFile = path.join(tmpDir, 'test.md');
    fs.writeFileSync(testFile, 'password = "SuperSecretValue123!"\n', 'utf8');
    const result = lib.scanBoundaries([testFile], tmpDir);
    expect(result.total_findings).toBeGreaterThan(0);
    expect(result.pass).toBe(false);
  });

  it('passes clean files', () => {
    const testFile = path.join(tmpDir, 'clean.md');
    fs.writeFileSync(testFile, '# Architecture\n\nThis is a clean file.\n', 'utf8');
    const result = lib.scanBoundaries([testFile], tmpDir);
    expect(result.total_findings).toBe(0);
    expect(result.pass).toBe(true);
  });
});

// ─── Item 32: EA Review Packet ──────────────────────────────────────────────

describe('EA Review Packet (Item 32)', () => {
  const lib = require('../bin/lib/ea-review-packet');
  let tmpDir;

  beforeEach(() => { tmpDir = createTempDir(); });
  afterEach(() => cleanupTempDir(tmpDir));

  it('generates packet with present sections', () => {
    fs.writeFileSync(path.join(tmpDir, 'specs', 'architecture.md'), '# Architecture\n\n```mermaid\ngraph TD\n```\n', 'utf8');
    const result = lib.generatePacket(tmpDir);
    expect(result.success).toBe(true);
    expect(result.sections['architecture-overview'].present).toBe(true);
    expect(result.sections.diagrams.present).toBe(true);
  });

  it('reports gaps', () => {
    const result = lib.generatePacket(tmpDir);
    expect(result.gaps.length).toBeGreaterThan(0);
  });
});

// ─── Item 33: Model Governance ──────────────────────────────────────────────

describe('Model Governance (Item 33)', () => {
  const lib = require('../bin/lib/model-governance');
  let tmpDir, stateFile;

  beforeEach(() => {
    tmpDir = createTempDir();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'model-governance.json');
  });
  afterEach(() => cleanupTempDir(tmpDir));

  it('registers a model', () => {
    const result = lib.registerModel({ name: 'gpt-4o', provider: 'OpenAI', use_case: 'code-review' }, { stateFile });
    expect(result.success).toBe(true);
    expect(result.model.status).toBe('proposed');
  });

  it('records evaluation', () => {
    const model = lib.registerModel({ name: 'claude-3', provider: 'Anthropic' }, { stateFile });
    const result = lib.recordEvaluation(model.model.id, { metrics: { accuracy: 0.95 } }, { stateFile });
    expect(result.success).toBe(true);
  });
});

// ─── Item 34: AI Intake ─────────────────────────────────────────────────────

describe('AI Intake (Item 34)', () => {
  const lib = require('../bin/lib/ai-intake');
  let tmpDir, stateFile;

  beforeEach(() => {
    tmpDir = createTempDir();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'ai-intake.json');
  });
  afterEach(() => cleanupTempDir(tmpDir));

  it('creates intake with auto risk tier', () => {
    const result = lib.createIntake({ name: 'Chat Bot', description: 'Customer chatbot', data_types: ['PII'] }, { stateFile });
    expect(result.success).toBe(true);
    expect(result.intake.risk_tier).toBe(3);
  });

  it('lists intakes', () => {
    lib.createIntake({ name: 'Bot 1', description: 'D' }, { stateFile });
    lib.createIntake({ name: 'Bot 2', description: 'D' }, { stateFile });
    const result = lib.listIntakes({}, { stateFile });
    expect(result.total).toBe(2);
  });
});

// ─── Item 35: FinOps Planner ─────────────────────────────────────────────────

describe('FinOps Planner (Item 35)', () => {
  const lib = require('../bin/lib/finops-planner');
  let tmpDir, stateFile;

  beforeEach(() => {
    tmpDir = createTempDir();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'finops.json');
  });
  afterEach(() => cleanupTempDir(tmpDir));

  it('creates cost estimate', () => {
    const result = lib.createEstimate({
      name: 'API Service',
      components: [{ category: 'compute', tier: 'medium', quantity: 2 }]
    }, { stateFile });
    expect(result.success).toBe(true);
    expect(result.estimate.monthly_total).toBeGreaterThan(0);
  });

  it('generates report', () => {
    lib.createEstimate({ name: 'Svc', components: [{ category: 'compute' }] }, { stateFile });
    const result = lib.generateReport({ stateFile });
    expect(result.total_estimates).toBe(1);
  });
});

// ─── Item 36: Vendor Risk ───────────────────────────────────────────────────

describe('Vendor Risk (Item 36)', () => {
  const lib = require('../bin/lib/vendor-risk');
  let tmpDir;

  beforeEach(() => { tmpDir = createTempDir(); });
  afterEach(() => cleanupTempDir(tmpDir));

  it('scans project dependencies', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { express: '^4.0.0', chalk: '^5.0.0' }
    }), 'utf8');
    const result = lib.scanDependencies(tmpDir);
    expect(result.success).toBe(true);
    expect(result.total).toBe(2);
  });

  it('assesses dependency risk', () => {
    const stateFile = path.join(tmpDir, '.jumpstart', 'state', 'vendor-risk.json');
    const result = lib.assessDependency({ name: 'express', version: '4.18.0', license: 'MIT' }, { stateFile });
    expect(result.success).toBe(true);
    expect(result.assessment.risk_level).toBeDefined();
  });
});

// ─── Item 37: CAB Output ────────────────────────────────────────────────────

describe('CAB Output (Item 37)', () => {
  const lib = require('../bin/lib/cab-output');
  let tmpDir;

  beforeEach(() => { tmpDir = createTempDir(); });
  afterEach(() => cleanupTempDir(tmpDir));

  it('generates CAB summary', () => {
    const result = lib.generateCABSummary(tmpDir);
    expect(result.success).toBe(true);
    expect(result.completeness).toBeDefined();
    expect(result.gaps).toBeDefined();
  });
});

// ─── Item 38: BCDR Planning ─────────────────────────────────────────────────

describe('BCDR Planning (Item 38)', () => {
  const lib = require('../bin/lib/bcdr-planning');
  let tmpDir, stateFile;

  beforeEach(() => {
    tmpDir = createTempDir();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'bcdr.json');
  });
  afterEach(() => cleanupTempDir(tmpDir));

  it('defines service with tier', () => {
    const result = lib.defineService({ name: 'payment-api', tier: 'gold' }, { stateFile });
    expect(result.success).toBe(true);
    expect(result.service.rto_hours).toBe(1);
    expect(result.service.rpo_hours).toBe(1);
  });

  it('checks BCDR coverage in specs', () => {
    fs.writeFileSync(path.join(tmpDir, 'specs', 'architecture.md'), '# Arch\n\n## RTO/RPO\nRTO: 4h, RPO: 1h\n\n## Failover\nAutomatic failover.\n', 'utf8');
    const result = lib.checkCoverage(tmpDir);
    expect(result.coverage).toBeGreaterThan(0);
  });
});

// ─── Item 39: Ops Ownership ─────────────────────────────────────────────────

describe('Ops Ownership (Item 39)', () => {
  const lib = require('../bin/lib/ops-ownership');
  let tmpDir, stateFile;

  beforeEach(() => {
    tmpDir = createTempDir();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'ops-ownership.json');
  });
  afterEach(() => cleanupTempDir(tmpDir));

  it('defines ownership', () => {
    const result = lib.defineOwnership({ name: 'api', service_owner: 'team-lead', team: 'platform' }, { stateFile });
    expect(result.success).toBe(true);
    expect(result.service.oncall_model).toBe('business-hours');
  });

  it('checks completeness', () => {
    lib.defineOwnership({ name: 'api', service_owner: 'lead' }, { stateFile });
    const result = lib.checkCompleteness({ stateFile });
    expect(result.total_services).toBe(1);
  });
});

// ─── Item 40: Governance Dashboard ──────────────────────────────────────────

describe('Governance Dashboard (Item 40)', () => {
  const lib = require('../bin/lib/governance-dashboard');
  let tmpDir;

  beforeEach(() => { tmpDir = createTempDir(); });
  afterEach(() => cleanupTempDir(tmpDir));

  it('gathers governance data', () => {
    const result = lib.gatherGovernanceData(tmpDir);
    expect(result.success).toBe(true);
    expect(result.sections).toBeDefined();
    expect(result.governance_score).toBeDefined();
  });

  it('renders dashboard text', () => {
    const data = lib.gatherGovernanceData(tmpDir);
    const text = lib.renderDashboardText(data);
    expect(text).toContain('Governance Dashboard');
  });
});
