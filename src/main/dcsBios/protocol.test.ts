import { describe, expect, it } from 'vitest'
import { DcsBiosFrameDecoder, type DcsBiosWrite } from './protocol'

const SYNC = [0x55, 0x55, 0x55, 0x55]

function u16le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff]
}

// Builds one address/count/data run (no leading sync) — count is a BYTE
// count, so it's always words.length * 2.
function run(address: number, words: number[]): number[] {
  return [...u16le(address), ...u16le(words.length * 2), ...words.flatMap(u16le)]
}

function decodeAll(bytes: number[]): DcsBiosWrite[] {
  const decoder = new DcsBiosFrameDecoder()
  const writes: DcsBiosWrite[] = []
  decoder.processBuffer(Buffer.from(bytes), (w) => writes.push(w))
  return writes
}

describe('DcsBiosFrameDecoder', () => {
  it('decodes a single-word run after sync', () => {
    const writes = decodeAll([...SYNC, ...run(0x1000, [0x1234])])
    expect(writes).toEqual([{ address: 0x1000, data: 0x1234 }])
  })

  it('auto-increments the address across a multi-word run', () => {
    const writes = decodeAll([...SYNC, ...run(0x2000, [0x0001, 0x0002, 0x0003])])
    expect(writes).toEqual([
      { address: 0x2000, data: 0x0001 },
      { address: 0x2002, data: 0x0002 },
      { address: 0x2004, data: 0x0003 }
    ])
  })

  it('decodes a second run in the same frame without a fresh sync', () => {
    const writes = decodeAll([...SYNC, ...run(0x1000, [0xaaaa]), ...run(0x3000, [0xbbbb])])
    expect(writes).toEqual([
      { address: 0x1000, data: 0xaaaa },
      { address: 0x3000, data: 0xbbbb }
    ])
  })

  it('resyncs on a 0x5555 address instead of misreading it as real data', () => {
    // sync, then two more 0x55 bytes read as "address" (0x5555) — should
    // bounce back to sync-waiting rather than emitting a bogus run, and
    // still decode the real frame that follows once sync completes again.
    const bytes = [...SYNC, 0x55, 0x55, ...SYNC.slice(2), ...run(0x4000, [0x0042])]
    const writes = decodeAll(bytes)
    expect(writes).toEqual([{ address: 0x4000, data: 0x0042 }])
  })

  it('recovers from garbage bytes once a fresh sync run appears', () => {
    const bytes = [0x01, 0x02, 0x03, 0x04, 0x05, ...SYNC, ...run(0x5000, [0x9999])]
    const writes = decodeAll(bytes)
    expect(writes).toEqual([{ address: 0x5000, data: 0x9999 }])
  })

  it('decodes correctly when a run is split across processBuffer calls', () => {
    const decoder = new DcsBiosFrameDecoder()
    const writes: DcsBiosWrite[] = []
    const bytes = [...SYNC, ...run(0x6000, [0x1111, 0x2222])]
    const mid = 5 // splits mid-address/mid-run at an arbitrary point
    decoder.processBuffer(Buffer.from(bytes.slice(0, mid)), (w) => writes.push(w))
    decoder.processBuffer(Buffer.from(bytes.slice(mid)), (w) => writes.push(w))
    expect(writes).toEqual([
      { address: 0x6000, data: 0x1111 },
      { address: 0x6002, data: 0x2222 }
    ])
  })

  it('fires onFrameSync exactly once per completed 4-byte sync run', () => {
    const decoder = new DcsBiosFrameDecoder()
    let syncs = 0
    decoder.onFrameSync = () => syncs++
    decoder.processBuffer(Buffer.from([...SYNC, ...run(0x1000, [0x1]), ...SYNC, ...run(0x1000, [0x2])]), () => {})
    expect(syncs).toBe(2)
  })
})
