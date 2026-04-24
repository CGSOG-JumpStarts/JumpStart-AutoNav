const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
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
