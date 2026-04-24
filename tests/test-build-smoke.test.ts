/**
 * test-build-smoke.test.ts — T2.1 acceptance gate.
 *
 * Asserts the tsdown build pipeline produces:
 *   1. Compiled JS module (dist/_smoke.mjs)
 *   2. Type declaration (dist/_smoke.d.mts)
 *   3. Source map (dist/_smoke.mjs.map)
 *   4. Importable + executable output that round-trips through the build
 *
 * @see specs/decisions/adr-001-build-tool.md
 * @see specs/implementation-plan.md T2.1
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(repoRoot, 'dist');

function exists(rel) {
  return fs.existsSync(path.join(distDir, rel));
}

describe('build smoke (T2.1 acceptance gate)', () => {
  beforeAll(() => {
    // execFileSync (not execSync) avoids shell interpolation — safe per the
    // codebase's child_process pattern guidance.
    execFileSync('npx', ['tsdown'], { cwd: repoRoot, stdio: 'pipe' });
  }, 60_000);

  it('emits dist/_smoke.mjs (compiled ES module)', () => {
    expect(exists('_smoke.mjs')).toBe(true);
  });

  it('emits dist/_smoke.d.mts (type declarations)', () => {
    expect(exists('_smoke.d.mts')).toBe(true);
    const dts = fs.readFileSync(path.join(distDir, '_smoke.d.mts'), 'utf8');
    expect(dts).toContain('smokeIdentity');
    expect(dts).toContain('strictCheck');
  });

  it('emits source map alongside compiled output', () => {
    expect(exists('_smoke.mjs.map')).toBe(true);
  });

  it('compiled output is importable + behaves identically to source', async () => {
    const built = await import(path.join(distDir, '_smoke.mjs'));
    const id = built.smokeIdentity();
    expect(id).toEqual({ phase: 'strangler-ts', version: 1 });
    expect(built.strictCheck({ alpha: 1 })).toBe('alpha');
  });
});
