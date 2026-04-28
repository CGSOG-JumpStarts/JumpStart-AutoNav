/**
 * test-runners.test.ts — T4.6.x M7 cluster: simulation runners + handoff validator.
 *
 * Covers the three runner-cluster TS ports landed under cluster M7:
 *   - holodeck.ts       (T4.6.1) — listScenarios, setupTempProject,
 *                                   PHASE_CONFIG public-surface preservation
 *   - headless-runner.ts (T4.6.2) — HeadlessRunner class shape,
 *                                   AGENT_PHASES + DEFAULT_CONFIG constants
 *   - handoff-validator.ts (T4.6.x) — extractHandoffPayload,
 *                                   validateHandoff, generateHandoffReport,
 *                                   checkPhantomRequirements
 *
 * Test focus per task spec:
 *   - Public-surface preservation
 *   - ADR-012 redaction wiring (write a fixture with secret-shaped
 *     strings, read back, assert [REDACTED:...] markers present)
 *   - JSON shape validation (3-4 cases: __proto__, string root,
 *     array root, malformed sibling)
 *   - Path-safety (1-2 traversal-rejection tests)
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ValidationError } from '../bin/lib-ts/errors.js';
import * as handoffValidator from '../bin/lib-ts/handoff-validator.js';
import { AGENT_PHASES, DEFAULT_CONFIG } from '../bin/lib-ts/headless-runner.js';
import * as holodeck from '../bin/lib-ts/holodeck.js';
import { SimulationTracer } from '../bin/lib-ts/simulation-tracer.js';

const REPO_ROOT = path.resolve(__dirname, '..');
const HANDOFFS_DIR = path.join(REPO_ROOT, '.jumpstart', 'handoffs');
const FIXTURES_DIR = path.join(REPO_ROOT, 'tests', 'fixtures');

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'm7-runners-test-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────
// holodeck.ts — public surface preservation
// ─────────────────────────────────────────────────────────────────────────

describe('holodeck — public surface', () => {
  it('exports PHASE_CONFIG with the six legacy phases', () => {
    expect(Array.isArray(holodeck.PHASE_CONFIG)).toBe(true);
    expect(holodeck.PHASE_CONFIG.length).toBe(6);
    const names = holodeck.PHASE_CONFIG.map((p) => p.name);
    expect(names).toEqual(['scout', 'challenger', 'analyst', 'pm', 'architect', 'developer']);
  });

  it('listScenarios returns [] when scenariosDir is missing', () => {
    const result = holodeck.listScenarios({
      projectRoot: tmp,
      scenariosDir: path.join(tmp, 'does-not-exist'),
    });
    expect(result).toEqual([]);
  });

  it('listScenarios returns directory entries when scenariosDir exists', () => {
    const sdir = path.join(tmp, 'scenarios');
    mkdirSync(path.join(sdir, 'todo-app'), { recursive: true });
    mkdirSync(path.join(sdir, 'fizzbuzz'), { recursive: true });
    writeFileSync(path.join(sdir, 'README.md'), 'not-a-dir');
    const result = holodeck.listScenarios({ projectRoot: tmp, scenariosDir: sdir });
    expect(result.sort()).toEqual(['fizzbuzz', 'todo-app']);
  });

  it('setupTempProject rejects path-traversal scenario names', () => {
    expect(() => holodeck.setupTempProject('../escape', { projectRoot: tmp })).toThrow(
      ValidationError
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// headless-runner.ts — public surface preservation
// ─────────────────────────────────────────────────────────────────────────

describe('headless-runner — public surface', () => {
  it('AGENT_PHASES is the six-phase tuple in legacy order', () => {
    expect([...AGENT_PHASES]).toEqual([
      'scout',
      'challenger',
      'analyst',
      'pm',
      'architect',
      'developer',
    ]);
  });

  it('DEFAULT_CONFIG has the documented runtime defaults', () => {
    expect(DEFAULT_CONFIG.persona).toBe('compliant-user');
    expect(DEFAULT_CONFIG.maxTurns).toBe(50);
    expect(DEFAULT_CONFIG.reasoningEffort).toBe('medium');
    // Models can move with the model-router; just verify they exist as strings.
    expect(typeof DEFAULT_CONFIG.agentModel).toBe('string');
    expect(typeof DEFAULT_CONFIG.proxyModel).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// handoff-validator.ts — public surface
// ─────────────────────────────────────────────────────────────────────────

describe('handoff-validator — public surface', () => {
  it('exports the four named functions', () => {
    expect(typeof handoffValidator.extractHandoffPayload).toBe('function');
    expect(typeof handoffValidator.validateHandoff).toBe('function');
    expect(typeof handoffValidator.checkPhantomRequirements).toBe('function');
    expect(typeof handoffValidator.generateHandoffReport).toBe('function');
  });

  it('extractHandoffPayload extracts stories from the valid PRD fixture', () => {
    const prdPath = path.join(FIXTURES_DIR, 'valid', 'prd.md');
    const payload = handoffValidator.extractHandoffPayload(
      prdPath,
      'architect'
    ) as handoffValidator.PmToArchitectPayload;
    expect(Array.isArray(payload.user_stories)).toBe(true);
    expect(payload.user_stories.length).toBeGreaterThan(0);
    expect(payload.user_stories[0].id).toMatch(/^E\d+-S\d+$/);
  });

  it('extractHandoffPayload throws for missing artifact', () => {
    expect(() =>
      handoffValidator.extractHandoffPayload('/nonexistent/file.md', 'architect')
    ).toThrow(/Artifact not found/);
  });

  it('extractHandoffPayload throws for unknown target phase', () => {
    const prdPath = path.join(FIXTURES_DIR, 'valid', 'prd.md');
    expect(() => handoffValidator.extractHandoffPayload(prdPath, 'unknown')).toThrow(
      /Unknown target phase/
    );
  });

  it('checkPhantomRequirements detects phantoms vs traced IDs', () => {
    const result = handoffValidator.checkPhantomRequirements(
      {
        user_stories: [
          { id: 'E01-S01', title: '', acceptance_criteria: [] },
          { id: 'E01-S02', title: '', acceptance_criteria: [] },
        ],
      },
      'Implements E01-S01 and E01-S02. Also references E99-S01 and M5-T99 — phantoms.'
    );
    expect(result.phantoms).toContain('E99-S01');
    expect(result.phantoms).toContain('M5-T99');
    expect(result.traced).toContain('E01-S01');
    expect(result.traced).toContain('E01-S02');
  });

  it('generateHandoffReport returns a typed report shape', () => {
    const prdPath = path.join(FIXTURES_DIR, 'valid', 'prd.md');
    const report = handoffValidator.generateHandoffReport(prdPath, 'pm', 'architect', HANDOFFS_DIR);
    expect(report).toHaveProperty('transition');
    expect(report).toHaveProperty('schema');
    expect(report).toHaveProperty('payload_keys');
    expect(report).toHaveProperty('valid');
  });

  it('generateHandoffReport returns invalid for missing artifact', () => {
    const report = handoffValidator.generateHandoffReport(
      '/nonexistent.md',
      'pm',
      'architect',
      HANDOFFS_DIR
    );
    expect(report.valid).toBe(false);
    expect(report.errors[0]).toMatch(/extraction failed/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// handoff-validator.ts — JSON shape validation (M6 deep-validation pattern)
// ─────────────────────────────────────────────────────────────────────────

describe('handoff-validator — JSON shape validation', () => {
  function writeSchema(name: string, content: string): string {
    const dir = path.join(tmp, 'handoffs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, name), content);
    return dir;
  }

  it('rejects schema with __proto__ keys (prototype pollution)', () => {
    // Note: JSON.stringify drops __proto__ as a key; write the JSON
    // text literally so the parser sees it as an own enumerable key.
    const dir = writeSchema('evil.schema.json', '{"__proto__":{"polluted":true},"type":"object"}');
    const r = handoffValidator.validateHandoff({}, 'evil.schema.json', dir);
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/malformed|shape validation/i);
  });

  it('rejects schema with nested constructor key', () => {
    const dir = writeSchema(
      'nested-evil.schema.json',
      '{"type":"object","properties":{"x":{"constructor":"y"}}}'
    );
    const r = handoffValidator.validateHandoff({}, 'nested-evil.schema.json', dir);
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/malformed|shape validation/i);
  });

  it('rejects string-root JSON', () => {
    const dir = writeSchema('string.schema.json', JSON.stringify('just a string'));
    const r = handoffValidator.validateHandoff({}, 'string.schema.json', dir);
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/malformed|shape validation/i);
  });

  it('rejects array-root JSON', () => {
    const dir = writeSchema('array.schema.json', JSON.stringify(['not', 'an', 'object']));
    const r = handoffValidator.validateHandoff({}, 'array.schema.json', dir);
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/malformed|shape validation/i);
  });

  it('rejects malformed sibling (truncated JSON)', () => {
    const dir = writeSchema('broken.schema.json', '{"type": "object", '); // truncated
    const r = handoffValidator.validateHandoff({}, 'broken.schema.json', dir);
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/malformed|shape validation/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// handoff-validator.ts — Path-safety
// ─────────────────────────────────────────────────────────────────────────

describe('handoff-validator — path-safety', () => {
  it('rejects schema names containing traversal segments', () => {
    expect(() => handoffValidator.validateHandoff({}, '../../etc/passwd', HANDOFFS_DIR)).toThrow(
      ValidationError
    );
  });

  it('rejects absolute schema paths', () => {
    expect(() => handoffValidator.validateHandoff({}, '/etc/passwd', HANDOFFS_DIR)).toThrow(
      ValidationError
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// SimulationTracer — ADR-012 redaction wiring
// ─────────────────────────────────────────────────────────────────────────

describe('simulation-tracer — ADR-012 redaction', () => {
  it('redacts secret-shaped values when persisting reports', () => {
    const tracer = new SimulationTracer(tmp, 'redaction-test');
    tracer.startPhase('scout');
    // Inject a secret-shaped string by way of an error message — error
    // messages flow into the persisted report verbatim.
    const fakeToken = 'ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    tracer.logError(`Failed because GITHUB_TOKEN was set to ${fakeToken}`, 'scout');
    tracer.endPhase('scout', 'PASS');

    const reportPath = path.join(tmp, 'reports', 'tracer.json');
    tracer.saveReport(reportPath);

    expect(existsSync(reportPath)).toBe(true);
    const raw = readFileSync(reportPath, 'utf8');
    // Raw secret should not appear; redaction marker should
    expect(raw).not.toContain(fakeToken);
    expect(raw).toContain('[REDACTED:');
  });
});
