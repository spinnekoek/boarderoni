// Throwaway worker script used only by workerHost.test.ts — echoes request
// payloads back (with the worker's own workerData attached) and pushes one
// greeting on startup, so the generic host's request/response, subscribe,
// and crash-restart paths can all be exercised without any DCS-BIOS code.
// Plain .mjs (not .ts) so Node can load it directly as a real
// worker_threads entry with no build/transform step involved.
import { parentPort, workerData } from 'node:worker_threads'

parentPort.postMessage({ kind: 'push', payload: { hello: workerData } })

parentPort.on('message', (msg) => {
  if (msg.kind !== 'req') return
  if (msg.payload && msg.payload.crash) {
    process.exit(1)
  }
  parentPort.postMessage({ kind: 'res', id: msg.id, ok: true, payload: { echo: msg.payload, workerData } })
})
