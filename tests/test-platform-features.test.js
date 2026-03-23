/**
 * test-platform-features.test.js — Tests for 10 Core Platform Features
 *
 * Covers:
 *  1. Multi-repo program orchestration (multi-repo.js)
 *  2. Bidirectional code-to-spec traceability (bidirectional-trace.js)
 *  3. Agentic change impact analysis (impact-analysis.js)
 *  4. Automated repo understanding graph (repo-graph.js)
 *  5. Persistent long-term project memory (project-memory.js)
 *  6. Enterprise policy engine (policy-engine.js)
 *  7. Branch-aware workflow engine (branch-workflow.js)
 *  8. PR-native execution mode (pr-package.js)
 *  9. Multi-agent concurrent execution (parallel-agents.js)
 * 10. Human approval workflows with roles (role-approval.js)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'js-test-'));
  fs.mkdirSync(path.join(tmp, '.jumpstart', 'state'), { recursive: true });
  return tmp;
}

function rmTmpDir(dir) {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ─── 1. Multi-Repo Program Orchestration ────────────────────────────────────

describe('multi-repo', () => {
  let tmp;
  let opts;

  beforeEach(() => {
    tmp = makeTmpDir();
    opts = { stateFile: path.join(tmp, '.jumpstart', 'state', 'multi-repo.json') };
  });
  afterEach(() => rmTmpDir(tmp));

  const lib = () => require('../bin/lib/multi-repo');

  it('initProgram creates a new program', () => {
    const r = lib().initProgram('MyProgram', opts);
    expect(r.success).toBe(true);
    expect(r.program_name).toBe('MyProgram');
    expect(fs.existsSync(opts.stateFile)).toBe(true);
  });

  it('initProgram rejects empty name', () => {
    const r = lib().initProgram('', opts);
    expect(r.success).toBe(false);
  });

  it('linkRepo adds a repo', () => {
    lib().initProgram('P', opts);
    const r = lib().linkRepo('https://github.com/org/repo', 'frontend', opts);
    expect(r.success).toBe(true);
    expect(r.repo.role).toBe('frontend');
    expect(r.total_repos).toBe(1);
  });

  it('linkRepo rejects invalid role', () => {
    lib().initProgram('P', opts);
    const r = lib().linkRepo('https://github.com/org/repo', 'wizard', opts);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/role must be one of/);
  });

  it('linkRepo prevents duplicate repos', () => {
    lib().initProgram('P', opts);
    lib().linkRepo('https://github.com/org/repo', 'backend', opts);
    const r2 = lib().linkRepo('https://github.com/org/repo', 'backend', opts);
    expect(r2.success).toBe(false);
    expect(r2.error).toMatch(/already linked/);
  });

  it('getProgramStatus returns aggregate info', () => {
    lib().initProgram('P', opts);
    lib().linkRepo('https://github.com/org/frontend', 'frontend', opts);
    lib().linkRepo('https://github.com/org/backend', 'backend', opts);
    const s = lib().getProgramStatus(opts);
    expect(s.repo_count).toBe(2);
    expect(s.role_breakdown.frontend).toBe(1);
    expect(s.role_breakdown.backend).toBe(1);
  });

  it('addSharedSpec records a shared spec', () => {
    lib().initProgram('P', opts);
    const r = lib().addSharedSpec('specs/prd.md', ['repo-1', 'repo-2'], opts);
    expect(r.success).toBe(true);
    expect(r.total_shared_specs).toBe(1);
  });

  it('addDependency records a cross-repo dependency', () => {
    lib().initProgram('P', opts);
    const r = lib().addDependency('repo-a', 'repo-b', 'api', opts);
    expect(r.success).toBe(true);
    expect(r.dependency.type).toBe('api');
  });

  it('setReleasePlan stores milestones', () => {
    lib().initProgram('P', opts);
    const r = lib().setReleasePlan([
      { name: 'Alpha', target_date: '2026-06-01', repos: [] },
      { name: 'Beta', target_date: '2026-09-01', repos: [] }
    ], opts);
    expect(r.success).toBe(true);
    expect(r.milestone_count).toBe(2);
  });

  it('defaultMultiRepoState returns expected shape', () => {
    const s = lib().defaultMultiRepoState();
    expect(s).toHaveProperty('repos');
    expect(s).toHaveProperty('shared_specs');
    expect(s).toHaveProperty('release_plan');
  });
});

// ─── 2. Bidirectional Code-to-Spec Traceability ──────────────────────────────

describe('bidirectional-trace', () => {
  let tmp;

  beforeEach(() => {
    tmp = makeTmpDir();
    // Create a fake source file that references spec IDs
    const srcDir = path.join(tmp, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'users.js'), '// E1-S1: user model\n// M1-T01: create user\nmodule.exports = {};\n', 'utf8');

    // Create a fake test file
    const testsDir = path.join(tmp, 'tests');
    fs.mkdirSync(testsDir, { recursive: true });
    fs.writeFileSync(path.join(testsDir, 'users.test.js'), '// E1-S1 test\ntest("user", () => {});\n', 'utf8');

    // Create specs dir with a PRD
    const specsDir = path.join(tmp, 'specs');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(path.join(specsDir, 'prd.md'), '#### Story E1-S1: Create user\n#### Story E1-S2: Delete user\n', 'utf8');
  });
  afterEach(() => rmTmpDir(tmp));

  const lib = () => require('../bin/lib/bidirectional-trace');

  it('scanTraceLinks finds forward and reverse maps', () => {
    const result = lib().scanTraceLinks(tmp);
    expect(result.forward_map).toBeDefined();
    expect(result.reverse_map).toBeDefined();
    expect(result.stats.total_links).toBeGreaterThan(0);
  });

  it('forward map contains E1-S1', () => {
    const result = lib().scanTraceLinks(tmp);
    expect(result.forward_map['E1-S1']).toBeDefined();
    expect(result.forward_map['E1-S1'].length).toBeGreaterThan(0);
  });

  it('traceForward returns linked files for a spec ID', () => {
    const traceMap = lib().scanTraceLinks(tmp);
    const links = lib().traceForward('E1-S1', traceMap);
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveProperty('file');
  });

  it('traceReverse returns spec IDs for a file', () => {
    const traceMap = lib().scanTraceLinks(tmp);
    const reverseKey = Object.keys(traceMap.reverse_map)[0];
    const links = lib().traceReverse(reverseKey, traceMap);
    expect(links.length).toBeGreaterThan(0);
  });

  it('buildCoverageReport detects gaps', () => {
    const traceMap = lib().scanTraceLinks(tmp);
    const report = lib().buildCoverageReport(tmp, traceMap);
    // E1-S2 is in prd but not in any source file → should be a gap
    expect(report.gap_list).toContain('E1-S2');
  });

  it('saveTraceMap and loadTraceMap roundtrip', () => {
    const traceMap = lib().scanTraceLinks(tmp);
    const outFile = path.join(tmp, 'trace.json');
    lib().saveTraceMap(traceMap, outFile);
    const loaded = lib().loadTraceMap(outFile);
    expect(loaded.stats).toBeDefined();
  });

  it('loadTraceMap returns empty map for missing file', () => {
    const loaded = lib().loadTraceMap('/nonexistent/trace.json');
    expect(loaded.forward_map).toEqual({});
  });
});

// ─── 3. Agentic Change Impact Analysis ──────────────────────────────────────

describe('impact-analysis', () => {
  let tmp;

  beforeEach(() => {
    tmp = makeTmpDir();
    const specsDir = path.join(tmp, 'specs');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(path.join(specsDir, 'prd.md'), '#### Story E1-S1: Auth\n', 'utf8');
    const testsDir = path.join(tmp, 'tests');
    fs.mkdirSync(testsDir, { recursive: true });
    fs.writeFileSync(path.join(testsDir, 'auth.test.js'), "// tests for auth module\ntest('auth', () => {});", 'utf8');
    const srcDir = path.join(tmp, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'auth.service.js'), '// auth service\nmodule.exports = {};', 'utf8');
  });
  afterEach(() => rmTmpDir(tmp));

  const lib = () => require('../bin/lib/impact-analysis');

  it('analyzeImpact returns success for a file target', () => {
    const r = lib().analyzeImpact(tmp, { file: 'src/auth.service.js' });
    expect(r.success).toBe(true);
    expect(r.summary).toBeDefined();
    expect(r.risk_level).toBeDefined();
  });

  it('analyzeImpact returns error without target', () => {
    const r = lib().analyzeImpact(tmp, {});
    expect(r.success).toBe(false);
  });

  it('analyzeImpact finds affected tests', () => {
    const r = lib().analyzeImpact(tmp, { symbol: 'auth' });
    expect(r.success).toBe(true);
    expect(r.affected_tests.length).toBeGreaterThan(0);
  });

  it('analyzeImpact finds affected requirements', () => {
    const r = lib().analyzeImpact(tmp, { symbol: 'Auth' });
    expect(r.success).toBe(true);
    // prd.md contains "Auth" so there should be at least one requirement hit
    expect(r.affected_requirements.length).toBeGreaterThan(0);
  });

  it('risk_level is low for minimal impact', () => {
    const r = lib().analyzeImpact(tmp, { symbol: 'zzz_nonexistent_xyz' });
    expect(r.success).toBe(true);
    expect(r.risk_level).toBe('low');
    expect(r.summary.total_affected).toBe(0);
  });

  it('renderImpactReport returns a string', () => {
    const r = lib().analyzeImpact(tmp, { file: 'src/auth.service.js' });
    const report = lib().renderImpactReport(r);
    expect(typeof report).toBe('string');
    expect(report).toMatch(/Impact Analysis/);
  });

  it('renderImpactReport handles failure gracefully', () => {
    const r = lib().renderImpactReport({ success: false, error: 'bad input' });
    expect(r).toMatch(/failed/i);
  });
});

// ─── 4. Automated Repo Understanding Graph ──────────────────────────────────

describe('repo-graph', () => {
  let tmp;

  beforeEach(() => {
    tmp = makeTmpDir();
    const srcDir = path.join(tmp, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'api.js'), '// @owner team-api\nmodule.exports = {};', 'utf8');
    fs.writeFileSync(path.join(srcDir, 'model.js'), '// model\nmodule.exports = {};', 'utf8');
    const specsDir = path.join(tmp, 'specs', 'decisions');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(path.join(specsDir, 'adr-001.md'), '# Use REST APIs\n', 'utf8');
  });
  afterEach(() => rmTmpDir(tmp));

  const lib = () => require('../bin/lib/repo-graph');

  it('buildRepoGraph returns node and edge counts', () => {
    const graphFile = path.join(tmp, '.jumpstart', 'state', 'repo-graph.json');
    const r = lib().buildRepoGraph(tmp, { graphFile });
    expect(r.success).toBe(true);
    expect(r.node_count).toBeGreaterThan(0);
    expect(r.edge_count).toBeGreaterThan(0);
  });

  it('buildRepoGraph detects API files', () => {
    const graphFile = path.join(tmp, '.jumpstart', 'state', 'repo-graph.json');
    lib().buildRepoGraph(tmp, { graphFile });
    const graph = lib().loadRepoGraph(graphFile);
    const apiNode = Object.values(graph.nodes).find(n => n.type === 'api');
    expect(apiNode).toBeDefined();
  });

  it('buildRepoGraph detects ADR decision nodes', () => {
    const graphFile = path.join(tmp, '.jumpstart', 'state', 'repo-graph.json');
    lib().buildRepoGraph(tmp, { graphFile });
    const graph = lib().loadRepoGraph(graphFile);
    const decNode = Object.values(graph.nodes).find(n => n.type === 'decision');
    expect(decNode).toBeDefined();
  });

  it('upsertNode and addEdge work correctly', () => {
    const graph = lib().defaultRepoGraph();
    lib().upsertNode(graph, 'n1', 'module', { name: 'N1' });
    lib().upsertNode(graph, 'n2', 'file', { name: 'N2' });
    lib().addEdge(graph, 'n1', 'n2', 'contains');
    lib().addEdge(graph, 'n1', 'n2', 'contains'); // duplicate should not double-add
    expect(Object.keys(graph.nodes).length).toBe(2);
    expect(graph.edges.length).toBe(1);
  });

  it('queryGraph filters by type', () => {
    const graph = lib().defaultRepoGraph();
    lib().upsertNode(graph, 'a', 'api', { name: 'Auth API' });
    lib().upsertNode(graph, 'b', 'module', { name: 'Core' });
    const results = lib().queryGraph(graph, { type: 'api' });
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('a');
  });

  it('queryGraph filters by nameContains', () => {
    const graph = lib().defaultRepoGraph();
    lib().upsertNode(graph, 'a', 'api', { name: 'Auth API' });
    lib().upsertNode(graph, 'b', 'api', { name: 'Users API' });
    const results = lib().queryGraph(graph, { nameContains: 'auth' });
    expect(results.length).toBe(1);
  });

  it('getNeighbours returns incoming and outgoing edges', () => {
    const graph = lib().defaultRepoGraph();
    lib().upsertNode(graph, 'parent', 'module', {});
    lib().upsertNode(graph, 'child', 'file', {});
    lib().addEdge(graph, 'parent', 'child', 'contains');
    const nb = lib().getNeighbours(graph, 'parent');
    expect(nb.outgoing.length).toBe(1);
    expect(nb.incoming.length).toBe(0);
  });

  it('loadRepoGraph returns default for missing file', () => {
    const graph = lib().loadRepoGraph('/nonexistent/repo-graph.json');
    expect(graph.nodes).toEqual({});
    expect(graph.edges).toEqual([]);
  });
});

// ─── 5. Persistent Long-Term Project Memory ─────────────────────────────────

describe('project-memory', () => {
  let tmp;
  let opts;

  beforeEach(() => {
    tmp = makeTmpDir();
    opts = { memoryFile: path.join(tmp, '.jumpstart', 'state', 'project-memory.json') };
  });
  afterEach(() => rmTmpDir(tmp));

  const lib = () => require('../bin/lib/project-memory');

  it('addMemory creates an entry', () => {
    const r = lib().addMemory({ type: 'decision', title: 'Use REST', content: 'We chose REST over gRPC.' }, opts);
    expect(r.success).toBe(true);
    expect(r.entry.id).toBeDefined();
    expect(r.total).toBe(1);
  });

  it('addMemory rejects missing title', () => {
    const r = lib().addMemory({ type: 'decision', content: 'no title' }, opts);
    expect(r.success).toBe(false);
  });

  it('addMemory rejects invalid type', () => {
    const r = lib().addMemory({ type: 'unknown', title: 't', content: 'c' }, opts);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/type must be one of/);
  });

  it('listMemories returns all entries', () => {
    lib().addMemory({ type: 'insight', title: 'I1', content: 'c' }, opts);
    lib().addMemory({ type: 'pitfall', title: 'P1', content: 'c' }, opts);
    const r = lib().listMemories({}, opts);
    expect(r.total).toBe(2);
  });

  it('listMemories filters by type', () => {
    lib().addMemory({ type: 'decision', title: 'D', content: 'c' }, opts);
    lib().addMemory({ type: 'pitfall', title: 'P', content: 'c' }, opts);
    const r = lib().listMemories({ type: 'pitfall' }, opts);
    expect(r.total).toBe(1);
    expect(r.entries[0].type).toBe('pitfall');
  });

  it('searchMemories finds by keyword', () => {
    lib().addMemory({ type: 'tribal', title: 'Deploy secret', content: 'Always use env vars for secrets.' }, opts);
    lib().addMemory({ type: 'insight', title: 'Unrelated', content: 'Nothing here.' }, opts);
    const r = lib().searchMemories('secret', opts);
    expect(r.total).toBe(1);
  });

  it('searchMemories returns error for empty keyword', () => {
    const r = lib().searchMemories('', opts);
    expect(r.success).toBe(false);
  });

  it('recallMemory retrieves by ID', () => {
    const added = lib().addMemory({ type: 'rejection', title: 'Rejected option', content: 'GraphQL was too complex.' }, opts);
    const recalled = lib().recallMemory(added.entry.id, opts);
    expect(recalled.success).toBe(true);
    expect(recalled.entry.title).toBe('Rejected option');
  });

  it('recallMemory returns error for unknown ID', () => {
    const r = lib().recallMemory('nonexistent-id', opts);
    expect(r.success).toBe(false);
  });

  it('deleteMemory removes an entry', () => {
    const added = lib().addMemory({ type: 'insight', title: 'T', content: 'C' }, opts);
    const del = lib().deleteMemory(added.entry.id, opts);
    expect(del.success).toBe(true);
    expect(del.total).toBe(0);
  });

  it('getMemoryStats returns by_type breakdown', () => {
    lib().addMemory({ type: 'decision', title: 'D', content: 'c' }, opts);
    lib().addMemory({ type: 'decision', title: 'D2', content: 'c' }, opts);
    lib().addMemory({ type: 'pitfall', title: 'P', content: 'c' }, opts);
    const stats = lib().getMemoryStats(opts);
    expect(stats.total).toBe(3);
    expect(stats.by_type.decision).toBe(2);
    expect(stats.by_type.pitfall).toBe(1);
  });
});

// ─── 6. Enterprise Policy Engine ────────────────────────────────────────────

describe('policy-engine', () => {
  let tmp;
  let opts;

  beforeEach(() => {
    tmp = makeTmpDir();
    opts = { policyFile: path.join(tmp, '.jumpstart', 'policies.json') };
  });
  afterEach(() => rmTmpDir(tmp));

  const lib = () => require('../bin/lib/policy-engine');

  it('addPolicy creates a rule', () => {
    const r = lib().addPolicy({
      name: 'No console.log',
      description: 'Do not use console.log in production code.',
      category: 'security',
      severity: 'warning',
      pattern: 'console\\.log'
    }, opts);
    expect(r.success).toBe(true);
    expect(r.policy.category).toBe('security');
  });

  it('addPolicy rejects missing name', () => {
    const r = lib().addPolicy({ description: 'desc', category: 'other' }, opts);
    expect(r.success).toBe(false);
  });

  it('addPolicy rejects invalid category', () => {
    const r = lib().addPolicy({ name: 'N', description: 'D', category: 'invalid' }, opts);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/category must be one of/);
  });

  it('addPolicy rejects invalid severity', () => {
    const r = lib().addPolicy({ name: 'N', description: 'D', category: 'security', severity: 'critical' }, opts);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/severity must be one of/);
  });

  it('addPolicy rejects duplicate IDs', () => {
    lib().addPolicy({ id: 'p-001', name: 'N', description: 'D', category: 'other' }, opts);
    const r = lib().addPolicy({ id: 'p-001', name: 'N2', description: 'D2', category: 'other' }, opts);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/already exists/);
  });

  it('listPolicies returns all registered policies', () => {
    lib().addPolicy({ name: 'A', description: 'D', category: 'naming' }, opts);
    lib().addPolicy({ name: 'B', description: 'D', category: 'security' }, opts);
    const r = lib().listPolicies({}, opts);
    expect(r.total).toBe(2);
  });

  it('listPolicies filters by category', () => {
    lib().addPolicy({ name: 'A', description: 'D', category: 'naming' }, opts);
    lib().addPolicy({ name: 'B', description: 'D', category: 'security' }, opts);
    const r = lib().listPolicies({ category: 'naming' }, opts);
    expect(r.total).toBe(1);
  });

  it('checkPolicies passes when no violations', () => {
    lib().addPolicy({ name: 'Flag TODO', description: 'No TODOs', category: 'other', severity: 'warning', pattern: 'SHOULDNEVEREXIST_XYZ' }, opts);
    const r = lib().checkPolicies(tmp, opts);
    expect(r.success).toBe(true);
    expect(r.passed).toBe(true);
    expect(r.violations.length).toBe(0);
  });

  it('checkPolicies detects violations in files', () => {
    const srcDir = path.join(tmp, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'index.js'), 'console.log("hello");', 'utf8');
    lib().addPolicy({
      name: 'No console.log',
      description: 'Avoid console.log',
      category: 'security',
      severity: 'error',
      pattern: 'console\\.log',
      applies_to: ['src']
    }, opts);
    const r = lib().checkPolicies(tmp, opts);
    expect(r.passed).toBe(false);
    expect(r.violations.length).toBeGreaterThan(0);
  });

  it('checkPolicies with no policies returns passed', () => {
    const r = lib().checkPolicies(tmp, opts);
    expect(r.success).toBe(true);
    expect(r.passed).toBe(true);
  });
});

// ─── 7. Branch-Aware Workflow Engine ────────────────────────────────────────

describe('branch-workflow', () => {
  let tmp;
  let opts;

  beforeEach(() => {
    tmp = makeTmpDir();
    opts = { stateFile: path.join(tmp, '.jumpstart', 'state', 'branch-workflows.json') };
  });
  afterEach(() => rmTmpDir(tmp));

  const lib = () => require('../bin/lib/branch-workflow');

  it('trackBranch creates a branch entry', () => {
    const r = lib().trackBranch(tmp, { branch: 'feature/test', ...opts });
    expect(r.success).toBe(true);
    expect(r.branch.branch).toBe('feature/test');
  });

  it('trackBranch updates an existing branch', () => {
    lib().trackBranch(tmp, { branch: 'main', ...opts });
    lib().trackBranch(tmp, { branch: 'main', pr_number: 42, ...opts });
    const status = lib().getBranchStatus(tmp, { branch: 'main', ...opts });
    expect(status.data.pr_number).toBe(42);
  });

  it('recordPhaseSnapshot appends a snapshot', () => {
    lib().trackBranch(tmp, { branch: 'dev', ...opts });
    const r = lib().recordPhaseSnapshot(tmp, 2, { notes: 'PM done' }, { branch: 'dev', ...opts });
    expect(r.success).toBe(true);
    expect(r.snapshot.phase).toBe(2);
  });

  it('recordBranchApproval records an approval', () => {
    lib().trackBranch(tmp, { branch: 'dev', ...opts });
    const r = lib().recordBranchApproval(tmp, 'specs/prd.md', 'Alice', { branch: 'dev', ...opts });
    expect(r.success).toBe(true);
    expect(r.approval.approver).toBe('Alice');
  });

  it('getBranchStatus returns tracked=false for unknown branch', () => {
    const r = lib().getBranchStatus(tmp, { branch: 'no-such-branch', ...opts });
    expect(r.tracked).toBe(false);
  });

  it('listTrackedBranches returns all tracked branches', () => {
    lib().trackBranch(tmp, { branch: 'main', ...opts });
    lib().trackBranch(tmp, { branch: 'feature/x', ...opts });
    const r = lib().listTrackedBranches(opts);
    expect(r.total).toBe(2);
  });

  it('getCurrentBranch returns a string', () => {
    const branch = lib().getCurrentBranch(tmp);
    expect(typeof branch).toBe('string');
    expect(branch.length).toBeGreaterThan(0);
  });

  it('defaultBranchStore returns expected shape', () => {
    const s = lib().defaultBranchStore();
    expect(s).toHaveProperty('branches');
    expect(s.branches).toEqual({});
  });
});

// ─── 8. PR-Native Execution Mode ────────────────────────────────────────────

describe('pr-package', () => {
  let tmp;

  beforeEach(() => {
    tmp = makeTmpDir();
  });
  afterEach(() => rmTmpDir(tmp));

  const lib = () => require('../bin/lib/pr-package');

  it('createPRPackage creates a markdown file', () => {
    const r = lib().createPRPackage({
      title: 'Add auth',
      summary: 'Implements JWT authentication.',
      changes: ['src/auth.js'],
      risk_notes: ['Session tokens expire after 24h'],
      rollback: 'Revert commit abc123'
    }, tmp);
    expect(r.success).toBe(true);
    expect(r.id).toBeDefined();
    expect(fs.existsSync(r.output_file)).toBe(true);
  });

  it('createPRPackage rejects missing title', () => {
    const r = lib().createPRPackage({ summary: 'x' }, tmp);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/title/);
  });

  it('createPRPackage includes changes in markdown', () => {
    const r = lib().createPRPackage({ title: 'T', summary: 'S', changes: ['file-a.js', 'file-b.js'] }, tmp);
    const content = fs.readFileSync(r.output_file, 'utf8');
    expect(content).toContain('file-a.js');
    expect(content).toContain('file-b.js');
  });

  it('createPRPackage includes rollback guidance', () => {
    const r = lib().createPRPackage({ title: 'T', summary: 'S', rollback: 'git revert HEAD' }, tmp);
    const content = fs.readFileSync(r.output_file, 'utf8');
    expect(content).toContain('git revert HEAD');
  });

  it('createPRPackage includes linked stories', () => {
    const r = lib().createPRPackage({ title: 'T', summary: 'S', linked_stories: ['E1-S1', 'M1-T01'] }, tmp);
    const content = fs.readFileSync(r.output_file, 'utf8');
    expect(content).toContain('E1-S1');
    expect(content).toContain('M1-T01');
  });

  it('listPRPackages returns created packages', () => {
    lib().createPRPackage({ title: 'A', summary: 'S' }, tmp);
    lib().createPRPackage({ title: 'B', summary: 'S' }, tmp);
    const r = lib().listPRPackages(tmp);
    expect(r.total).toBe(2);
  });

  it('listPRPackages returns empty for fresh dir', () => {
    const r = lib().listPRPackages(tmp);
    expect(r.total).toBe(0);
  });

  it('exportPRPackage returns content string', () => {
    const created = lib().createPRPackage({ title: 'T', summary: 'S' }, tmp);
    const exported = lib().exportPRPackage(created.id, tmp);
    expect(exported.success).toBe(true);
    expect(exported.content).toContain('# PR Work Package');
  });

  it('exportPRPackage returns error for missing id', () => {
    const r = lib().exportPRPackage('nonexistent', tmp);
    expect(r.success).toBe(false);
  });
});

// ─── 9. Multi-Agent Concurrent Execution ────────────────────────────────────

describe('parallel-agents', () => {
  let tmp;
  let opts;

  beforeEach(() => {
    tmp = makeTmpDir();
    opts = { stateFile: path.join(tmp, '.jumpstart', 'state', 'parallel-agents.json') };
  });
  afterEach(() => rmTmpDir(tmp));

  const lib = () => require('../bin/lib/parallel-agents');

  it('scheduleRun creates a run with all default agents', () => {
    const r = lib().scheduleRun([], { root: tmp }, opts);
    expect(r.success).toBe(true);
    expect(r.run_id).toBeDefined();
    expect(r.agents.length).toBe(lib().SIDECAR_AGENTS.length);
  });

  it('scheduleRun accepts subset of agents', () => {
    const r = lib().scheduleRun(['security', 'qa'], { root: tmp }, opts);
    expect(r.success).toBe(true);
    expect(r.agents).toEqual(['security', 'qa']);
  });

  it('scheduleRun rejects unknown agents', () => {
    const r = lib().scheduleRun(['wizard'], { root: tmp }, opts);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/No valid agents/);
  });

  it('recordAgentFindings updates agent status', () => {
    const run = lib().scheduleRun(['security'], { root: tmp }, opts);
    const findings = [{ type: 'vuln', message: 'SQL injection risk', severity: 'error', file: 'src/db.js' }];
    const r = lib().recordAgentFindings(run.run_id, 'security', findings, opts);
    expect(r.success).toBe(true);
    expect(r.findings_count).toBe(1);
  });

  it('recordAgentFindings fails for unknown run', () => {
    const r = lib().recordAgentFindings('bad-run', 'security', [], opts);
    expect(r.success).toBe(false);
  });

  it('reconcileRun merges findings across agents', () => {
    const run = lib().scheduleRun(['security', 'qa'], { root: tmp }, opts);
    lib().recordAgentFindings(run.run_id, 'security', [{ type: 'auth', message: 'M1', severity: 'error' }], opts);
    lib().recordAgentFindings(run.run_id, 'qa', [{ type: 'coverage', message: 'M2', severity: 'warning' }], opts);
    const r = lib().reconcileRun(run.run_id, opts);
    expect(r.success).toBe(true);
    expect(r.reconciliation.total_findings).toBe(2);
  });

  it('reconcileRun detects conflicts', () => {
    const run = lib().scheduleRun(['security', 'qa'], { root: tmp }, opts);
    lib().recordAgentFindings(run.run_id, 'security', [{ type: 'auth', message: 'M', severity: 'error', file: 'x.js' }], opts);
    lib().recordAgentFindings(run.run_id, 'qa', [{ type: 'auth', message: 'M', severity: 'warning', file: 'x.js' }], opts);
    const r = lib().reconcileRun(run.run_id, opts);
    expect(r.reconciliation.conflicts).toBeGreaterThan(0);
  });

  it('getRunStatus reflects completion', () => {
    const run = lib().scheduleRun(['docs'], { root: tmp }, opts);
    lib().recordAgentFindings(run.run_id, 'docs', [], opts);
    const status = lib().getRunStatus(run.run_id, opts);
    expect(status.success).toBe(true);
    expect(status.status).toBe('completed');
  });

  it('listRuns returns all scheduled runs', () => {
    lib().scheduleRun(['security'], { root: tmp }, opts);
    lib().scheduleRun(['qa'], { root: tmp }, opts);
    const r = lib().listRuns(opts);
    expect(r.total).toBe(2);
  });

  it('SIDECAR_AGENTS contains expected agents', () => {
    const agents = lib().SIDECAR_AGENTS;
    expect(agents).toContain('architect');
    expect(agents).toContain('security');
    expect(agents).toContain('qa');
    expect(agents).toContain('docs');
    expect(agents).toContain('performance');
  });
});

// ─── 10. Human Approval Workflows with Roles ────────────────────────────────

describe('role-approval', () => {
  let tmp;
  let opts;

  beforeEach(() => {
    tmp = makeTmpDir();
    opts = { stateFile: path.join(tmp, '.jumpstart', 'state', 'role-approvals.json') };
  });
  afterEach(() => rmTmpDir(tmp));

  const lib = () => require('../bin/lib/role-approval');

  it('assignApprovers creates a workflow', () => {
    const r = lib().assignApprovers('specs/prd.md', [
      { role: 'product', name: 'Alice', required: true },
      { role: 'architect', name: 'Bob', required: true }
    ], opts);
    expect(r.success).toBe(true);
    expect(r.approvers.length).toBe(2);
    expect(r.total_required).toBe(2);
  });

  it('assignApprovers rejects missing artifact path', () => {
    const r = lib().assignApprovers('', [], opts);
    expect(r.success).toBe(false);
  });

  it('assignApprovers rejects empty approvers array', () => {
    const r = lib().assignApprovers('specs/prd.md', [], opts);
    expect(r.success).toBe(false);
  });

  it('assignApprovers rejects invalid role', () => {
    const r = lib().assignApprovers('specs/prd.md', [{ role: 'wizard', name: 'X' }], opts);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Invalid role/);
  });

  it('recordRoleAction marks a role as approved', () => {
    lib().assignApprovers('specs/prd.md', [{ role: 'product', name: 'Alice', required: true }], opts);
    const r = lib().recordRoleAction('specs/prd.md', 'product', 'approve', { approverName: 'Alice', ...opts });
    expect(r.success).toBe(true);
    expect(r.workflow_status).toBe('approved');
  });

  it('recordRoleAction marks workflow as rejected', () => {
    lib().assignApprovers('specs/prd.md', [{ role: 'security', name: 'Carol', required: true }], opts);
    lib().recordRoleAction('specs/prd.md', 'security', 'reject', opts);
    const status = lib().getApprovalStatus('specs/prd.md', opts);
    expect(status.status).toBe('rejected');
  });

  it('getApprovalStatus reports pending roles', () => {
    lib().assignApprovers('specs/arch.md', [
      { role: 'architect', required: true },
      { role: 'security', required: true }
    ], opts);
    lib().recordRoleAction('specs/arch.md', 'architect', 'approve', opts);
    const r = lib().getApprovalStatus('specs/arch.md', opts);
    expect(r.pending_roles).toContain('security');
    expect(r.approved_roles).toContain('architect');
    expect(r.fully_approved).toBe(false);
  });

  it('getApprovalStatus returns has_workflow=false for unknown artifact', () => {
    const r = lib().getApprovalStatus('nonexistent.md', opts);
    expect(r.has_workflow).toBe(false);
  });

  it('workflow becomes fully_approved when all required roles approve', () => {
    lib().assignApprovers('specs/prd.md', [
      { role: 'product', required: true },
      { role: 'legal', required: true }
    ], opts);
    lib().recordRoleAction('specs/prd.md', 'product', 'approve', opts);
    lib().recordRoleAction('specs/prd.md', 'legal', 'approve', opts);
    const r = lib().getApprovalStatus('specs/prd.md', opts);
    expect(r.fully_approved).toBe(true);
    expect(r.status).toBe('approved');
  });

  it('optional roles do not block full approval', () => {
    lib().assignApprovers('specs/prd.md', [
      { role: 'product', required: true },
      { role: 'qa', required: false }  // optional
    ], opts);
    lib().recordRoleAction('specs/prd.md', 'product', 'approve', opts);
    const r = lib().getApprovalStatus('specs/prd.md', opts);
    expect(r.fully_approved).toBe(true);
  });

  it('listApprovalWorkflows returns all workflows', () => {
    lib().assignApprovers('specs/prd.md', [{ role: 'product', required: true }], opts);
    lib().assignApprovers('specs/arch.md', [{ role: 'architect', required: true }], opts);
    const r = lib().listApprovalWorkflows({}, opts);
    expect(r.total).toBe(2);
  });

  it('listApprovalWorkflows filters by status', () => {
    lib().assignApprovers('specs/prd.md', [{ role: 'product', required: true }], opts);
    lib().assignApprovers('specs/arch.md', [{ role: 'architect', required: true }], opts);
    lib().recordRoleAction('specs/prd.md', 'product', 'approve', opts);
    const r = lib().listApprovalWorkflows({ status: 'approved' }, opts);
    expect(r.total).toBe(1);
  });

  it('APPROVER_ROLES contains expected roles', () => {
    const roles = lib().APPROVER_ROLES;
    expect(roles).toContain('product');
    expect(roles).toContain('architect');
    expect(roles).toContain('security');
    expect(roles).toContain('legal');
    expect(roles).toContain('platform');
  });
});
