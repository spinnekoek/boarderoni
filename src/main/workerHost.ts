import { Worker } from 'node:worker_threads'

// Every message across the host/worker boundary is one of these three
// shapes, regardless of which worker script is hosted. Payloads must be
// structured-clone-able (plain data — no functions, no class instances with
// methods) since they cross via postMessage.
type HostToWorker<TReq> = { kind: 'req'; id: string; payload: TReq }
type WorkerToHost<TRes, TPush> =
  | { kind: 'res'; id: string; ok: true; payload: TRes }
  | { kind: 'res'; id: string; ok: false; error: string }
  | { kind: 'push'; payload: TPush } // unsolicited — a live update stream

export interface WorkerHostOptions {
  // Absolute path to the *compiled* worker entry (electron-vite emits
  // main-process output as plain JS, in both dev and packaged builds —
  // resolve via join(__dirname, '<name>.js') so this works identically in
  // both).
  scriptPath: string
  // Passed as `workerData` on every (re)spawn, including a crash-triggered
  // respawn — static configuration only (e.g. { docsDir }), not live state.
  workerData?: unknown
  requestTimeoutMs?: number
}

interface PendingRequest<TRes> {
  resolve: (value: TRes) => void
  reject: (err: Error) => void
  timeout: NodeJS.Timeout
}

const DEFAULT_REQUEST_TIMEOUT_MS = 5000

// Generic host for a single long-lived worker_threads.Worker, shared by
// every high-intensity data-source integration (DCS-BIOS today, more
// later) so none of them has to reimplement thread lifecycle, correlated
// request/response, or crash recovery. One instance per distinct worker
// *kind*, NOT one per consumer — callers ref-count via acquire()/release()
// so N consumers (e.g. N EventSource instances across N rooms) share
// exactly one OS thread.
export class WorkerHost<TReq, TRes, TPush> {
  private readonly scriptPath: string
  private workerData: unknown
  private readonly requestTimeoutMs: number

  private worker: Worker | null = null
  private refCount = 0
  // Tracked PER WORKER INSTANCE (not a single shared flag) — deliberately.
  // teardown()/restart() terminate() a worker asynchronously; if a fresh
  // worker gets spawned (e.g. an immediate release()-then-acquire(), which
  // syncEventSources does when a producer's signature changes) before the
  // OLD worker's 'exit' event actually arrives, a shared boolean would
  // already be reset by the new spawn by the time that stale exit fires —
  // misreading a deliberate teardown as a crash, respawning AGAIN on top of
  // the already-correct new worker, and orphaning it. A WeakSet keyed by
  // the specific Worker object sidesteps that entirely: each worker's own
  // exit handler only ever asks "was *I* deliberately terminated," which
  // stays correct no matter what's happened to `this.worker` since.
  private readonly deliberatelyTerminating = new WeakSet<Worker>()
  private nextRequestId = 0
  private readonly pending = new Map<string, PendingRequest<TRes>>()
  private readonly pushHandlers = new Set<(push: TPush) => void>()
  private readonly restartHandlers = new Set<() => void>()

  constructor(options: WorkerHostOptions) {
    this.scriptPath = options.scriptPath
    this.workerData = options.workerData
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  }

  acquire(): void {
    this.refCount++
    if (this.refCount === 1) this.spawn()
  }

  release(): void {
    this.refCount = Math.max(0, this.refCount - 1)
    if (this.refCount === 0) this.teardown()
  }

  request(payload: TReq): Promise<TRes> {
    if (!this.worker) return Promise.reject(new Error('WorkerHost: no active worker (call acquire() first)'))
    const worker = this.worker
    const id = String(this.nextRequestId++)
    return new Promise<TRes>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`WorkerHost: request timed out after ${this.requestTimeoutMs}ms`))
      }, this.requestTimeoutMs)
      this.pending.set(id, { resolve, reject, timeout })
      const message: HostToWorker<TReq> = { kind: 'req', id, payload }
      worker.postMessage(message)
    })
  }

  subscribe(handler: (push: TPush) => void): () => void {
    this.pushHandlers.add(handler)
    return () => this.pushHandlers.delete(handler)
  }

  // Fires after the host has already respawned a crashed (or deliberately
  // restarted) worker — a fresh Worker, same-or-new workerData, no replay
  // of prior requests. Callers with worker-side state that must be rebuilt
  // (e.g. "which aircraft are registered") listen here to redo it.
  onRestart(handler: () => void): () => void {
    this.restartHandlers.add(handler)
    return () => this.restartHandlers.delete(handler)
  }

  // Deliberately respawns the worker, optionally with new workerData — used
  // when connection settings change and the running worker's own state
  // (open socket, cached docs) is no longer valid for the new config.
  // Distinct from acquire()/release(): doesn't touch refCount, no-ops if no
  // worker is currently running.
  restart(newWorkerData?: unknown): void {
    if (newWorkerData !== undefined) this.workerData = newWorkerData
    if (!this.worker) return
    this.deliberatelyTerminating.add(this.worker)
    void this.worker.terminate()
    // The respawn + onRestart firing happens in the 'exit' handler below,
    // the same path a crash recovery takes, so both cases look identical
    // to callers.
  }

  private spawn(): void {
    const worker = new Worker(this.scriptPath, { workerData: this.workerData })
    this.worker = worker

    worker.on('message', (message: WorkerToHost<TRes, TPush>) => {
      if (message.kind === 'push') {
        for (const handler of this.pushHandlers) handler(message.payload)
        return
      }
      const request = this.pending.get(message.id)
      if (!request) return
      this.pending.delete(message.id)
      clearTimeout(request.timeout)
      if (message.ok) request.resolve(message.payload)
      else request.reject(new Error(message.error))
    })

    worker.on('error', (err: Error) => this.handleExit(worker, err))
    worker.on('exit', (code) => this.handleExit(worker, null, code))
  }

  // Single funnel for both 'error' and 'exit' — always checks whether
  // `worker` is still `this.worker` first, so a stale event from an
  // instance that's already been superseded (by acquire()'s own spawn(), or
  // by an earlier exit event for this same worker already having
  // respawned) is a safe no-op instead of clobbering the actually-current
  // worker or double-respawning.
  private handleExit(worker: Worker, err: Error | null, code?: number): void {
    const wasDeliberate = this.deliberatelyTerminating.delete(worker)
    if (this.worker !== worker) return

    if (wasDeliberate) {
      this.worker = null
      if (this.refCount > 0) this.respawnAfterTeardown()
      return
    }

    this.rejectAllPending(err ?? new Error(`WorkerHost: worker exited unexpectedly (code ${code})`))
    this.worker = null
    if (this.refCount > 0) this.respawnAfterTeardown()
  }

  private respawnAfterTeardown(): void {
    this.spawn()
    for (const handler of this.restartHandlers) handler()
  }

  private rejectAllPending(err: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout)
      request.reject(err)
    }
    this.pending.clear()
  }

  private teardown(): void {
    if (!this.worker) return
    this.deliberatelyTerminating.add(this.worker)
    void this.worker.terminate()
    this.worker = null
    this.rejectAllPending(new Error('WorkerHost: released'))
  }
}
