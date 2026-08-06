// Byte-level decoder for the DCS-BIOS UDP export protocol. Pure state
// machine — no dgram, no worker_threads, no Node APIs beyond Buffer — so
// it's usable standalone in a unit test and inside the worker thread alike.
//
// Frame shape: a run of 4 consecutive 0x55 sync bytes, then a u16 LE
// address, then a u16 LE byte count, then `count` bytes of data (i.e.
// count/2 u16 LE words), each word firing one write with the address
// auto-incrementing by 2. An assembled address of exactly 0x5555 mid-parse
// means the last two bytes were both sync bytes overlapping an
// address-shaped read, not a real address — that resyncs rather than
// desyncing the whole stream.
const SYNC_BYTE = 0x55
const SYNC_LENGTH = 4
const SYNC_ADDRESS = 0x5555

export interface DcsBiosWrite {
  address: number
  data: number
}

type State = 'sync' | 'addressLow' | 'addressHigh' | 'countLow' | 'countHigh' | 'dataLow' | 'dataHigh'

export class DcsBiosFrameDecoder {
  private state: State = 'sync'
  private syncCount = 0
  private address = 0
  private count = 0
  private lowByte = 0

  // Fires once per completed 4-byte sync run — test/debug hook only, not
  // used by the decoder's own logic.
  onFrameSync?: () => void

  // Feeds one UDP datagram's bytes through the state machine. State
  // persists across calls, so a run may span packet boundaries — call this
  // once per received datagram, in order.
  processBuffer(buf: Buffer, onWrite: (write: DcsBiosWrite) => void): void {
    for (let i = 0; i < buf.length; i++) {
      this.processByte(buf[i], onWrite)
    }
  }

  private processByte(byte: number, onWrite: (write: DcsBiosWrite) => void): void {
    switch (this.state) {
      case 'sync':
        if (byte === SYNC_BYTE) {
          if (++this.syncCount >= SYNC_LENGTH) {
            this.syncCount = 0
            this.state = 'addressLow'
            this.onFrameSync?.()
          }
        } else {
          this.syncCount = 0
        }
        break

      case 'addressLow':
        this.lowByte = byte
        this.state = 'addressHigh'
        break

      case 'addressHigh': {
        const address = this.lowByte | (byte << 8)
        if (address === SYNC_ADDRESS) {
          // Both bytes were 0x55 — still inside a run of sync bytes rather
          // than a real address. Resync, crediting the 2 bytes already seen
          // toward the next 4-byte sync run instead of discarding them.
          this.state = 'sync'
          this.syncCount = 2
          break
        }
        this.address = address
        this.state = 'countLow'
        break
      }

      case 'countLow':
        this.lowByte = byte
        this.state = 'countHigh'
        break

      case 'countHigh':
        this.count = this.lowByte | (byte << 8)
        this.state = this.count > 0 ? 'dataLow' : 'addressLow'
        break

      case 'dataLow':
        this.lowByte = byte
        this.count--
        this.state = 'dataHigh'
        break

      case 'dataHigh': {
        const data = this.lowByte | (byte << 8)
        onWrite({ address: this.address, data })
        this.address += 2
        this.count--
        this.state = this.count > 0 ? 'dataLow' : 'addressLow'
        break
      }
    }
  }
}
