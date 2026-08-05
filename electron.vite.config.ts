import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// Computed once per process (dev server start, or once per `electron-vite
// build`) — every response during that run gets the same value (no
// unnecessary re-fetching within one live session), but a fresh run always
// gets a new one. Belt-and-suspenders alongside the no-store headers above:
// some kiosk WebViews (Fully Kiosk Browser in particular) cache aggressively
// enough to ignore Cache-Control entirely and survive a full app restart —
// a query string actually changes the URL, which even a cache that ignores
// headers can't serve a stale hit for.
const CACHE_BUST = randomUUID()

function cacheBustEntryScript(): Plugin {
  return {
    name: 'cache-bust-entry-script',
    transformIndexHtml(html) {
      return html.replace('src="./src/main.tsx"', `src="./src/main.tsx?v=${CACHE_BUST}"`)
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: 'src/renderer',
    server: {
      host: true,
      // Kiosk-mode WebViews (Fully Kiosk Browser in particular) have been
      // seen caching aggressively enough to survive a full app restart when
      // no cache directive is present — force every request in dev mode to
      // revalidate too, matching the same headers serveStatic sends for a
      // production build (see main/index.ts).
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache'
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer/src')
      }
    },
    build: {
      rollupOptions: {
        input: 'src/renderer/index.html'
      }
    },
    plugins: [react(), cacheBustEntryScript()]
  }
})
