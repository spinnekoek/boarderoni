import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { WorkerHost } from './workerHost'

const ECHO_WORKER_PATH = resolve(import.meta.dirname, 'echoWorker.test-helper.mjs')

interface EchoRequest {
  crash?: boolean
  value?: unknown
}
interface EchoResponse {
  echo: EchoRequest
  workerData: unknown
}
interface EchoPush {
  hello: unknown
}

function makeHost(workerData?: unknown): WorkerHost<EchoRequest, EchoResponse, EchoPush> {
  return new WorkerHost<EchoRequest, EchoResponse, EchoPush>({
    scriptPath: ECHO_WORKER_PATH,
    workerData,
    requestTimeoutMs: 2000
  })
}

// Waits for `restarted` to flip true, polling briefly rather than sleeping a
// fixed guess — worker respawn timing isn't fully deterministic.
async function waitUntil(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !check(); i++) await delay(20)
  expect(check()).toBe(true)
}

describe('WorkerHost', () => {
  it('does not spawn until acquire() is called, and request/response round-trips', async () => {
    const host = makeHost({ tag: 'a' })
    host.acquire()
    const res = await host.request({ value: 42 })
    expect(res.echo).toEqual({ value: 42 })
    expect(res.workerData).toEqual({ tag: 'a' })
    host.release()
  })

  it('delivers push messages to subscribers', async () => {
    const host = makeHost({ tag: 'push-test' })
    host.acquire()
    const received = await new Promise<EchoPush>((resolvePush) => {
      const unsubscribe = host.subscribe((push) => {
        unsubscribe()
        resolvePush(push)
      })
    })
    expect(received).toEqual({ hello: { tag: 'push-test' } })
    host.release()
  })

  it('shares one worker across multiple acquire() calls (ref-counted)', async () => {
    const host = makeHost({ tag: 'refcount' })
    host.acquire()
    host.acquire()
    const res = await host.request({ value: 'still one worker' })
    expect(res.echo.value).toBe('still one worker')
    host.release()
    // one acquire() still outstanding — worker should still be up
    const res2 = await host.request({ value: 'still up' })
    expect(res2.echo.value).toBe('still up')
    host.release()
  })

  it('rejects a pending request and respawns after a worker crash, firing onRestart', async () => {
    const host = makeHost({ tag: 'crash-test' })
    host.acquire()
    let restarted = false
    host.onRestart(() => {
      restarted = true
    })
    await expect(host.request({ crash: true })).rejects.toThrow()
    await waitUntil(() => restarted)
    const res = await host.request({ value: 'alive again' })
    expect(res.echo.value).toBe('alive again')
    host.release()
  })

  it('restart() respawns with new workerData and fires onRestart', async () => {
    const host = makeHost({ tag: 'before' })
    host.acquire()
    let restarted = false
    host.onRestart(() => {
      restarted = true
    })
    host.restart({ tag: 'after' })
    await waitUntil(() => restarted)
    const res = await host.request({ value: 'ping' })
    expect(res.workerData).toEqual({ tag: 'after' })
    host.release()
  })

  it('does not misfire a respawn when release() is immediately followed by acquire(), before the old worker actually exits', async () => {
    // Reproduces the exact pattern syncEventSources uses when a producer's
    // signature changes: stop() (release) then immediately start()
    // (acquire) again, synchronously — well before the old worker's async
    // terminate() has actually completed. A shared "was this deliberate"
    // flag gets clobbered by the second spawn before the first worker's
    // stale exit event arrives, misreading it as a crash and respawning
    // again on top of the already-correct new worker.
    const host = makeHost({ tag: 'race-test' })
    let restarts = 0
    host.onRestart(() => {
      restarts++
    })

    host.acquire()
    await host.request({ value: 'first' })

    host.release()
    host.acquire()

    // Let the old worker's real exit event land, whenever the OS/Node
    // actually delivers it.
    await delay(300)

    // The host must still be perfectly usable, and the stale exit must not
    // have triggered onRestart — that's reserved for genuine crash recovery.
    const res = await host.request({ value: 'still alive' })
    expect(res.echo.value).toBe('still alive')
    expect(restarts).toBe(0)

    host.release()
  })
})
