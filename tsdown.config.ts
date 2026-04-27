/**
 * tsdown build configuration — pinned at 0.21.10 exact (per ADR-001).
 *
 * Emits ESM-compatible `dist/` output with .d.ts emission, source maps,
 * and shebang preservation on CLI entry points. During the strangler
 * phase (1.x) both `bin/lib-ts/*.ts` (ported) and `bin/lib/*.js` (legacy)
 * coexist; tsdown only compiles the .ts files.
 *
 * Fallback (per ADR-001 if tsdown is displaced mid-rewrite, ~2-3 days):
 *   tsc + tsc-alias + shell-script shebang post-step + .d.ts-parity
 *   verification against golden-master emit.
 */

import { defineConfig } from 'tsdown';

export default defineConfig({
  // Strangler phase entries. Each ported module goes here so:
  //   1. tsdown emits dist/<name>.{mjs,d.mts,mjs.map}
  //   2. check-dist-exports.mjs (T2.1 + Pit Crew QA gate) verifies the
  //      .d.mts surface matches the source export list
  //   3. T3.9 Tier 2 subprocess replay tests can run against the dist
  //      output once `bin/lib-ts/ipc.ts` lands
  entry: [
    'bin/lib-ts/_smoke.ts',
    'bin/lib-ts/errors.ts',
    'bin/lib-ts/path-safety.ts',
    'bin/lib-ts/io.ts',
    'bin/lib-ts/hashing.ts',
    'bin/lib-ts/timestamps.ts',
    'bin/lib-ts/locks.ts',
    'bin/lib-ts/diff.ts',
    'bin/lib-ts/versioning.ts',
    'bin/lib-ts/ambiguity-heatmap.ts',
    'bin/lib-ts/complexity.ts',
    'bin/lib-ts/context-chunker.ts',
    'bin/lib-ts/artifact-comparison.ts',
    'bin/lib-ts/ipc.ts',
    'bin/lib-ts/config-yaml.ts',
    // Future entries added per port:
    // 'src/cli/main.ts',         // Added at M8 (E3-S9 CLI dispatcher port)
    // 'src/bootstrap/init.ts',   // Added when bootstrap.js ports
  ],

  // Output to dist/ (gitignored). Post-2.0, package.json bin entries
  // point to dist/cli.js + dist/bootstrap/init.js.
  outDir: 'dist',

  // ESM output during strangler. CJS-compat is preserved by named exports.
  format: ['esm'],

  // Type declarations are mandatory (NFR-D02 machine-readable surface).
  dts: true,

  // Source maps for debugging post-port issues against original TS.
  sourcemap: true,

  // CommonJS shim for the strangler phase: lets `bin/cli.js` (CJS)
  // continue to require() the emitted .js files until M8 ports cli.js itself.
  platform: 'node',
  target: 'node22',

  // Preserve shebang on CLI entry points. ADR-001 + SEC-005 (post-build
  // assertion) guard this; if a release breaks shebang preservation, the
  // typescript.yml CI gate fails fast.
  // tsdown handles shebang preservation natively for files that start with #!
  // No additional config required as of 0.21.10.

  // Don't bundle node_modules — keep them as external imports.
  // Smaller dist/, faster builds, lets npm dedupe at install time.
  // (tsdown 0.21+: `external` deprecated; use `deps.neverBundle`.)
  deps: {
    neverBundle: [
      /^node:/,
      /^@biomejs/,
      /^@types\//,
      'chalk',
      'dotenv',
      'openai',
      'prompts',
      'yaml',
      'zod',
      'json-schema-to-zod',
      'commander',
      'tsdown',
      'vitest',
    ],
  },

  // Clean dist/ before each build to prevent stale .js / .d.ts files.
  clean: true,

  // Fail the build on any unresolved import. Catches typos before they ship.
  unbundle: false,
});
