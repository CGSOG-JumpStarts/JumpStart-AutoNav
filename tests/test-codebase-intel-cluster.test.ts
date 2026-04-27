/**
 * test-codebase-intel-cluster.test.ts — T4.4.1 Codebase-Intel cluster smoke tests.
 *
 * Coverage for the 6 ports landed together:
 *   - ast-edit-engine.ts: detectLanguage / analyzeStructure / validateEdit / countBrackets
 *   - codebase-retrieval.ts: indexProject / queryFiles
 *   - refactor-planner.ts: defaultState / createPlan / validatePlan / generateReport
 *   - safe-rename.ts: planRename / findReferences / validateRename
 *   - quality-graph.ts: scanQuality / analyzeFileMetrics / calculateOverallScore / generateReport
 *   - type-checker.ts: detectTypeChecker / parseTypeErrors / runTypeCheck
 *
 * @see bin/lib-ts/{ast-edit-engine,codebase-retrieval,refactor-planner,safe-rename,quality-graph,type-checker}.ts
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  analyzeStructure,
  countBrackets,
  detectLanguage,
  STRUCTURE_PATTERNS,
  SUPPORTED_LANGUAGES,
  validateEdit,
} from '../bin/lib-ts/ast-edit-engine.js';
import {
  FILE_PATTERNS,
  indexProject,
  queryFiles,
  RETRIEVABLE_TYPES,
} from '../bin/lib-ts/codebase-retrieval.js';
import {
  analyzeFileMetrics,
  COMPLEXITY_THRESHOLDS,
  calculateOverallScore,
  QUALITY_DIMENSIONS,
  generateReport as qualityReport,
  scanQuality,
} from '../bin/lib-ts/quality-graph.js';
import {
  createPlan,
  defaultState,
  generateReport,
  loadState,
  REFACTOR_TYPES,
  RISK_LEVELS,
  validatePlan,
} from '../bin/lib-ts/refactor-planner.js';
import {
  findReferences,
  planRename,
  REFERENCE_PATTERNS,
  validateRename,
} from '../bin/lib-ts/safe-rename.js';
import { detectTypeChecker, parseTypeErrors, runTypeCheck } from '../bin/lib-ts/type-checker.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'codebase-intel-test-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────
// ast-edit-engine.ts
// ─────────────────────────────────────────────────────────────────────────

describe('ast-edit-engine', () => {
  it('detectLanguage maps extensions; unknown returns null', () => {
    expect(detectLanguage('a.js')).toBe('javascript');
    expect(detectLanguage('a.ts')).toBe('typescript');
    expect(detectLanguage('a.md')).toBe('markdown');
    expect(detectLanguage('a.bin')).toBeNull();
  });

  it('SUPPORTED_LANGUAGES + STRUCTURE_PATTERNS catalog parity', () => {
    expect(SUPPORTED_LANGUAGES).toEqual(['javascript', 'typescript', 'json', 'yaml', 'markdown']);
    expect(STRUCTURE_PATTERNS.javascript.function_decl).toBeInstanceOf(RegExp);
    expect(STRUCTURE_PATTERNS.typescript.interface_decl).toBeInstanceOf(RegExp);
  });

  it('analyzeStructure enumerates JS function/class/const symbols', () => {
    const file = path.join(tmpRoot, 'a.js');
    writeFileSync(file, 'export function foo() {}\nclass Bar {}\nconst baz = 42;\n', 'utf8');
    const r = analyzeStructure(file);
    expect(r.success).toBe(true);
    expect(r.language).toBe('javascript');
    expect((r.symbols ?? []).map((s) => s.name).sort()).toEqual(['Bar', 'baz', 'foo']);
    expect(r.has_exports).toBe(true);
  });

  it('countBrackets returns delta counts', () => {
    expect(countBrackets('{[()]}').curly).toBe(0);
    expect(countBrackets('{{}').curly).toBe(1);
    expect(countBrackets('([').paren).toBe(1);
  });

  it('validateEdit rejects 0 and >1 occurrences', () => {
    const file = path.join(tmpRoot, 'b.js');
    writeFileSync(file, 'const a = 1;\nconst b = 2;\n', 'utf8');
    expect(validateEdit(file, 'NOTFOUND', 'x').success).toBe(false);
    writeFileSync(file, 'const x = 1;\nconst x = 2;\n', 'utf8');
    expect(validateEdit(file, 'const x', 'const y').success).toBe(false);
    writeFileSync(file, 'const x = 1;\n', 'utf8');
    const ok = validateEdit(file, 'const x = 1;', 'const y = 2;');
    expect(ok.success).toBe(true);
    expect(ok.safe).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// codebase-retrieval.ts
// ─────────────────────────────────────────────────────────────────────────

describe('codebase-retrieval', () => {
  it('RETRIEVABLE_TYPES + FILE_PATTERNS catalogs are exposed', () => {
    expect(RETRIEVABLE_TYPES).toContain('adrs');
    expect(RETRIEVABLE_TYPES).toContain('test-patterns');
    expect(FILE_PATTERNS.adrs).toContain('specs/decisions/*.md');
  });

  it('indexProject categorizes specs/ADRs/tests/configs/implementations', () => {
    mkdirSync(path.join(tmpRoot, 'specs', 'decisions'), { recursive: true });
    mkdirSync(path.join(tmpRoot, 'src'), { recursive: true });
    mkdirSync(path.join(tmpRoot, 'tests'), { recursive: true });
    writeFileSync(path.join(tmpRoot, 'specs', 'prd.md'), '# PRD');
    writeFileSync(path.join(tmpRoot, 'specs', 'decisions', 'adr-001.md'), '# ADR-001');
    writeFileSync(path.join(tmpRoot, 'src', 'index.ts'), 'export {}');
    writeFileSync(path.join(tmpRoot, 'tests', 'a.test.ts'), 'test');
    writeFileSync(path.join(tmpRoot, 'package.json'), '{}');

    const r = indexProject(tmpRoot);
    expect(r.success).toBe(true);
    expect(r.index.adrs.length).toBeGreaterThanOrEqual(1);
    expect(r.index.specs.length).toBeGreaterThanOrEqual(1);
    expect(r.index.implementations.length).toBeGreaterThanOrEqual(1);
    expect(r.index.configs.length).toBeGreaterThanOrEqual(1);
    expect(r.index['test-patterns'].length).toBeGreaterThanOrEqual(1);
  });

  it('queryFiles returns sorted matches with previews', () => {
    mkdirSync(path.join(tmpRoot, 'specs'), { recursive: true });
    writeFileSync(path.join(tmpRoot, 'specs', 'a.md'), 'magic_token here\nanother magic_token');
    writeFileSync(path.join(tmpRoot, 'specs', 'b.md'), 'no_match');
    const r = queryFiles(tmpRoot, 'magic_token');
    expect(r.success).toBe(true);
    expect(r.results?.[0]?.matches).toBeGreaterThan(0);
  });

  it('queryFiles returns success:false when query missing', () => {
    const r = queryFiles(tmpRoot, '');
    expect(r.success).toBe(false);
    expect(r.error).toContain('query');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// refactor-planner.ts
// ─────────────────────────────────────────────────────────────────────────

describe('refactor-planner', () => {
  let stateFile: string;

  beforeEach(() => {
    stateFile = path.join(tmpRoot, 'plans.json');
  });

  it('defaultState + REFACTOR_TYPES + RISK_LEVELS exposed', () => {
    const s = defaultState();
    expect(s.version).toBe('1.0.0');
    expect(s.plans).toEqual([]);
    expect(REFACTOR_TYPES).toContain('rename');
    expect(RISK_LEVELS).toContain('critical');
  });

  it('createPlan rejects missing fields and invalid type', () => {
    expect(createPlan({ name: '', type: 'rename' } as never, { stateFile }).success).toBe(false);
    expect(createPlan({ name: 'x', type: 'bogus' as never }, { stateFile }).success).toBe(false);
  });

  it('createPlan persists and assigns REF-NNN id', () => {
    const r = createPlan(
      { name: 'Test', type: 'rename', steps: ['step a', { description: 'b', risk: 'high' }] },
      { stateFile }
    );
    expect(r.success).toBe(true);
    expect(r.plan?.id).toMatch(/^REF-\d{3}$/);
    expect(r.plan?.steps).toHaveLength(2);
    expect(r.plan?.risk_level).toBe('high');

    const persisted = loadState(stateFile);
    expect(persisted.plans).toHaveLength(1);
  });

  it('validatePlan flags out-of-order dependencies', () => {
    const created = createPlan(
      {
        name: 'P',
        type: 'move',
        steps: [
          { description: 's1' },
          { description: 's2', dependencies: [3] }, // depends on later step
        ],
      },
      { stateFile }
    );
    expect(created.plan).toBeDefined();
    const v = validatePlan(created.plan?.id ?? '', { stateFile });
    expect(v.success).toBe(true);
    expect(v.valid).toBe(false);
    expect(v.issues?.some((i) => i.type === 'invalid-order')).toBe(true);
  });

  it('generateReport rolls up by_type/active/completed', () => {
    createPlan({ name: 'A', type: 'rename' }, { stateFile });
    createPlan({ name: 'B', type: 'move' }, { stateFile });
    const rep = generateReport({ stateFile });
    expect(rep.success).toBe(true);
    expect(rep.total_plans).toBe(2);
    expect(rep.by_type.rename).toBe(1);
    expect(rep.by_type.move).toBe(1);
  });

  it('loadState soft-falls on prototype-pollution-shaped JSON root', () => {
    writeFileSync(stateFile, JSON.stringify({ __proto__: 'evil', plans: [] }), 'utf8');
    const s = loadState(stateFile);
    expect(s.plans).toEqual([]);
    expect(s.version).toBe('1.0.0');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// safe-rename.ts
// ─────────────────────────────────────────────────────────────────────────

describe('safe-rename', () => {
  it('REFERENCE_PATTERNS catalog exposed with import/markdown/config entries', () => {
    expect(REFERENCE_PATTERNS).toHaveLength(3);
    expect(REFERENCE_PATTERNS.map((p) => p.type).sort()).toEqual([
      'config-path',
      'import',
      'markdown-link',
    ]);
  });

  it('findReferences locates content occurrences across .ts/.md', () => {
    writeFileSync(path.join(tmpRoot, 'a.ts'), `import x from './old-mod';`);
    writeFileSync(path.join(tmpRoot, 'b.md'), `[link](./old-mod.ts)`);
    const refs = findReferences(tmpRoot, 'old-mod');
    expect(refs.length).toBeGreaterThanOrEqual(2);
  });

  it('planRename rejects missing args and missing source', () => {
    expect(planRename(tmpRoot, '', 'b').success).toBe(false);
    expect(planRename(tmpRoot, 'nonexistent.ts', 'b.ts').success).toBe(false);
  });

  it('planRename surfaces references_found + warnings >10', () => {
    writeFileSync(path.join(tmpRoot, 'src.ts'), 'export const a = 1;');
    // Make 11 ref-bearing files
    mkdirSync(path.join(tmpRoot, 'refs'), { recursive: true });
    for (let i = 0; i < 11; i++) {
      writeFileSync(path.join(tmpRoot, 'refs', `r${i}.ts`), `import './src';\nimport './src';\n`);
    }
    const r = planRename(tmpRoot, 'src.ts', 'dst.ts');
    expect(r.success).toBe(true);
    expect(r.references_found).toBeGreaterThan(10);
    expect(r.warnings?.length).toBeGreaterThan(0);
  });

  it('validateRename detects clean post-rename state', () => {
    writeFileSync(path.join(tmpRoot, 'new.ts'), 'export const a = 1;');
    const v = validateRename(tmpRoot, 'old.ts', 'new.ts');
    expect(v.new_file_exists).toBe(true);
    expect(v.old_file_removed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// quality-graph.ts
// ─────────────────────────────────────────────────────────────────────────

describe('quality-graph', () => {
  it('QUALITY_DIMENSIONS + COMPLEXITY_THRESHOLDS exposed', () => {
    expect(QUALITY_DIMENSIONS).toContain('complexity');
    expect(COMPLEXITY_THRESHOLDS.low.max_lines).toBe(200);
    expect(COMPLEXITY_THRESHOLDS.high.max_lines).toBe(1000);
  });

  it('analyzeFileMetrics computes counts + complexity_level', () => {
    const code =
      `// comment\nfunction f1() {}\nfunction f2() {}\n` + `// TODO: thing\nconst x = 1;\n`;
    const m = analyzeFileMetrics(code, '.js');
    expect(m.total_lines).toBeGreaterThan(0);
    expect(m.functions).toBeGreaterThanOrEqual(2);
    expect(m.todos).toBeGreaterThanOrEqual(1);
    expect(['low', 'medium', 'high', 'critical']).toContain(m.complexity_level);
  });

  it('calculateOverallScore clamps to [0, 100]', () => {
    const high = calculateOverallScore({
      total_lines: 50,
      code_lines: 40,
      comment_ratio: 20,
      functions: 5,
      max_nesting_depth: 2,
      todos: 0,
      long_lines: 0,
      imports: 0,
      complexity_level: 'low',
    });
    expect(high).toBe(100);

    const low = calculateOverallScore({
      total_lines: 1500,
      code_lines: 1400,
      comment_ratio: 0,
      functions: 60,
      max_nesting_depth: 12,
      todos: 30,
      long_lines: 50,
      imports: 30,
      complexity_level: 'critical',
    });
    expect(low).toBe(0);
  });

  it('scanQuality + generateReport produce roll-up shape', () => {
    writeFileSync(path.join(tmpRoot, 'a.js'), 'function a() { return 1; }\n');
    writeFileSync(path.join(tmpRoot, 'b.js'), 'function b() { return 2; }\n');
    const scan = scanQuality(tmpRoot);
    expect(scan.success).toBe(true);
    expect(scan.total_files).toBeGreaterThanOrEqual(2);

    const rep = qualityReport(scan);
    expect(rep.success).toBe(true);
    expect(rep.recommendations.length).toBeGreaterThan(0);
    expect(rep.by_complexity).toHaveProperty('low');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// type-checker.ts
// ─────────────────────────────────────────────────────────────────────────

describe('type-checker', () => {
  it('detectTypeChecker returns null when no config present', () => {
    expect(detectTypeChecker(tmpRoot)).toBeNull();
  });

  it('detectTypeChecker finds tsconfig.json -> TypeScript', () => {
    writeFileSync(path.join(tmpRoot, 'tsconfig.json'), '{}');
    const info = detectTypeChecker(tmpRoot);
    expect(info?.name).toBe('TypeScript');
    expect(info?.command).toContain('tsc');
  });

  it('detectTypeChecker reads pyproject.toml [tool.mypy]', () => {
    writeFileSync(path.join(tmpRoot, 'pyproject.toml'), '[tool.mypy]\nstrict = true\n');
    const info = detectTypeChecker(tmpRoot);
    expect(info?.name).toBe('mypy');
  });

  it('parseTypeErrors handles TypeScript and mypy formats', () => {
    const tsOut =
      `src/index.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.\n` +
      `src/main.py:20: error: Incompatible types  [assignment]\n`;
    const findings = parseTypeErrors(tsOut, 'TypeScript');
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(findings[0].code).toBe('TS2322');
    expect(findings[0].line).toBe(10);
  });

  it('runTypeCheck without checker returns pass:true with advisory', () => {
    const r = runTypeCheck({ root: tmpRoot });
    expect(r.pass).toBe(true);
    expect(r.checker).toBeNull();
    expect(r.message).toContain('No type checker');
  });
});
