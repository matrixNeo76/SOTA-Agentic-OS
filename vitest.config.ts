import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', '.next', 'mini-services'],
    // SQLite è single-writer: i test che toccano il DB non possono girare in parallelo.
    // Fase 1.1 — abilitato quando abbiamo introdotto test DB-backed (vector-store, graph-age, db-runtime).
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      include: [
        'src/lib/embeddings.ts',
        'src/lib/kernel/ltl-monitor.ts',
      ],
      exclude: ['src/lib/kernel/**/*.d.ts', 'tests/**'],
      // Soglie per i moduli testabili (embeddings + ltl-monitor)
      // Gli altri moduli kernel richiedono DB mocking esteso (Fase 19 beta)
      thresholds: {
        statements: 40,
        branches: 30,
        functions: 40,
        lines: 40,
      },
    },
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
