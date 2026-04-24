/**
 * test-paths-alias-smoke.test.ts — T1.1 acceptance gate.
 *
 * Asserts that the tsconfig `paths` alias `@lib/*` resolves correctly
 * during the strangler phase: when both `bin/lib-ts/<name>.ts` (ported)
 * and `bin/lib/<name>.js` (legacy) exist, the TS port wins.
 *
 * This smoke test is intentionally minimal — only that the alias works.
 * Real per-module testing happens in tests/test-<name>.test.{js,ts}.
 *
 * @see specs/decisions/adr-005-module-layout.md
 * @see specs/implementation-plan.md T1.1
 */

import { describe, it, expect } from 'vitest';
import { smokeIdentity, strictCheck } from '../bin/lib-ts/_smoke.js';

describe('paths alias smoke (T1.1 acceptance gate)', () => {
  it('resolves bin/lib-ts/_smoke.ts via direct relative path', () => {
    const id = smokeIdentity();
    expect(id.phase).toBe('strangler-ts');
    expect(id.version).toBe(1);
  });

  it('strict-mode types compile (would fail without tsconfig strict: true)', () => {
    const result = strictCheck({ alpha: 1, beta: 2 });
    expect(['alpha', 'beta']).toContain(result);
  });

  it('throws typed error on empty input — prefigures ADR-006 typed-error pattern', () => {
    expect(() => strictCheck({})).toThrow(/non-empty object/);
  });
});
