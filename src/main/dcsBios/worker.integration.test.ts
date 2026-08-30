// Full round-trip check against the REAL compiled worker artifact (not a
// re-implementation) — list aircraft -> register -> synthetic "DCS-BIOS"
// UDP packets -> batched field push -> status. Requires `npm run build` to
// have produced out/main/dcsBiosWorker.js first (see electron.vite.config.ts's
// second main-process entry); skips with a clear message if it hasn't, so
// `npm test` alone doesn't fail confusingly for a fresh checkout.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import dgram from 'node:dgram'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WorkerHost } from '../workerHost'
import type { DcsBiosWorkerData, DcsBiosWorkerPush, DcsBiosWorkerRequest, DcsBiosWorkerResponse } from './messages'

const WORKER_PATH = resolve(__dirname, '../../../out/main/dcsBiosWorker.js')
const MULTICAST_ADDRESS = '239.255.50.11' // distinct from DCS-BIOS's real default, avoids colliding with a real install
const MULTICAST_PORT = 15010
const SEND_PORT = 17778 // distinct from DCS-BIOS's real default (7778)

// _ACFT_NAME lives in a separate, always-loaded MetadataStart.json in real
// DCS-BIOS installs — NOT inside each aircraft's own doc (confirmed against
// a real docs folder; see worker.ts's loadMetadataTable). Mirrored here so
// this test exercises the exact same two-file split the real worker expects.
const METADATA_START_DOC = {
  Metadata: {
    _ACFT_NAME: {
      category: 'Metadata',
      control_type: 'display',
      identifier: '_ACFT_NAME',
      description: 'Aircraft Name',
      inputs: [],
      outputs: [{ address: 0x0000, max_length: 6, suffix: '', type: 'string' }]
    }
  }
}

const HORNET_DOC = {
  UFC: {
    UFC_COMM1_CHANNEL_SELECT: {
      category: 'UFC',
      control_type: 'selector',
      identifier: 'UFC_COMM1_CHANNEL_SELECT',
      description: 'COMM1 Channel Select Knob',
      inputs: [],
      outputs: [{ address: 0x1000, mask: 0xff00, max_value: 3, shift_by: 8, suffix: '', type: 'integer' }]
    }
  },
  // Two fields packed into the SAME address via different bit masks —
  // mirrors a real, common DCS-BIOS pattern (e.g. the real Hornet packs
  // APU_READY_LT, APU_CONTROL_SW, and 6 other controls into one address).
  // Regression coverage for a bug where only one field per address survived.
  APU: {
    APU_CONTROL_SW: {
      category: 'APU',
      control_type: 'action',
      identifier: 'APU_CONTROL_SW',
      description: 'APU Control Switch, ON/OFF',
      // Verbatim shape of the real control's inputs (confirmed against an
      // actual DCS-BIOS install) — see docParser.test.ts's COMMAND_FIXTURE.
      inputs: [
        { description: 'switch to previous or next state', interface: 'fixed_step' },
        { description: 'set the switch position -- 0 = off, 1 = on', interface: 'set_state', max_value: 1 },
        { argument: 'TOGGLE', description: 'toggle switch state', interface: 'action' }
      ],
      outputs: [{ address: 0x2000, mask: 0x0100, max_value: 1, shift_by: 8, suffix: '', type: 'integer' }]
    },
    APU_READY_LT: {
      category: 'APU',
      control_type: 'led',
      identifier: 'APU_READY_LT',
      description: 'APU Ready Light (green)',
      inputs: [],
      outputs: [{ address: 0x2000, mask: 0x0800, max_value: 1, shift_by: 11, suffix: '', type: 'integer' }]
    }
  }
}

function u16le(bytes: number[], value: number): void {
  bytes.push(value & 0xff, (value >> 8) & 0xff)
}

function buildPacket(runs: { address: number; words: number[] }[]): Buffer {
  const bytes: number[] = [0x55, 0x55, 0x55, 0x55]
  for (const run of runs) {
    u16le(bytes, run.address)
    u16le(bytes, run.words.length * 2)
    for (const word of run.words) u16le(bytes, word)
  }
  return Buffer.from(bytes)
}

function asciiWords(text: string): number[] {
  const padded = text.padEnd(Math.ceil(text.length / 2) * 2, '\0')
  const words: number[] = []
  for (let i = 0; i < padded.length; i += 2) {
    words.push(padded.charCodeAt(i) | (padded.charCodeAt(i + 1) << 8))
  }
  return words
}

async function waitUntil(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now()
  while (!check() && Date.now() - start < timeoutMs) await delay(25)
  expect(check()).toBe(true)
}

const hasBuiltWorker = existsSync(WORKER_PATH)

describe.skipIf(!hasBuiltWorker)('dcsBios worker (integration, real compiled artifact)', () => {
  let docsDir: string
  let host: WorkerHost<DcsBiosWorkerRequest, DcsBiosWorkerResponse, DcsBiosWorkerPush>
  let sender: dgram.Socket
  let commandListener: dgram.Socket

  beforeAll(async () => {
    docsDir = mkdtempSync(join(tmpdir(), 'dcsbios-test-'))
    writeFileSync(join(docsDir, 'Hornet.json'), JSON.stringify(HORNET_DOC), 'utf-8')
    writeFileSync(join(docsDir, 'MetadataStart.json'), JSON.stringify(METADATA_START_DOC), 'utf-8')
    // Decoys — confirms listAircraft() excludes known shared/infrastructure
    // doc files rather than listing them as if they were pickable aircraft
    // (a real docs folder always has these alongside real aircraft files).
    // CommonData.json is the one exception — see listAircraft()'s own
    // comment — so it's asserted as present below, not excluded like the
    // other two.
    writeFileSync(join(docsDir, 'CommonData.json'), '{}', 'utf-8')
    writeFileSync(join(docsDir, 'AircraftAliases.json'), '{}', 'utf-8')
    writeFileSync(join(docsDir, 'MetadataEnd.json'), '{}', 'utf-8')

    const workerData: DcsBiosWorkerData = { docsDir, multicastAddress: MULTICAST_ADDRESS, multicastPort: MULTICAST_PORT, sendPort: SEND_PORT }
    host = new WorkerHost({ scriptPath: WORKER_PATH, workerData, requestTimeoutMs: 5000 })
    host.acquire()

    sender = dgram.createSocket('udp4')

    // Listens on the same port the worker broadcasts commands to, so the
    // sendCommand test can verify the ACTUAL wire bytes leaving the worker,
    // not just that the request resolved without error.
    commandListener = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    await new Promise<void>((res) => commandListener.bind(SEND_PORT, res))
  })

  afterAll(() => {
    sender.close()
    commandListener.close()
    host.release()
    rmSync(docsDir, { recursive: true, force: true })
  })

  it('lists the installed aircraft from the docs folder', async () => {
    const res = await host.request({ type: 'listAircraft' })
    expect(res).toEqual({
      type: 'aircraftList',
      aircraft: [
        { id: 'CommonData', name: 'Common Data' },
        { id: 'Hornet', name: 'Hornet' }
      ]
    })
  })

  it('parses and flattens the field catalog', async () => {
    const res = await host.request({ type: 'getFieldCatalog', aircraft: 'Hornet' })
    expect(res.type).toBe('fieldCatalog')
    if (res.type !== 'fieldCatalog') return
    const channelSelect = res.fields.find((f) => f.key === 'UFC_COMM1_CHANNEL_SELECT')
    expect(channelSelect).toMatchObject({ valueType: 'integer', mask: 0xff00, maxValue: 3, shiftBy: 8 })
    // _ACFT_NAME deliberately isn't here — it lives in MetadataStart.json,
    // loaded separately (see loadMetadataTable in worker.ts), not as part of
    // any individual aircraft's own catalog.
    expect(res.fields.some((f) => f.key === '_ACFT_NAME')).toBe(false)
  })

  it('decodes live UDP traffic into a batched field push once registered, and tracks the active aircraft', async () => {
    await host.request({ type: 'registerAircraft', aircraft: 'Hornet' })

    const pushes: DcsBiosWorkerPush[] = []
    const unsubscribe = host.subscribe((push) => pushes.push(push))

    // Sent as plain unicast to 127.0.0.1 rather than the multicast group —
    // the worker's socket is bound to 0.0.0.0 on this port, so it receives
    // unicast traffic on that port regardless of multicast membership. Same
    // decode path, avoids depending on multicast actually routing in this
    // environment.
    const packet = buildPacket([
      { address: 0x0000, words: asciiWords('Hornet') },
      { address: 0x1000, words: [0x0200] }, // (0x0200 & 0xff00) >> 8 === 2 -> "ON"
      // Bit 8 (APU_CONTROL_SW) and bit 11 (APU_READY_LT) both set in the
      // SAME word — regression check that both packed fields decode
      // independently from one write, not just whichever was parsed last.
      { address: 0x2000, words: [0x0900] }
    ])
    await new Promise<void>((res, rej) => sender.send(packet, MULTICAST_PORT, '127.0.0.1', (err) => (err ? rej(err) : res())))

    await waitUntil(() => pushes.some((p) => p.kind === 'fields' && p.activeAircraft === 'Hornet'))
    const fieldsPush = pushes.find((p) => p.kind === 'fields')
    expect(fieldsPush).toMatchObject({
      kind: 'fields',
      activeAircraft: 'Hornet',
      updates: { UFC_COMM1_CHANNEL_SELECT: 2, APU_CONTROL_SW: 1, APU_READY_LT: 1 }
    })

    await waitUntil(() => pushes.some((p) => p.kind === 'status' && p.status.connected && p.status.activeAircraft === 'Hornet'))

    unsubscribe()
  }, 10000)

  it('parses and flattens the command catalog', async () => {
    const res = await host.request({ type: 'getCommandCatalog', aircraft: 'Hornet' })
    expect(res.type).toBe('commandCatalog')
    if (res.type !== 'commandCatalog') return
    expect(res.commands).toContainEqual({
      identifier: 'APU_CONTROL_SW',
      label: 'APU Control Switch, ON/OFF',
      category: 'APU',
      interface: 'action',
      argument: 'TOGGLE'
    })
    expect(res.commands).toContainEqual(
      expect.objectContaining({ identifier: 'APU_CONTROL_SW', interface: 'set_state', maxValue: 1 })
    )
  })

  it('sends a command as a real UDP broadcast in the confirmed "<identifier> <argument>\\n" wire format', async () => {
    const received = new Promise<string>((resolvePacket) => {
      commandListener.once('message', (msg) => resolvePacket(msg.toString('ascii')))
    })

    await host.request({ type: 'sendCommand', identifier: 'APU_CONTROL_SW', argument: 'TOGGLE' })

    const message = await received
    expect(message).toBe('APU_CONTROL_SW TOGGLE\n')
  }, 10000)
})
