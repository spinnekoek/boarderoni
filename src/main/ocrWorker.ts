// Runs entirely off the main thread (see src/main/workerHost.ts), same as
// screenCaptureWorker.ts. tesseract.js spawns its OWN internal
// worker_threads worker for the actual recognition work (see its
// spawnWorker for node), so this worker's own event loop stays free between
// requests — a nested worker, not a blocking call.
import { parentPort } from 'node:worker_threads'
import { join } from 'node:path'
import { createWorker } from 'tesseract.js'
import type { OcrWorkerRequest, OcrWorkerResponse } from './ocrMessages'

if (!parentPort) throw new Error('ocrWorker.ts must be run as a worker_threads Worker')
const port = parentPort

type HostToWorker = { kind: 'req'; id: string; payload: OcrWorkerRequest }
type WorkerToHost = { kind: 'res'; id: string; ok: true; payload: OcrWorkerResponse } | { kind: 'res'; id: string; ok: false; error: string }

// English language data is vendored into the repo (see resources/tesseract)
// rather than left at tesseract.js's default behavior of fetching it from a
// CDN on first use — this app needs to work fully offline. `langPath`
// pointing at a local directory (not a URL) makes tesseract.js read
// resources/tesseract/eng.traineddata.gz straight off disk instead.
// `cacheMethod: 'none'` skips tesseract.js's own on-disk re-cache of that
// same data — pointless when the source read is already a local file that
// never changes. tesseract.js-core's WASM core needs no equivalent
// configuration: in Node it's `require()`d directly from the installed
// tesseract.js-core package (see its own getCore.js), never fetched.
const LANG_PATH = join(__dirname, '../../resources/tesseract')

// Created once, on first request, and kept alive for the life of this
// worker — loading the WASM core + language data takes real time (well
// over a second cold), so paying that cost per request instead of once
// would make every OCR tick that much slower for no benefit.
let tesseractWorker: ReturnType<typeof createWorker> | null = null
function getTesseractWorker(): ReturnType<typeof createWorker> {
  if (!tesseractWorker) {
    tesseractWorker = createWorker('eng', undefined, { langPath: LANG_PATH, cacheMethod: 'none' })
  }
  return tesseractWorker
}

async function handle(payload: OcrWorkerRequest): Promise<OcrWorkerResponse> {
  const worker = await getTesseractWorker()
  const { data } = await worker.recognize(payload.jpeg)
  return { text: data.text }
}

port.on('message', (message: HostToWorker) => {
  if (message.kind !== 'req') return
  handle(message.payload)
    .then((result) => {
      const response: WorkerToHost = { kind: 'res', id: message.id, ok: true, payload: result }
      port.postMessage(response)
    })
    .catch((err: unknown) => {
      const response: WorkerToHost = { kind: 'res', id: message.id, ok: false, error: err instanceof Error ? err.message : String(err) }
      port.postMessage(response)
    })
})
