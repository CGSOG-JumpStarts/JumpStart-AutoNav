/**
 * test-paths-alias-smoke.test.ts — T1.1 acceptance gate.
 *
 * Asserts that the tsconfig `paths` alias `@lib/*` resolves correctly during
 * the strangler phase at BOTH layers:
 *
 *   1. tsc typecheck: tsconfig.json `paths` maps `@lib/*` to
 *      `bin/lib-ts/*` (preferred) then `bin/lib/*` (legacy). The import
 *      below would fail `tsc --noEmit` if the alias were misconfigured.
 *   2. Vitest runtime: vitest.config.js `resolve.alias` mirrors the
 *      tsconfig mapping so tests exercise the same resolution. Without
 *      it this import would throw at runtime even though tsc was happy.
 *
 * Real per-module testing happens in tests/test-<name>.test.{js,ts};
 * this is intentionally minimal — the alias and strict mode only.
 *
 * @see specs/decisions/adr-005-module-layout.md
 * @see specs/implementation-plan.md T1.1
 */

import { smokeIdentity, strictCheck } from '@lib/_smoke';
import { describe, expect, it } from 'vitest';

describe('paths alias smoke (T1.1 acceptance gate)', () => {
  it('resolves @lib/_smoke to bin/lib-ts/_smoke.ts via tsconfig + vitest alias', () => {
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
