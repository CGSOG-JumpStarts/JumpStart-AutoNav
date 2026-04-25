#!/usr/bin/env node
/**
 * check-return-shapes.mjs — T3.6 + KU-04 QUALIFIED enforcement.
 *
 * AST linter enforcing **machine-readable return shapes** on exported
 * functions whose return type is an inline object literal with more than
 * 2 fields. The rule per KU-04: such returns should be named (so
 * downstream consumers can `import { Foo } from "..."`) OR carry a JSDoc
 * `@returns {{ shape }}` annotation that survives to the .d.ts.
 *
 * Why >2 fields? Small return literals (`{ ok, value }`, `{ x, y }`) are
 * fine inline. The threshold catches cases where the API surface really
 * deserves its own named type for clarity, refactor-safety, and IPC
 * envelope renderers that pretty-print the type by name.
 *
 * Walks: `dist/**\/*.d.ts` (post-tsdown emit). Dormant pattern: until the
 * first port lands, dist/ has only _smoke.d.mts whose exports both
 * return ≤2-field literals or non-literals — script reports 0 violations
 * trivially. Once ports begin, any new export with a fat inline return
 * trips the gate.
 *
 * Out of scope (intentional, per KU-04 QUALIFIED scope):
 *   - Argument-shape rules (separate concern; addressed by check-public-any)
 *   - Implicit `any` returns (already caught by `noImplicitAny` + tsc)
 *   - Promise<T> wrappers — we unwrap and check T
 *
 * @see specs/implementation-plan.md T3.6
 * @see specs/decisions/adr-006-error-model.md
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

const ROOT = 'dist';
const FIELD_THRESHOLD = 2;

if (!existsSync(ROOT)) {
  console.log('[check-return-shapes] dormant: dist/ not built yet (run `npm run build`).');
  process.exit(0);
}

function* walkDts(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkDts(full);
    } else if (entry.isFile() && /\.d\.m?ts$/.test(entry.name)) {
      yield full;
    }
  }
}

const violations = [];
let scanned = 0;

for (const file of walkDts(ROOT)) {
  if (!statSync(file).isFile()) continue;
  scanned++;
  const source = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  function unwrap(typeNode) {
    // Promise<T>, Awaited<T>, etc. — unwrap one level so async functions
    // get checked against their resolved shape, not the wrapper.
    if (
      ts.isTypeReferenceNode(typeNode) &&
      ts.isIdentifier(typeNode.typeName) &&
      ['Promise', 'Awaited'].includes(typeNode.typeName.text) &&
      typeNode.typeArguments &&
      typeNode.typeArguments.length === 1
    ) {
      return unwrap(typeNode.typeArguments[0]);
    }
    return typeNode;
  }

  function checkReturn(name, line, returnType) {
    if (!returnType) return; // tsc will have resolved any inferred returns
    const unwrapped = unwrap(returnType);
    if (!ts.isTypeLiteralNode(unwrapped)) return; // named type, union, primitive — OK
    const members = unwrapped.members.filter(
      (m) => ts.isPropertySignature(m) || ts.isMethodSignature(m)
    );
    if (members.length <= FIELD_THRESHOLD) return; // small literal — OK
    violations.push({
      file: path.relative('.', file),
      line,
      symbol: name,
      fieldCount: members.length,
      threshold: FIELD_THRESHOLD,
    });
  }

  function lineOf(node) {
    return ts.getLineAndCharacterOfPosition(sf, node.getStart(sf)).line + 1;
  }

  function visit(node) {
    const isExport = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;

    if (ts.isFunctionDeclaration(node) && isExport && node.name && ts.isIdentifier(node.name)) {
      checkReturn(node.name.text, lineOf(node), node.type);
    }

    if (ts.isClassDeclaration(node) && isExport) {
      const className = node.name?.text ?? '<anonymous>';
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
          checkReturn(`${className}.${member.name.text}`, lineOf(member), member.type);
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
}

if (scanned === 0) {
  console.log('[check-return-shapes] dormant: no .d.ts files in dist/ yet.');
  process.exit(0);
}

if (violations.length === 0) {
  console.log(
    `[check-return-shapes] OK: ${scanned} .d.ts files scanned; no inline fat-literal return types found.`
  );
  process.exit(0);
}

console.error(
  '[check-return-shapes] FAIL: exported functions with inline >2-field return literals.'
);
console.error(
  'Per KU-04 QUALIFIED, fat return literals should be named types or carry JSDoc @returns annotations.'
);
console.error('');
for (const v of violations) {
  console.error(
    `  ${v.file}:${v.line}  ${v.symbol} returns ${v.fieldCount}-field inline literal (>${v.threshold})`
  );
}
process.exit(1);
