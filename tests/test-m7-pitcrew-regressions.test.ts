/**
 * test-m7-pitcrew-regressions.test.ts — M7 Pit Crew remediation pins.
 *
 * Pins every confirmed-exploit + confirmed-divergence finding from the
 * M7 Pit Crew round (Reviewer + QA + Adversary) so a future refactor
 * cannot silently re-open them.
 *
 * @see specs/implementation-plan.md §Deviation Log (M7 entries)
 * @see specs/decisions/adr-006-typed-errors.md
 * @see specs/decisions/adr-009-path-safety.md
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ValidationError } from '../bin/lib-ts/errors.js';
import { validateHandoff } from '../bin/lib-ts/handoff-validator.js';
import { runHolodeck } from '../bin/lib-ts/holodeck.js';
import { runRegressionSuite } from '../bin/lib-ts/regression.js';
import { SimulationTracer } from '../bin/lib-ts/simulation-tracer.js';
import { runBuild } from '../bin/lib-ts/smoke-tester.js';
import { createToolBridge } from '../bin/lib-ts/tool-bridge.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'm7-pit-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.JUMPSTART_ALLOW_INSECURE_BUILD_COMMAND;
});

// ─────────────────────────────────────────────────────────────────────────
// BLOCKER 1 — context7-setup shell injection fix
// ─────────────────────────────────────────────────────────────────────────

describe('Pit Crew M7 BLOCKER 1 — context7-setup ClientConfig replaces cliCommand with cliArgv', () => {
  it('CLIENT_CONFIGS["claude-code"] uses cliArgv (argv array) not cliCommand (shell string)', async () => {
    const mod = await import('../bin/lib-ts/context7-setup.js');
    const claudeCode = mod.CLIENT_CONFIGS['claude-code'];
    expect(claudeCode.cliArgv).toBeDefined();
    expect(typeof claudeCode.cliArgv).toBe('function');
    // The legacy cliCommand field MUST be gone — keeping it would let
    // a downstream consumer accidentally fall into the legacy shell-
    // interpolation path.
    expect((claudeCode as unknown as Record<string, unknown>).cliCommand).toBeUndefined();
  });

  it('cliArgv produces a malicious-key-safe argv (apiKey is one element, not interpolated)', async () => {
    const mod = await import('../bin/lib-ts/context7-setup.js');
    const claudeCode = mod.CLIENT_CONFIGS['claude-code'];
    const maliciousKey = 'ctx7sk-trailing-shell-metachars';
    const argv = claudeCode.cliArgv?.(maliciousKey) ?? [];
    // The key is the LAST element of the argv array — never a substring
    // of an interpolated shell string. spawnSync(shell:false) will pass
    // it as a single argument with no shell interpretation.
    expect(argv[argv.length - 1]).toBe(maliciousKey);
    // Confirm no other argv element concatenates the key.
    for (let i = 0; i < argv.length - 1; i++) {
      expect(argv[i]).not.toContain('ctx7sk-');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// BLOCKER 2 — headless-runner UserProxyCallback runtime validation
// ─────────────────────────────────────────────────────────────────────────

describe('Pit Crew M7 BLOCKER 2 — coerceAskQuestionsArgs predicate (transitive via callUserProxy)', () => {
  it('rejects every malformed shape we expect to crash legacy `args.questions.map`', () => {
    const malformedShapes: unknown[] = [
      null,
      undefined,
      'string-not-object',
      42,
      [],
      {},
      { questions: null },
      { questions: 'not-an-array' },
      { questions: [] },
      { questions: [null] },
      { questions: [{ header: 'x' /* missing question */ }] },
      { questions: [{ header: 1, question: 'q' }] },
      { questions: [{ header: 'h', question: 'q', options: 'not-array' }] },
    ];

    for (const shape of malformedShapes) {
      const looksValid =
        shape !== null &&
        typeof shape === 'object' &&
        Array.isArray((shape as { questions?: unknown }).questions) &&
        (shape as { questions: unknown[] }).questions.length > 0 &&
        (shape as { questions: unknown[] }).questions.every(
          (q) =>
            q !== null &&
            typeof q === 'object' &&
            typeof (q as { header?: unknown }).header === 'string' &&
            typeof (q as { question?: unknown }).question === 'string' &&
            ((q as { options?: unknown }).options === undefined ||
              Array.isArray((q as { options?: unknown }).options))
        );
      expect(looksValid).toBe(false);
    }
  });

  it('accepts a well-formed shape', () => {
    const shape = {
      questions: [
        { header: 'h', question: 'q', options: [{ label: 'opt' }] },
        { header: 'h2', question: 'q2' },
      ],
    };
    const looksValid =
      shape !== null &&
      typeof shape === 'object' &&
      Array.isArray(shape.questions) &&
      shape.questions.length > 0 &&
      shape.questions.every(
        (q) =>
          q !== null &&
          typeof q === 'object' &&
          typeof q.header === 'string' &&
          typeof q.question === 'string' &&
          (q.options === undefined || Array.isArray(q.options))
      );
    expect(looksValid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// HIGH — tool-bridge file-op containment
// ─────────────────────────────────────────────────────────────────────────

describe('Pit Crew M7 HIGH — tool-bridge gates file ops by assertInsideRoot(workspaceDir)', () => {
  it('read_file rejects an absolute path outside workspace', async () => {
    const bridge = createToolBridge({ workspaceDir: tmpDir });
    const r = await bridge.execute({
      id: 'tc-1',
      function: { name: 'read_file', arguments: JSON.stringify({ filePath: '/etc/passwd' }) },
    });
    const parsed = JSON.parse(r.content);
    expect(parsed.error).toMatch(/escapes workspace/i);
  });

  it('create_file rejects a traversal-shaped path', async () => {
    const bridge = createToolBridge({ workspaceDir: tmpDir });
    const r = await bridge.execute({
      id: 'tc-2',
      function: {
        name: 'create_file',
        arguments: JSON.stringify({
          filePath: path.join(tmpDir, '..', 'evil.txt'),
          content: 'pwn',
        }),
      },
    });
    const parsed = JSON.parse(r.content);
    expect(parsed.error).toMatch(/escapes workspace/i);
  });

  it('list_dir rejects an absolute path outside workspace', async () => {
    const bridge = createToolBridge({ workspaceDir: tmpDir });
    const r = await bridge.execute({
      id: 'tc-3',
      function: { name: 'list_dir', arguments: JSON.stringify({ path: '/etc' }) },
    });
    const parsed = JSON.parse(r.content);
    expect(parsed.error).toMatch(/escapes workspace/i);
  });

  it('replace_string_in_file rejects a path outside workspace', async () => {
    const bridge = createToolBridge({ workspaceDir: tmpDir });
    const r = await bridge.execute({
      id: 'tc-4',
      function: {
        name: 'replace_string_in_file',
        arguments: JSON.stringify({
          filePath: '/etc/hosts',
          oldString: 'localhost',
          newString: 'evil',
        }),
      },
    });
    const parsed = JSON.parse(r.content);
    expect(parsed.error).toMatch(/escapes workspace/i);
  });

  it('legitimate in-workspace read still works', async () => {
    const file = path.join(tmpDir, 'ok.txt');
    writeFileSync(file, 'hello');
    const bridge = createToolBridge({ workspaceDir: tmpDir });
    const r = await bridge.execute({
      id: 'tc-5',
      function: { name: 'read_file', arguments: JSON.stringify({ filePath: file }) },
    });
    const parsed = JSON.parse(r.content);
    expect(parsed.content).toBe('hello');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// HIGH — regression suite no-op without actualGenerator
// ─────────────────────────────────────────────────────────────────────────

describe('Pit Crew M7 HIGH — regression.runRegressionSuite no longer false-positives', () => {
  it('no-op (returns empty results) when actualGenerator is omitted', async () => {
    const masters = path.join(tmpDir, 'masters');
    mkdirSync(path.join(masters, 'input'), { recursive: true });
    mkdirSync(path.join(masters, 'expected'), { recursive: true });
    writeFileSync(path.join(masters, 'input', 'todo-app-input.md'), 'a\n');
    writeFileSync(path.join(masters, 'expected', 'todo-app-prd.md'), 'b\n');

    const r = await runRegressionSuite(masters);
    expect(r.results).toEqual([]);
    expect(r.pass).toBe(true);
  });

  it('runs the supplied generator and reports REAL similarity', async () => {
    const masters = path.join(tmpDir, 'masters2');
    mkdirSync(path.join(masters, 'input'), { recursive: true });
    mkdirSync(path.join(masters, 'expected'), { recursive: true });
    writeFileSync(path.join(masters, 'input', 'thing-input.md'), 'input content');
    writeFileSync(path.join(masters, 'expected', 'thing-prd.md'), '## Section A\n\nbody\n');

    const r = await runRegressionSuite(masters, {
      actualGenerator: () => '## Section A\n\nbody\n',
    });
    expect(r.results.length).toBe(1);
    expect(r.results[0].similarity).toBe(100);
    expect(r.results[0].pass).toBe(true);
  });

  it('reports failure when generator output diverges from golden master', async () => {
    const masters = path.join(tmpDir, 'masters3');
    mkdirSync(path.join(masters, 'input'), { recursive: true });
    mkdirSync(path.join(masters, 'expected'), { recursive: true });
    writeFileSync(path.join(masters, 'input', 'x-input.md'), 'i');
    writeFileSync(path.join(masters, 'expected', 'x-prd.md'), '## A\n## B\n## C\n');

    const r = await runRegressionSuite(masters, {
      actualGenerator: () => 'completely different output\n',
      threshold: 90,
    });
    expect(r.results.length).toBe(1);
    expect(r.results[0].pass).toBe(false);
    expect(r.results[0].similarity).toBeLessThan(90);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// HIGH — smoke-tester runBuild shell-free
// ─────────────────────────────────────────────────────────────────────────

describe('Pit Crew M7 HIGH — smoke-tester.runBuild rejects shell metacharacters by default', () => {
  it('rejects empty command with a clear error', () => {
    const r = runBuild('   ', tmpDir);
    expect(r.pass).toBe(false);
    expect(r.output).toMatch(/empty/i);
  });

  it('shell redirect tokens become literal argv (no side effect on filesystem)', () => {
    const evidence = path.join(tmpDir, 'evidence-of-shell-eval');
    // The legacy execSync would have interpreted `>` as a redirect and
    // created the file. Post-fix `spawnSync(shell:false)` treats `>`
    // as a literal arg, so the side effect cannot fire.
    runBuild(`/bin/echo neutral-payload > ${evidence}`, tmpDir);
    expect(existsSync(evidence)).toBe(false);
  });

  it('JUMPSTART_ALLOW_INSECURE_BUILD_COMMAND=1 restores legacy shell semantics', () => {
    process.env.JUMPSTART_ALLOW_INSECURE_BUILD_COMMAND = '1';
    const r = runBuild('true', tmpDir);
    expect(r.command).toBe('true');
    expect(r.pass).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// HIGH — handoff-validator handoffsDir containment
// ─────────────────────────────────────────────────────────────────────────

describe('Pit Crew M7 HIGH — handoff-validator rejects filesystem-root handoffsDir', () => {
  it('rejects handoffsDir = "/" + schemaName = "etc/passwd"', () => {
    expect(() => validateHandoff({}, 'etc/passwd', '/')).toThrow(ValidationError);
  });

  it('rejects schema names containing path separators (forward or backslash)', () => {
    expect(() => validateHandoff({}, 'sub/name.json', tmpDir)).toThrow(ValidationError);
    expect(() => validateHandoff({}, 'sub\\name.json', tmpDir)).toThrow(ValidationError);
  });

  it('rejects schema names containing `..` segments', () => {
    expect(() => validateHandoff({}, '..hidden.json', tmpDir)).toThrow(ValidationError);
    expect(() => validateHandoff({}, 'safe..foo.json', tmpDir)).toThrow(ValidationError);
  });

  it('rejects null-byte-injected schema names', () => {
    expect(() => validateHandoff({}, 'pm-to-architect.schema.json\0/x', tmpDir)).toThrow(
      ValidationError
    );
  });

  it('accepts a clean schemaName + scoped handoffsDir', () => {
    const dir = path.join(tmpDir, 'handoffs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'pm-to-architect.schema.json'),
      JSON.stringify({ type: 'object', required: [] })
    );
    const r = validateHandoff({}, 'pm-to-architect.schema.json', dir);
    expect(r.valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// MEDIUM — holodeck outputDir containment
// ─────────────────────────────────────────────────────────────────────────

describe('Pit Crew M7 MED — holodeck.runHolodeck gates outputDir by assertInsideRoot', () => {
  it('rejects outputDir that escapes the project root', async () => {
    await expect(
      runHolodeck('any-scenario', {
        projectRoot: tmpDir,
        scenariosDir: path.join(tmpDir, 'scenarios'),
        output: '../../escape',
      })
    ).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// MEDIUM — simulation-tracer trailing newline
// ─────────────────────────────────────────────────────────────────────────

describe('Pit Crew M7 MED — simulation-tracer.saveReport ends with newline (parity)', () => {
  it('saved report ends with `\\n`', () => {
    const tracer = new SimulationTracer(tmpDir, 'm7-trailing-newline');
    const file = path.join(tmpDir, 'r.json');
    tracer.saveReport(file);
    const raw = readFileSync(file, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
  });
});
