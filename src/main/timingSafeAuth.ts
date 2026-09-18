import { timingSafeEqual } from 'node:crypto'

// Plain `!==` on a bearer token (restIncoming.ts, mcp/server.ts) leaks its
// length and, depending on the engine/inputs, can leak comparison timing
// byte-by-byte — a remote client could use that to narrow down a valid
// token faster than brute-forcing the whole thing blind. Length is checked
// first (that alone isn't secret — only the token's actual content is)
// before falling through to timingSafeEqual, which requires equal-length
// buffers or throws. Same idea as deviceApproval.ts's own hash comparison,
// kept separate since that one compares fixed-width hex digests and this
// compares raw variable-length secrets directly.
export function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}
