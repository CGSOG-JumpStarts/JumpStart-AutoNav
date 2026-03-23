/**
 * test-agent-intelligence.test.js — Tests for Coding Agent Intelligence (Items 41-60)
 *
 * Tests for all agent intelligence modules covering:
 * - Codebase Retrieval (41)
 * - AST Edit Engine (42)
 * - Refactor Planner (43)
 * - Test Generator (44)
 * - Contract First (45)
 * - Runtime Debugger (46)
 * - Migration Planner (47)
 * - Legacy Modernizer (48)
 * - DB Evolution (49)
 * - Safe Rename (50)
 * - Dependency Upgrade (51)
 * - Incident Feedback (52)
 * - Context Chunker (53)
 * - Model Router (54)
 * - Cost Router (55)
 * - Deterministic Artifacts (56)
 * - Agent Checkpoint (57)
 * - Tool Guardrails (58)
 * - Root Cause Analysis (59)
 * - Quality Graph (60)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function createTempDir() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-agent-'));
  fs.mkdirSync(path.join(tmpDir, '.jumpstart', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'specs', 'decisions'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });
  return tmpDir;
}

function cleanupTempDir(tmpDir) {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ─── Item 41: Codebase Retrieval ─────────────────────────────────────────────

describe('Codebase Retrieval (Item 41)', () => {
  const lib = require('../bin/lib/codebase-retrieval');
  let tmpDir;

  beforeEach(() => { tmpDir = createTempDir(); });
  afterEach(() => cleanupTempDir(tmpDir));

  it('indexes project files', () => {
    fs.writeFileSync(path.join(tmpDir, 'specs', 'architecture.md'), '# Arch\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'src', 'index.js'), 'console.log("hello");\n', 'utf8');
    const result = lib.indexProject(tmpDir);
    expect(result.success).toBe(true);
    expect(result.total_files).toBeGreaterThan(0);
  });

  it('queries files by content', () => {
    fs.writeFileSync(path.join(tmpDir, 'specs', 'architecture.md'), '# Architecture\n\nUses PostgreSQL database.\n', 'utf8');
    const result = lib.queryFiles(tmpDir, 'PostgreSQL');
    expect(result.success).toBe(true);
    expect(result.total_results).toBeGreaterThan(0);
  });
});

// ─── Item 42: AST Edit Engine ────────────────────────────────────────────────

describe('AST Edit Engine (Item 42)', () => {
  const lib = require('../bin/lib/ast-edit-engine');
  let tmpDir;

  beforeEach(() => { tmpDir = createTempDir(); });
  afterEach(() => cleanupTempDir(tmpDir));

  it('detects language from extension', () => {
    expect(lib.detectLanguage('file.js')).toBe('javascript');
    expect(lib.detectLanguage('file.ts')).toBe('typescript');
    expect(lib.detectLanguage('file.py')).toBeNull();
  });

  it('analyzes file structure', () => {
    const file = path.join(tmpDir, 'test.js');
    fs.writeFileSync(file, 'function hello() {}\nconst foo = 42;\nmodule.exports = { hello };\n', 'utf8');
    const result = lib.analyzeStructure(file);
    expect(result.success).toBe(true);
    expect(result.symbol_count).toBeGreaterThan(0);
    expect(result.has_exports).toBe(true);
  });

  it('validates safe edit', () => {
    const file = path.join(tmpDir, 'test.js');
    fs.writeFileSync(file, 'const a = 1;\nconst b = 2;\n', 'utf8');
    const result = lib.validateEdit(file, 'const a = 1;', 'const a = 42;');
    expect(result.success).toBe(true);
    expect(result.safe).toBe(true);
    expect(result.unique_match).toBe(true);
  });

  it('counts brackets correctly', () => {
    expect(lib.countBrackets('{ a: { b: 1 } }')).toEqual({ curly: 0, square: 0, paren: 0 });
  });
});

// ─── Item 43: Refactor Planner ───────────────────────────────────────────────

describe('Refactor Planner (Item 43)', () => {
  const lib = require('../bin/lib/refactor-planner');
  let tmpDir, stateFile;

  beforeEach(() => {
    tmpDir = createTempDir();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'refactor-plan.json');
  });
  afterEach(() => cleanupTempDir(tmpDir));

  it('creates a refactor plan', () => {
    const result = lib.createPlan({
      name: 'Extract auth module',
      type: 'extract',
      steps: [{ description: 'Identify auth code' }, { description: 'Create module' }]
    }, { stateFile });
    expect(result.success).toBe(true);
    expect(result.plan.steps.length).toBe(2);
  });

  it('validates plan dependencies', () => {
    const plan = lib.createPlan({ name: 'Test', type: 'rename', steps: [] }, { stateFile });
    const result = lib.validatePlan(plan.plan.id, { stateFile });
    expect(result.success).toBe(true);
    expect(result.valid).toBe(true);
  });
});

// ─── Item 44: Test Generator ─────────────────────────────────────────────────

describe('Test Generator (Item 44)', () => {
  const lib = require('../bin/lib/test-generator');

  it('extracts acceptance criteria from PRD', () => {
    const content = '## Stories\n\n**E1-S01**\n- Given a user is logged in\n- When they click logout\n- Then they are redirected\n';
    const criteria = lib.extractCriteria(content);
    expect(criteria.length).toBe(3);
    expect(criteria[0].story).toBe('E1-S01');
  });

  it('generates test stubs', () => {
    const criteria = [
      { story: 'E1-S01', criterion: 'user can log in', type: 'given' },
      { story: 'E1-S01', criterion: 'redirect to dashboard', type: 'then' }
    ];
    const result = lib.generateTestStubs(criteria);
    expect(result.success).toBe(true);
    expect(result.test_files).toBe(1);
    expect(result.framework).toBe('vitest');
  });
});

// ─── Item 45: Contract First ─────────────────────────────────────────────────

describe('Contract First (Item 45)', () => {
  const lib = require('../bin/lib/contract-first');
  let tmpDir;

  beforeEach(() => { tmpDir = createTempDir(); });
  afterEach(() => cleanupTempDir(tmpDir));

  it('extracts API contracts from specs', () => {
    fs.writeFileSync(path.join(tmpDir, 'specs', 'architecture.md'),
      '# API\n\n## Endpoints\n\nGET /api/users\nPOST /api/users\nDELETE /api/users/{id}\n', 'utf8');
    const result = lib.extractContracts(tmpDir);
    expect(result.success).toBe(true);
    expect(result.total_contracts).toBe(3);
  });
});

// ─── Item 46: Runtime Debugger ───────────────────────────────────────────────

describe('Runtime Debugger (Item 46)', () => {
  const lib = require('../bin/lib/runtime-debugger');

  it('analyzes log content for errors', () => {
    const logs = '[ERROR] Connection failed\nWARNING: timeout\nInfo: normal operation\n';
    const result = lib.analyzeLogs(logs);
    expect(result.success).toBe(true);
    expect(result.summary.errors).toBe(1);
    expect(result.summary.warnings).toBe(1);
  });

  it('generates hypotheses from analysis', () => {
    const analysis = {
      summary: { errors: 1, warnings: 0, exceptions: 0, timeouts: 1, oom: 0, connection_issues: 0 }
    };
    const result = lib.generateHypotheses(analysis);
    expect(result.hypotheses.length).toBeGreaterThan(0);
  });
});

// ─── Item 47: Migration Planner ──────────────────────────────────────────────

describe('Migration Planner (Item 47)', () => {
  const lib = require('../bin/lib/migration-planner');
  let tmpDir, stateFile;

  beforeEach(() => {
    tmpDir = createTempDir();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'migration-plan.json');
  });
  afterEach(() => cleanupTempDir(tmpDir));

  it('creates a migration plan', () => {
    const result = lib.createMigration({
      name: 'Monolith to microservices',
      strategy: 'strangler-fig',
      components: [{ name: 'auth' }, { name: 'billing' }]
    }, { stateFile });
    expect(result.success).toBe(true);
    expect(result.migration.components.length).toBe(2);
  });

  it('rejects invalid strategies', () => {
    const result = lib.createMigration({ name: 'Test', strategy: 'invalid' }, { stateFile });
    expect(result.success).toBe(false);
  });
});

// ─── Item 48: Legacy Modernizer ──────────────────────────────────────────────

describe('Legacy Modernizer (Item 48)', () => {
  const lib = require('../bin/lib/legacy-modernizer');
  let tmpDir, stateFile;

  beforeEach(() => {
    tmpDir = createTempDir();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'legacy-modernization.json');
  });
  afterEach(() => cleanupTempDir(tmpDir));

  it('assesses a legacy system', () => {
    const result = lib.assessSystem({ name: 'OrderService', platform: 'java-monolith' }, { stateFile });
    expect(result.success).toBe(true);
    expect(result.assessment.recommended_strategy).toBe('strangler-fig');
  });

  it('creates a modernization plan', () => {
    const assessment = lib.assessSystem({ name: 'Svc', platform: 'cobol' }, { stateFile });
    const result = lib.createPlan(assessment.assessment.id, { target_platform: 'node.js' }, { stateFile });
    expect(result.success).toBe(true);
    expect(result.plan.phases.length).toBeGreaterThan(0);
  });
});

// ─── Item 49: DB Evolution ───────────────────────────────────────────────────

describe('DB Evolution (Item 49)', () => {
  const lib = require('../bin/lib/db-evolution');
  let tmpDir, stateFile;

  beforeEach(() => {
    tmpDir = createTempDir();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'db-evolution.json');
  });
  afterEach(() => cleanupTempDir(tmpDir));

  it('plans a migration', () => {
    const result = lib.planMigration({
      name: 'Add email column',
      type: 'add-column',
      table: 'users',
      column: 'email'
    }, { stateFile });
    expect(result.success).toBe(true);
    expect(result.migration.risk_level).toBe('low');
  });

  it('validates high-risk migration', () => {
    const mig = lib.planMigration({ name: 'Drop legacy', type: 'drop-table', table: 'legacy_users' }, { stateFile });
    const result = lib.validateMigration(mig.migration.id, { stateFile });
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ─── Item 50: Safe Rename ────────────────────────────────────────────────────

describe('Safe Rename (Item 50)', () => {
  const lib = require('../bin/lib/safe-rename');
  let tmpDir;

  beforeEach(() => { tmpDir = createTempDir(); });
  afterEach(() => cleanupTempDir(tmpDir));

  it('plans a rename operation', () => {
    fs.writeFileSync(path.join(tmpDir, 'src', 'old.js'), 'module.exports = {};\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'src', 'index.js'), "const old = require('./old');\n", 'utf8');
    const result = lib.planRename(tmpDir, 'src/old.js', 'src/new.js');
    expect(result.success).toBe(true);
    expect(result.references_found).toBeGreaterThan(0);
  });

  it('validates rename result', () => {
    fs.writeFileSync(path.join(tmpDir, 'src', 'new.js'), 'module.exports = {};\n', 'utf8');
    const result = lib.validateRename(tmpDir, 'src/old.js', 'src/new.js');
    expect(result.new_file_exists).toBe(true);
    expect(result.old_file_removed).toBe(true);
  });
});

// ─── Item 51: Dependency Upgrade ─────────────────────────────────────────────

describe('Dependency Upgrade (Item 51)', () => {
  const lib = require('../bin/lib/dependency-upgrade');
  let tmpDir;

  beforeEach(() => { tmpDir = createTempDir(); });
  afterEach(() => cleanupTempDir(tmpDir));

  it('scans for upgrades', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { express: '^4.18.0' },
      devDependencies: { vitest: '^0.34.0' }
    }), 'utf8');
    const result = lib.scanUpgrades(tmpDir);
    expect(result.success).toBe(true);
    expect(result.total).toBe(1); // Only production deps by default
  });
});

// ─── Item 52: Incident Feedback ──────────────────────────────────────────────

describe('Incident Feedback (Item 52)', () => {
  const lib = require('../bin/lib/incident-feedback');
  let tmpDir, stateFile;

  beforeEach(() => {
    tmpDir = createTempDir();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'incidents.json');
  });
  afterEach(() => cleanupTempDir(tmpDir));

  it('logs an incident', () => {
    const result = lib.logIncident({
      title: 'API outage',
      severity: 'sev1',
      category: 'availability',
      description: 'Full API outage for 2 hours'
    }, { stateFile });
    expect(result.success).toBe(true);
    expect(result.incident.id).toMatch(/^INC-/);
  });

  it('analyzes incident for spec updates', () => {
    const inc = lib.logIncident({ title: 'Outage', severity: 'sev1', category: 'security', description: 'Breach' }, { stateFile });
    const result = lib.analyzeIncident(inc.incident.id, { stateFile });
    expect(result.success).toBe(true);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });
});

// ─── Item 53: Context Chunker ────────────────────────────────────────────────

describe('Context Chunker (Item 53)', () => {
  const lib = require('../bin/lib/context-chunker');

  it('estimates tokens from text', () => {
    const tokens = lib.estimateTokens('Hello world');
    expect(tokens).toBeGreaterThan(0);
  });

  it('chunks content by context window', () => {
    const content = 'x'.repeat(100000);
    const result = lib.chunkContent(content, { model: 'gpt-4' });
    expect(result.success).toBe(true);
    expect(result.chunks).toBeGreaterThan(1);
  });

  it('handles short content in single chunk', () => {
    const result = lib.chunkContent('short text', { model: 'claude-3-sonnet' });
    expect(result.chunks).toBe(1);
  });
});

// ─── Item 54: Model Router ──────────────────────────────────────────────────

describe('Model Router (Item 54)', () => {
  const lib = require('../bin/lib/model-router');

  it('routes task to model', () => {
    const result = lib.routeTask('coding');
    expect(result.success).toBe(true);
    expect(result.model).toBeDefined();
  });

  it('rejects invalid task types', () => {
    const result = lib.routeTask('invalid');
    expect(result.success).toBe(false);
  });

  it('generates routing report', () => {
    const result = lib.generateReport();
    expect(result.success).toBe(true);
    expect(result.unique_models).toBeGreaterThan(0);
  });
});

// ─── Item 55: Cost Router ───────────────────────────────────────────────────

describe('Cost Router (Item 55)', () => {
  const lib = require('../bin/lib/cost-router');

  it('routes by cost', () => {
    const result = lib.routeByCost({ type: 'coding', estimated_tokens: 1000 });
    expect(result.success).toBe(true);
    expect(result.selected_model).toBeDefined();
    expect(result.estimated_cost).toBeGreaterThan(0);
  });

  it('generates cost report', () => {
    const result = lib.generateReport();
    expect(result.success).toBe(true);
    expect(result.budget_profile).toBeDefined();
  });
});

// ─── Item 56: Deterministic Artifacts ────────────────────────────────────────

describe('Deterministic Artifacts (Item 56)', () => {
  const lib = require('../bin/lib/deterministic-artifacts');
  let tmpDir;

  beforeEach(() => { tmpDir = createTempDir(); });
  afterEach(() => cleanupTempDir(tmpDir));

  it('normalizes markdown', () => {
    const input = 'Hello  \t  \r\nWorld\n\n\n\n\nEnd';
    const result = lib.normalizeMarkdown(input);
    expect(result).not.toContain('\r');
    expect(result).not.toContain('\t');
    expect(result).not.toMatch(/\n{3,}/);
  });

  it('generates consistent hash', () => {
    const hash1 = lib.hashContent('Hello world');
    const hash2 = lib.hashContent('Hello world');
    expect(hash1).toBe(hash2);
  });

  it('verifies stability between files', () => {
    const f1 = path.join(tmpDir, 'a.md');
    const f2 = path.join(tmpDir, 'b.md');
    fs.writeFileSync(f1, '# Same\n\nContent\n', 'utf8');
    fs.writeFileSync(f2, '# Same\n\nContent\n', 'utf8');
    const result = lib.verifyStability(f1, f2);
    expect(result.identical).toBe(true);
  });
});

// ─── Item 57: Agent Checkpoint ───────────────────────────────────────────────

describe('Agent Checkpoint (Item 57)', () => {
  const lib = require('../bin/lib/agent-checkpoint');
  let tmpDir, stateFile;

  beforeEach(() => {
    tmpDir = createTempDir();
    stateFile = path.join(tmpDir, '.jumpstart', 'state', 'agent-checkpoints.json');
  });
  afterEach(() => cleanupTempDir(tmpDir));

  it('saves a checkpoint', () => {
    const result = lib.saveCheckpoint({ agent: 'developer', phase: 'build', context: { task: 1 } }, { stateFile });
    expect(result.success).toBe(true);
    expect(result.checkpoint.id).toBeDefined();
  });

  it('restores from latest checkpoint', () => {
    lib.saveCheckpoint({ agent: 'developer', context: { step: 1 } }, { stateFile });
    lib.saveCheckpoint({ agent: 'developer', context: { step: 2 } }, { stateFile });
    const result = lib.restoreCheckpoint(null, { stateFile });
    expect(result.success).toBe(true);
    expect(result.context.step).toBe(2);
  });

  it('cleans old checkpoints', () => {
    for (let i = 0; i < 15; i++) {
      lib.saveCheckpoint({ agent: 'dev', context: { i } }, { stateFile });
    }
    const result = lib.cleanCheckpoints({ stateFile, keep: 5 });
    expect(result.remaining).toBe(5);
    expect(result.removed).toBe(10);
  });
});

// ─── Item 58: Tool Guardrails ────────────────────────────────────────────────

describe('Tool Guardrails (Item 58)', () => {
  const lib = require('../bin/lib/tool-guardrails');

  it('blocks critical operations', () => {
    const result = lib.checkOperation('sudo rm -rf /');
    expect(result.requires_approval).toBe(true);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it('allows safe operations', () => {
    const result = lib.checkOperation('cat file.txt');
    expect(result.violations.length).toBe(0);
    expect(result.risk_level).toBe('none');
  });

  it('validates file operations', () => {
    const result = lib.validateFileOperation('delete', '.env.production');
    expect(result.allowed).toBe(false);
  });

  it('allows safe file edits', () => {
    const result = lib.validateFileOperation('edit', 'src/index.js');
    expect(result.allowed).toBe(true);
  });
});

// ─── Item 59: Root Cause Analysis ────────────────────────────────────────────

describe('Root Cause Analysis (Item 59)', () => {
  const lib = require('../bin/lib/root-cause-analysis');

  it('analyzes failure output', () => {
    const output = `Error: Cannot find module 'express'\n    at Module._resolveFilename\n    at Module._load\nTypeError: foo is not a function\n`;
    const result = lib.analyzeFailure(output);
    expect(result.success).toBe(true);
    expect(result.total_hypotheses).toBeGreaterThan(0);
    expect(result.primary_cause).toBeDefined();
  });

  it('generates report from analysis', () => {
    const analysis = lib.analyzeFailure('Error: SyntaxError: unexpected token');
    const report = lib.generateReport(analysis);
    expect(report.success).toBe(true);
    expect(report.action_plan).toBeDefined();
  });
});

// ─── Item 60: Quality Graph ─────────────────────────────────────────────────

describe('Quality Graph (Item 60)', () => {
  const lib = require('../bin/lib/quality-graph');
  let tmpDir;

  beforeEach(() => { tmpDir = createTempDir(); });
  afterEach(() => cleanupTempDir(tmpDir));

  it('scans project quality', () => {
    fs.writeFileSync(path.join(tmpDir, 'src', 'index.js'), 'function main() {\n  console.log("hello");\n}\n', 'utf8');
    const result = lib.scanQuality(tmpDir);
    expect(result.success).toBe(true);
    expect(result.total_files).toBeGreaterThan(0);
    expect(result.summary.average_score).toBeGreaterThan(0);
  });

  it('analyzes file metrics', () => {
    const content = '// Comment\nfunction a() { return 1; }\nfunction b() { return 2; }\n';
    const metrics = lib.analyzeFileMetrics(content, '.js');
    expect(metrics.total_lines).toBe(3);
    expect(metrics.functions).toBeGreaterThan(0);
  });

  it('calculates overall score', () => {
    const score = lib.calculateOverallScore({ total_lines: 50, max_nesting_depth: 2, todos: 0, comment_ratio: 10, long_lines: 0, functions: 5 });
    expect(score).toBeGreaterThan(50);
  });
});
