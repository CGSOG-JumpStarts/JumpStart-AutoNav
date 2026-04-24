const path = require('node:path');
const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  // Mirror tsconfig `paths` at runtime so test code can import via `@lib/*`
  // and exercise the same alias that tsc resolves at typecheck. This is what
  // makes `tests/test-paths-alias-smoke.test.ts` an honest T1.1 gate rather
  // than a relative-path smoke. Order matches tsconfig: `bin/lib-ts` first,
  // legacy `bin/lib` as a fallback resolved via Node's normal resolution
  // (Vite's alias array tries each replacement until one resolves).
  resolve: {
    alias: [
      {
        find: /^@lib\/(.+)$/,
        replacement: path.resolve(__dirname, 'bin/lib-ts/$1'),
      },
    ],
  },
  test: {
    globals: true,
    root: '.',
    // Strangler-phase: include both .js (legacy) and .ts (ported + new TS tests).
    include: ['tests/**/*.test.{js,ts}'],
    exclude: [
      'tests/test-agent-intelligence.test.js', // Aggregate test that imports 20+ modules; covered by individual test files
    ],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      // `json-summary` produces coverage/coverage-summary.json which the
      // ratchet script reads. `text` keeps a human-readable summary in the
      // terminal. `html` is for local inspection (gitignored).
      reporter: ['text', 'json-summary', 'html'],
      // Strangler-phase: cover both legacy JS and ported TS sources.
      include: [
        'bin/lib/**/*.js',
        'bin/lib-ts/**/*.ts',
        'scripts/**/*.mjs',
      ],
      exclude: [
        'bin/cli.js',
        'bin/verify-diagrams.js',
        'bin/context7-setup.js',
        '**/_smoke.*', // M0 toolchain smoke; will be deleted at first real port
      ],
    },
  },
});
