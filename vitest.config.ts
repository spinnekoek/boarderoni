import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Node-environment unit tests only (main-process/worker/shared logic) — the
// renderer has no tests yet, so there's no jsdom/happy-dom setup here.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  test: {
    environment: 'node',
    include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts']
  }
})
