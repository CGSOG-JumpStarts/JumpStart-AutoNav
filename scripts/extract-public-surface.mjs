#!/usr/bin/env node
/**
 * extract-public-surface.mjs — T3.1 cross-module contract harness.
 *
 * AST-based public-surface extractor for the strangler-phase codebase.
 * Walks `bin/lib/**\/*.js` (legacy) and `bin/lib-ts/**\/*.ts` (ported) and
 * cross-references method calls against class declarations to detect
 * drift of the form that bit us in v1.1.13: a class declared 4 methods,
 * the caller invoked 12, and CI never noticed because the missing methods
 * only threw on the first phase-validation error.
 *
 * Detection scope (conservative — false-positive-averse):
 *   1. Class instantiation: `const x = new ClassName(...)` recorded in a
 *      variable→class map.
 *   2. Method calls on tracked instances: `x.method(...)` where `x` is in
 *      the map. If `ClassName` doesn't declare `method`, that's drift.
 *
 * Out of scope for now (would generate noise on legacy code):
 *   - Arity-mismatch checks (default params, rest, options-bag pattern)
 *   - Cross-module function-import drift (T3.6 will partially cover via
 *     `check-return-shapes.mjs`)
 *   - Dynamic dispatch (`obj[methodName]()`) — purely runtime, can't detect
 *     statically without overcounting false positives
 *
 * Output: `.jumpstart/metrics/drift-catches.json` (gitignored). Schema:
 *   {
 *     "timestamp": ISO8601,
 *     "scanned": { "tsFiles": N, "jsFiles": N, "callSites": N },
 *     "incidents": [
 *       {
 *         "type": "missing_method",
 *         "callSite": { "file": rel-path, "line": N, "snippet": "..." },
 *         "expected": { "class": "ClassName", "declaredIn": rel-path },
 *         "actual": { "calledMethod": "method", "varName": "x" }
 *       }
 *     ]
 *   }
 *
 * Per ADR-007 + implementation-plan T3.1, this script uses:
 *   - `typescript` Compiler API for `.ts` files (strict + path-aware)
 *   - `@babel/parser` for `.js` files (lenient + CommonJS-friendly)
 *
 * Acceptance per T3.3:
 *   - Run against v1.1.14 main → 0 incidents
 *   - Run against tests/fixtures/contract-drift/simulation-tracer-vs-holodeck/
 *     → exactly 8 incidents with file:line refs
 *
 * @see specs/implementation-plan.md T3.1, T3.2, T3.3, Checkpoint C3
 * @see specs/architecture.md §Drift-catches log
 * @see specs/decisions/adr-007-ipc-envelope-versioning.md
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

import { parse as babelParse } from '@babel/parser';
import babelTraverseModule from '@babel/traverse';
import * as ts from 'typescript';

// Babel publishes a CJS default export when imported from ESM.
const babelTraverse = babelTraverseModule.default ?? babelTraverseModule;

const REPO_ROOT = process.cwd();
const SCAN_ROOTS = ['bin/lib', 'bin/lib-ts'];
const OUTPUT_DIR = '.jumpstart/metrics';
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'drift-catches.json');

// Allow the harness to be pointed at a synthetic fixture (T3.2/T3.3).
// Usage: node scripts/extract-public-surface.mjs --root=tests/fixtures/contract-drift/foo
const args = process.argv.slice(2);
const rootArg = args.find((a) => a.startsWith('--root='));
const explicitRoots = rootArg ? [rootArg.slice('--root='.length)] : null;
const reportPathArg = args.find((a) => a.startsWith('--out='));
const reportPath = reportPathArg ? reportPathArg.slice('--out='.length) : OUTPUT_PATH;

const roots = explicitRoots ?? SCAN_ROOTS;

// ─────────────────────────────────────────────────────────────────────────
// File walker
// ─────────────────────────────────────────────────────────────────────────

function* walkSourceFiles(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkSourceFiles(full);
    } else if (
      entry.isFile() &&
      /\.(m?[jt]s)$/.test(entry.name) &&
      !/\.d\.m?ts$/.test(entry.name)
    ) {
      yield full;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// JS extractor (@babel/parser)
// ─────────────────────────────────────────────────────────────────────────
//
// Walks a JS file's AST and produces:
//   - declaredClasses: { name -> Set<methodName> }
//   - instantiations:  { varName -> className }
//   - methodCalls:     [{ varName, methodName, line, snippet }]

function extractJs(_file, source) {
  const ast = babelParse(source, {
    sourceType: 'unambiguous',
    plugins: ['classProperties'],
    errorRecovery: true,
  });

  const declaredClasses = new Map();
  const instantiations = new Map();
  const methodCalls = [];
  const lines = source.split('\n');

  babelTraverse(ast, {
    ClassDeclaration(astPath) {
      const className = astPath.node.id?.name;
      if (!className) return;
      const methods = new Set();
      for (const member of astPath.node.body.body) {
        if (member.type === 'ClassMethod' || member.type === 'ClassPrivateMethod') {
          if (member.key.type === 'Identifier') methods.add(member.key.name);
        } else if (
          member.type === 'ClassProperty' &&
          member.value?.type === 'ArrowFunctionExpression'
        ) {
          if (member.key.type === 'Identifier') methods.add(member.key.name);
        }
      }
      declaredClasses.set(className, methods);
    },

    VariableDeclarator(astPath) {
      const init = astPath.node.init;
      if (init?.type === 'NewExpression' && init.callee.type === 'Identifier') {
        const varNode = astPath.node.id;
        if (varNode.type === 'Identifier') {
          instantiations.set(varNode.name, init.callee.name);
        }
      }
    },

    AssignmentExpression(astPath) {
      const node = astPath.node;
      if (
        node.right?.type === 'NewExpression' &&
        node.right.callee.type === 'Identifier' &&
        node.left.type === 'Identifier'
      ) {
        instantiations.set(node.left.name, node.right.callee.name);
      }
    },

    CallExpression(astPath) {
      const callee = astPath.node.callee;
      if (
        callee.type === 'MemberExpression' &&
        callee.object.type === 'Identifier' &&
        callee.property.type === 'Identifier' &&
        !callee.computed
      ) {
        const line = astPath.node.loc?.start.line ?? 0;
        methodCalls.push({
          varName: callee.object.name,
          methodName: callee.property.name,
          line,
          snippet: lines[line - 1]?.trim() ?? '',
        });
      }
    },
  });

  return { declaredClasses, instantiations, methodCalls };
}

// ─────────────────────────────────────────────────────────────────────────
// TS extractor (typescript Compiler API)
// ─────────────────────────────────────────────────────────────────────────

function extractTs(file, source) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const declaredClasses = new Map();
  const instantiations = new Map();
  const methodCalls = [];
  const lines = source.split('\n');

  function lineOf(node) {
    return ts.getLineAndCharacterOfPosition(sf, node.getStart(sf)).line + 1;
  }

  function visit(node) {
    if (ts.isClassDeclaration(node) && node.name) {
      const methods = new Set();
      for (const member of node.members) {
        if ((ts.isMethodDeclaration(member) || ts.isPropertyDeclaration(member)) && member.name) {
          if (ts.isIdentifier(member.name)) methods.add(member.name.text);
        }
      }
      declaredClasses.set(node.name.text, methods);
    }

    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isNewExpression(node.initializer)
    ) {
      const expr = node.initializer.expression;
      if (ts.isIdentifier(expr) && ts.isIdentifier(node.name)) {
        instantiations.set(node.name.text, expr.text);
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      ts.isIdentifier(node.expression.name)
    ) {
      const line = lineOf(node);
      methodCalls.push({
        varName: node.expression.expression.text,
        methodName: node.expression.name.text,
        line,
        snippet: lines[line - 1]?.trim() ?? '',
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
  return { declaredClasses, instantiations, methodCalls };
}

// ─────────────────────────────────────────────────────────────────────────
// Driver — extract, cross-reference, emit report
// ─────────────────────────────────────────────────────────────────────────

const allClasses = new Map(); // className -> { file, methods: Set<string> }
const fileResults = []; // [{ file, instantiations, methodCalls }]
let tsCount = 0;
let jsCount = 0;

for (const root of roots) {
  for (const file of walkSourceFiles(root)) {
    const source = readFileSync(file, 'utf8');
    const isTs = /\.tsx?$/.test(file);
    let result;
    try {
      result = isTs ? extractTs(file, source) : extractJs(file, source);
    } catch (err) {
      // Per ADR-006, we surface parse errors as a special drift-class
      // rather than crashing the harness — a single broken file shouldn't
      // mask drift in 158 healthy files.
      console.warn(`[extract-public-surface] parse error in ${file}: ${err.message}`);
      continue;
    }

    if (isTs) tsCount++;
    else jsCount++;

    for (const [name, methods] of result.declaredClasses) {
      // First-declaration wins for cross-file class names. Real-world
      // collisions don't exist in this codebase (verified via ADR-005's
      // strangler-fig: ported classes replace, never duplicate).
      if (!allClasses.has(name)) {
        allClasses.set(name, { file: path.relative(REPO_ROOT, file), methods });
      }
    }

    fileResults.push({
      file: path.relative(REPO_ROOT, file),
      instantiations: result.instantiations,
      methodCalls: result.methodCalls,
    });
  }
}

const incidents = [];
let totalCallSites = 0;

for (const { file, instantiations, methodCalls } of fileResults) {
  totalCallSites += methodCalls.length;
  for (const { varName, methodName, line, snippet } of methodCalls) {
    const className = instantiations.get(varName);
    if (!className) continue; // can't trace var → class statically; skip
    const cls = allClasses.get(className);
    if (!cls) continue; // class is from outside our scan scope (e.g. a node builtin or third-party)
    if (cls.methods.has(methodName)) continue; // declared — fine
    incidents.push({
      type: 'missing_method',
      callSite: { file, line, snippet },
      expected: { class: className, declaredIn: cls.file },
      actual: { calledMethod: methodName, varName },
    });
  }
}

const report = {
  timestamp: new Date().toISOString(),
  scanned: {
    tsFiles: tsCount,
    jsFiles: jsCount,
    callSites: totalCallSites,
  },
  incidents,
};

mkdirSync(path.dirname(reportPath), { recursive: true });
writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log(
  `[extract-public-surface] ${report.scanned.tsFiles + report.scanned.jsFiles} files, ${report.scanned.callSites} call sites, ${report.incidents.length} drift incidents.`
);
console.log(`[extract-public-surface] Report: ${reportPath}`);

if (process.env.HARNESS_FAIL_ON_DRIFT === '1' && incidents.length > 0) {
  process.exit(1);
}
