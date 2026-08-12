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
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // The DCS-BIOS worker is a second, independently-loadable main-
        // process entry point (spawned at runtime via worker_threads.Worker,
        // not imported) — see src/main/workerHost.ts and
        // src/main/dcsBios/connectionManager.ts, which resolve it by path
        // via join(__dirname, 'dcsBiosWorker.js').
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          dcsBiosWorker: resolve(__dirname, 'src/main/dcsBios/worker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // regionPicker is a second, independently-loadable preload — the
        // screen-region picker overlay (src/main/screenCapture.ts) is its
        // own ephemeral, non-deck-aware window with its own tiny
        // contextBridge surface, not the main app's, so it gets its own
        // preload bundle rather than growing index.ts's.
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          regionPicker: resolve(__dirname, 'src/preload/regionPicker.ts')
        }
      }
    }
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
