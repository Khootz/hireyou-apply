import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'apps/**/tests/**/*.test.ts',
      'packages/**/tests/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    setupFiles: ['./tests/setup.ts'],
    // Chrome startup/shutdown (PDF render suites) and pdfjs parsing run well
    // over the 10s/5s defaults when the full suite runs parallel on a loaded
    // machine — timeouts here flake, the assertions never do.
    hookTimeout: 30_000,
    testTimeout: 15_000,
  },
})
