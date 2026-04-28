/**
 * test-testing-cluster.test.ts — T4.6.x M7 cluster: testing tools.
 *
 * Covers the seven testing-cluster TS ports landed under cluster M7:
 *   - tool-bridge.ts        (T4.6.3) — createToolBridge + execute dispatch
 *   - tool-schemas.ts       (T4.6.3) — getToolsForPhase + getToolByName
 *   - simulation-tracer.ts  (T4.6.3) — class shape + ADR-012 redaction
 *   - smoke-tester.ts       (T4.6.x) — detectProjectCommands + runBuild +
 *                                       checkHealth + runSmokeTest
 *   - regression.ts         (T4.6.x) — extractStructure + structuralDiff +
 *                                       computeSimilarityScore +
 *                                       runRegressionSuite +
 *                                       loadGoldenMaster path-safety
 *   - verify-diagrams.ts    (T4.6.x) — extractMermaidBlocks + validateBlock +
 *                                       detectDiagramType + run
 *   - context7-setup.ts     (T4.6.x) — validateApiKey + installForClient
 *                                       + JSON shape validation +
 *                                       ADR-012 redaction wiring
 *
 * Test focus per task spec:
 *   - Public-surface preservation
 *   - ADR-012 redaction wiring (write fixture with secret-shaped strings,
 *     read back, assert [REDACTED:...] markers present + raw secret absent)
 *   - JSON shape validation (3-4 cases: __proto__, string root, array root,
 *     malformed sibling)
 *   - Path-safety (1-2 traversal-rejection tests)
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as context7 from '../bin/lib-ts/context7-setup.js';
import { ValidationError } from '../bin/lib-ts/errors.js';
import * as regression from '../bin/lib-ts/regression.js';
import { SimulationTracer } from '../bin/lib-ts/simulation-tracer.js';
import * as smokeTester from '../bin/lib-ts/smoke-tester.js';
import { createToolBridge } from '../bin/lib-ts/tool-bridge.js';
import { getToolByName, getToolsForPhase } from '../bin/lib-ts/tool-schemas.js';
import * as verifyDiagrams from '../bin/lib-ts/verify-diagrams.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'm7-cluster-test-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeFile(rel: string, content: string): string {
  const full = path.join(tmp, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
  return full;
}

// ─────────────────────────────────────────────────────────────────────────
// tool-schemas.ts — public surface
// ─────────────────────────────────────────────────────────────────────────

describe('tool-schemas — public surface', () => {
  it('getToolByName returns null for unknown tools', () => {
    expect(getToolByName('does-not-exist')).toBeNull();
  });

  it('getToolByName returns a tool descriptor for read_file', () => {
    const t = getToolByName('read_file');
    expect(t).not.toBeNull();
    expect(t?.function.name).toBe('read_file');
  });

  it('getToolsForPhase returns BASE_TOOLS for unknown phases', () => {
    const tools = getToolsForPhase('not-a-phase');
    expect(Array.isArray(tools)).toBe(true);
    // Should include core file primitives (read_file, list_dir, etc.)
    const names = tools.map((t) => t.function.name);
    expect(names).toContain('read_file');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// tool-bridge.ts — public surface + ADR-012 redaction wiring
// ─────────────────────────────────────────────────────────────────────────

describe('tool-bridge — public surface', () => {
  it('createToolBridge returns the documented shape', () => {
    const bridge = createToolBridge({ workspaceDir: tmp });
    expect(typeof bridge.execute).toBe('function');
    expect(typeof bridge.getTodoState).toBe('function');
    expect(typeof bridge.getCallHistory).toBe('function');
    expect(bridge.getTodoState()).toEqual([]);
    expect(bridge.getCallHistory()).toEqual([]);
  });

  it('execute dispatches read_file and records call history', async () => {
    const target = writeFile('hello.txt', 'hello world');
    const bridge = createToolBridge({ workspaceDir: tmp });
    const out = await bridge.execute({
      function: { name: 'read_file', arguments: JSON.stringify({ filePath: target }) },
    });
    const parsed = JSON.parse(out.content) as { content: string };
    expect(parsed.content).toBe('hello world');
    expect(bridge.getCallHistory()).toHaveLength(1);
  });

  it('execute returns Unknown tool for missing handlers', async () => {
    const bridge = createToolBridge({ workspaceDir: tmp });
    const out = await bridge.execute({ function: { name: 'no_such_tool' } });
    const parsed = JSON.parse(out.content) as { error: string };
    expect(parsed.error).toMatch(/Unknown tool/);
  });

  it('execute respects dryRun for create_file', async () => {
    const target = path.join(tmp, 'new.txt');
    const bridge = createToolBridge({ workspaceDir: tmp, dryRun: true });
    const out = await bridge.execute({
      function: {
        name: 'create_file',
        arguments: JSON.stringify({ filePath: target, content: 'hi' }),
      },
    });
    const parsed = JSON.parse(out.content) as { dryRun?: boolean; success?: boolean };
    expect(parsed.dryRun).toBe(true);
    expect(existsSync(target)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// simulation-tracer.ts — public surface + ADR-012 redaction
// ─────────────────────────────────────────────────────────────────────────

describe('simulation-tracer — public surface', () => {
  it('SimulationTracer exposes the documented methods', () => {
    const t = new SimulationTracer(tmp, 'unit');
    expect(typeof t.startPhase).toBe('function');
    expect(typeof t.endPhase).toBe('function');
    expect(typeof t.logArtifact).toBe('function');
    expect(typeof t.logError).toBe('function');
    expect(typeof t.getReport).toBe('function');
    expect(typeof t.saveReport).toBe('function');
  });

  it('getReport returns a report shape with phases array', () => {
    const t = new SimulationTracer(tmp, 'unit');
    t.startPhase('scout');
    t.endPhase('scout', 'PASS');
    const r = t.getReport();
    expect(Array.isArray(r.phases)).toBe(true);
    expect(r.phases[0].name).toBe('scout');
    expect(r.phases[0].status).toBe('PASS');
  });

  it('saveReport redacts secret-shaped strings (ADR-012)', () => {
    const t = new SimulationTracer(tmp, 'unit');
    const fakeToken = 'ghp_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    t.logError(`pipeline failure: ${fakeToken}`, 'scout');
    const reportPath = path.join(tmp, 'reports', 'r.json');
    t.saveReport(reportPath);
    const raw = readFileSync(reportPath, 'utf8');
    expect(raw).not.toContain(fakeToken);
    expect(raw).toContain('[REDACTED:');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// smoke-tester.ts — public surface + path safety
// ─────────────────────────────────────────────────────────────────────────

describe('smoke-tester — public surface', () => {
  it('detectProjectCommands returns unknown for empty dirs', () => {
    const r = smokeTester.detectProjectCommands(tmp);
    expect(r.type).toBe('unknown');
    expect(r.build).toBeNull();
  });

  it('detectProjectCommands detects node + build/start scripts', () => {
    writeFile(
      'package.json',
      JSON.stringify({ scripts: { build: 'tsc', start: 'node dist/index.js' } })
    );
    const r = smokeTester.detectProjectCommands(tmp);
    expect(r.type).toBe('node');
    expect(r.build).toBe('npm run build');
    expect(r.start).toBe('npm start');
  });

  it('detectProjectCommands detects Go projects', () => {
    writeFile('go.mod', 'module example.com/x\n');
    const r = smokeTester.detectProjectCommands(tmp);
    expect(r.type).toBe('go');
    expect(r.build).toBe('go build ./...');
  });

  it('runBuild reports success for echo', () => {
    const r = smokeTester.runBuild('echo "hi"', tmp);
    expect(r.pass).toBe(true);
    expect(r.exit_code).toBe(0);
    expect(r.output).toContain('hi');
  });

  it('runBuild reports failure for false', () => {
    const r = smokeTester.runBuild('false', tmp);
    expect(r.pass).toBe(false);
    expect(r.exit_code).not.toBe(0);
  });

  it('checkHealth reports failure for unreachable URL', async () => {
    const r = await smokeTester.checkHealth('http://localhost:19999/x', 1000);
    expect(r.pass).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('runSmokeTest skips health check when configured', async () => {
    writeFile('package.json', JSON.stringify({ scripts: { build: 'echo built' } }));
    const r = await smokeTester.runSmokeTest({
      root: tmp,
      config: { skip_health_check: true },
    });
    expect(r.pass).toBe(true);
    expect(r.build?.pass).toBe(true);
  });

  it('runSmokeTest fails on bad build', async () => {
    const r = await smokeTester.runSmokeTest({
      root: tmp,
      config: { build_command: 'false', skip_health_check: true },
    });
    expect(r.pass).toBe(false);
    expect(r.build?.pass).toBe(false);
  });
});

describe('smoke-tester — JSON shape validation', () => {
  it('rejects package.json with __proto__ key (returns unknown type)', () => {
    // Write a literal __proto__ key — JSON.stringify can't preserve it,
    // so we hand-write the file content.
    writeFile('package.json', '{"__proto__":{"polluted":true},"scripts":{"build":"x"}}');
    const r = smokeTester.detectProjectCommands(tmp);
    // Node detection succeeds (file exists) but scripts are dropped
    // because the safe parser refuses the prototype-pollution payload.
    expect(r.type).toBe('node');
    expect(r.build).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// regression.ts — public surface + path safety
// ─────────────────────────────────────────────────────────────────────────

describe('regression — public surface', () => {
  it('exports DEFAULT_THRESHOLD = 85', () => {
    expect(regression.DEFAULT_THRESHOLD).toBe(85);
  });

  it('extractStructure parses frontmatter, sections, and counts', () => {
    const content = [
      '---',
      'id: test',
      'phase: 1',
      '---',
      '',
      '## Section A',
      '#### E01-S01: a',
      '#### E01-S02: b',
      '### Component: One',
      '',
      '| col | val |',
      '|-----|-----|',
      '| a   | b   |',
      '',
      '```js',
      'console.log(1);',
      '```',
      '',
    ].join('\n');
    const s = regression.extractStructure(content);
    expect(s.frontmatter?.id).toBe('test');
    expect(s.sections).toContain('Section A');
    expect(s.storyCount).toBe(2);
    expect(s.componentCount).toBe(1);
    expect(s.tables).toBeGreaterThan(0);
    expect(s.codeBlocks).toBe(1);
  });

  it('structuralDiff returns 100 for identical content', () => {
    const doc = '---\nid: x\n---\n\n## A\n\n## B\n';
    const d = regression.structuralDiff(doc, doc);
    expect(d.similarity).toBe(100);
    expect(d.differences).toHaveLength(0);
  });

  it('computeSimilarityScore drops below 100 for divergent content', () => {
    const a = '## Section A\n\n## Section B\n';
    const b = '## Section A\n\n## Section B\n\n## Section C\n';
    const score = regression.computeSimilarityScore(a, b);
    expect(score).toBeLessThan(100);
  });

  it('runRegressionSuite returns empty + pass=true for missing dir', async () => {
    const r = await regression.runRegressionSuite(path.join(tmp, 'no-dir'));
    expect(r.pass).toBe(true);
    expect(r.results).toEqual([]);
  });
});

describe('regression — path safety', () => {
  it('loadGoldenMaster rejects names with traversal segments', () => {
    expect(() => regression.loadGoldenMaster('../escape', tmp)).toThrow(ValidationError);
  });

  it('loadGoldenMaster rejects absolute names', () => {
    expect(() => regression.loadGoldenMaster('/etc/passwd', tmp)).toThrow(ValidationError);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// verify-diagrams.ts — public surface
// ─────────────────────────────────────────────────────────────────────────

describe('verify-diagrams — public surface', () => {
  it('detectDiagramType recognizes known types', () => {
    expect(verifyDiagrams.detectDiagramType('graph TD')).toBe('graph');
    expect(verifyDiagrams.detectDiagramType('sequenceDiagram')).toBe('sequenceDiagram');
    expect(verifyDiagrams.detectDiagramType('C4Context')).toBe('C4Context');
    expect(verifyDiagrams.detectDiagramType('not-a-type')).toBeNull();
  });

  it('extractMermaidBlocks finds fenced blocks with line ranges', () => {
    const content = [
      '# Title',
      '```mermaid',
      'graph TD',
      'A --> B',
      '```',
      '',
      'Some text.',
      '',
      '```mermaid',
      'sequenceDiagram',
      'participant A',
      '```',
    ].join('\n');
    const blocks = verifyDiagrams.extractMermaidBlocks(content);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].body).toContain('graph TD');
    expect(blocks[1].body).toContain('sequenceDiagram');
  });

  it('extractMermaidBlocks flags unclosed fences', () => {
    const content = '```mermaid\ngraph TD\nA --> B\n';
    const blocks = verifyDiagrams.extractMermaidBlocks(content);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].unclosed).toBe(true);
  });

  it('validateBlock rejects unclosed blocks', () => {
    const issues = verifyDiagrams.validateBlock({
      startLine: 1,
      endLine: 3,
      body: 'graph TD\nA --> B',
      unclosed: true,
    });
    expect(issues[0].level).toBe('error');
    expect(issues[0].message).toMatch(/Unclosed/);
  });

  it('validateBlock returns no issues for valid graph', () => {
    const issues = verifyDiagrams.validateBlock({
      startLine: 1,
      endLine: 4,
      body: 'graph TD\nA --> B\nB --> C',
    });
    expect(issues.filter((i) => i.level === 'error')).toHaveLength(0);
  });

  it('run returns exit code 2 when no markdown files found', () => {
    const out = verifyDiagrams.run([
      'node',
      'verify',
      '--dir',
      path.join(tmp, 'does-not-exist'),
      '--json',
    ]);
    expect(out.exitCode).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// context7-setup.ts — public surface
// ─────────────────────────────────────────────────────────────────────────

describe('context7-setup — public surface', () => {
  it('validateApiKey accepts ctx7sk- prefixed keys', () => {
    expect(context7.validateApiKey('ctx7sk-abcd1234')).toBe(true);
  });

  it('validateApiKey rejects keys without ctx7sk- prefix', () => {
    const r = context7.validateApiKey('not-prefixed-key');
    expect(typeof r).toBe('string');
    expect(r).toMatch(/Invalid format/);
  });

  it('validateApiKey rejects empty/non-string values', () => {
    expect(context7.validateApiKey('')).toMatch(/required/i);
    expect(context7.validateApiKey(null)).toMatch(/required/i);
    expect(context7.validateApiKey(undefined)).toMatch(/required/i);
  });

  it('validateApiKey rejects keys that are too short', () => {
    const r = context7.validateApiKey('ctx7sk-');
    expect(typeof r).toBe('string');
  });

  it('CLIENT_CONFIGS includes all five legacy clients', () => {
    const keys = Object.keys(context7.CLIENT_CONFIGS);
    expect(keys).toContain('vscode');
    expect(keys).toContain('cursor');
    expect(keys).toContain('claude-code');
    expect(keys).toContain('claude-desktop');
    expect(keys).toContain('windsurf');
  });

  it('installForClient writes a vscode mcp.json with the api key', () => {
    const r = context7.installForClient('vscode', 'ctx7sk-test1234567890', tmp);
    expect(r.success).toBe(true);
    const cfg = path.join(tmp, '.vscode', 'mcp.json');
    expect(existsSync(cfg)).toBe(true);
    const parsed = JSON.parse(readFileSync(cfg, 'utf8')) as Record<string, unknown>;
    expect(parsed.servers).toBeDefined();
  });

  it('installForClient rejects unknown clients', () => {
    const r = context7.installForClient('not-a-client', 'ctx7sk-1234567890', tmp);
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/Unknown client/);
  });
});

describe('context7-setup — JSON shape validation', () => {
  it('mergeJsonConfig backs up + replaces malformed configs (truncated JSON)', () => {
    // Pre-write a malformed config file
    const cfgPath = path.join(tmp, '.vscode', 'mcp.json');
    mkdirSync(path.dirname(cfgPath), { recursive: true });
    writeFileSync(cfgPath, '{"truncated":', 'utf8');
    const r = context7.installForClient('vscode', 'ctx7sk-test1234567890', tmp);
    expect(r.success).toBe(true);
    expect(existsSync(`${cfgPath}.bak`)).toBe(true);
  });

  it('mergeJsonConfig backs up configs with __proto__ pollution', () => {
    const cfgPath = path.join(tmp, '.vscode', 'mcp.json');
    mkdirSync(path.dirname(cfgPath), { recursive: true });
    // Write a literal __proto__ key (JSON.stringify can't preserve it)
    writeFileSync(cfgPath, '{"__proto__":{"polluted":true},"servers":{}}', 'utf8');
    const r = context7.installForClient('vscode', 'ctx7sk-test1234567890', tmp);
    expect(r.success).toBe(true);
    expect(existsSync(`${cfgPath}.bak`)).toBe(true);
  });
});

describe('context7-setup — ADR-012 redaction wiring', () => {
  it('redacts secret-shaped strings in pre-existing user config', () => {
    const cfgPath = path.join(tmp, '.vscode', 'mcp.json');
    mkdirSync(path.dirname(cfgPath), { recursive: true });
    const fakeToken = 'ghp_CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
    writeFileSync(
      cfgPath,
      JSON.stringify({
        userNote: `My old PAT was ${fakeToken}`,
        servers: {},
      }),
      'utf8'
    );
    const r = context7.installForClient('vscode', 'ctx7sk-test1234567890', tmp);
    expect(r.success).toBe(true);
    const after = readFileSync(cfgPath, 'utf8');
    // Old PAT must be redacted
    expect(after).not.toContain(fakeToken);
    expect(after).toContain('[REDACTED:');
    // New api key (intentional payload) must persist
    expect(after).toContain('ctx7sk-test1234567890');
  });
});
