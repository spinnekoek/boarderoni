import type { IncomingMessage } from 'node:http'

// Shared by every secondary HTTP surface in this app that reads a request
// body (main/index.ts's own /api/decks routes, restIncoming.ts, mcp/
// server.ts) — before this existed, each accumulated an incoming body into
// a string with NO size cap at all: a single large POST would grow
// unboundedly in memory before anything downstream even looked at it, a
// plain memory-exhaustion DoS against the main process. Every body this
// app actually expects (a deck rename, a REST incoming payload, an MCP
// tool call) is well under a megabyte; this leaves generous headroom above
// that rather than trying to size it exactly per caller.
export const MAX_REQUEST_BODY_BYTES = 5 * 1024 * 1024

// Destroys the connection and rejects once accumulated bytes exceed the
// cap. Deliberately doesn't write an HTTP response itself (it has no
// opinion on status code/body shape, and every existing caller's own catch
// block already treats ANY rejection here the same as "bad/unparseable
// body" — a 400 or 500 depending on the caller) — the security property
// that actually matters, bounded memory and a terminated connection, holds
// either way, even though the client sees a slightly less precise status
// than a dedicated 413 would give.
export function readBody(req: IncomingMessage, maxBytes: number = MAX_REQUEST_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    let bytes = 0
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > maxBytes) {
        req.destroy()
        reject(new Error(`Request body exceeded ${maxBytes} bytes`))
        return
      }
      data += chunk.toString('utf-8')
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}
