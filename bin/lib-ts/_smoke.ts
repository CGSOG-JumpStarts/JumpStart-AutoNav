/**
 * _smoke.ts — TypeScript build smoke module (T2.1 acceptance gate).
 *
 * The presence of this module proves three things at M0 acceptance:
 *   1. tsconfig.json strict-mode compilation succeeds (T1.1 gate)
 *   2. tsdown emits .js + .d.ts + sourcemap correctly (T2.1 gate)
 *   3. The strangler-phase path alias `@lib/*` resolves in test imports
 *
 * Once the first real port lands (T4.1.1, M2), this file may be deleted
 * or repurposed. Until then, it's the canary that proves the toolchain.
 *
 * @see specs/decisions/adr-001-build-tool.md
 * @see specs/decisions/adr-005-module-layout.md
 * @see specs/implementation-plan.md T1.1, T2.1
 */

/**
 * Returns the build-time string identifying which strangler-phase
 * file resolution served this module. Tests assert this signature
 * to prove the path alias is wired correctly.
 */
export function smokeIdentity(): { phase: 'strangler-ts'; version: 1 } {
  return { phase: 'strangler-ts', version: 1 };
}

/**
 * Demonstrates strict-mode type checking — would fail to compile if
 * `noImplicitAny` or `strict` were not set in tsconfig.
 */
export function strictCheck<T extends Record<string, unknown>>(input: T): keyof T {
  const keys = Object.keys(input) as Array<keyof T>;
  if (keys.length === 0) {
    throw new Error('strictCheck requires a non-empty object');
  }
  return keys[0] as keyof T;
}
