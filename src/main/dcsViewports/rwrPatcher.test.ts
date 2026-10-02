import { describe, expect, it } from 'vitest'
import { applyPatchToSource, isPatchedSource } from './rwrPatcher'

describe('applyPatchToSource', () => {
  it('appends the block once and is idempotent', () => {
    const once = applyPatchToSource('a = 1\n', 'RWR_X')
    expect(isPatchedSource(once, 'RWR_X')).toBe(true)
    expect(applyPatchToSource(once, 'RWR_X')).toBe(once)
  })

  it('replaces the block when the viewport name changes', () => {
    const next = applyPatchToSource(applyPatchToSource('a = 1\n', 'OLD'), 'NEW')
    expect(next).toContain('try_find_assigned_viewport("NEW")')
    expect(next).not.toContain('"OLD"')
    expect(next.match(/boarderoni begin/g)).toHaveLength(1)
  })

  it('preserves CRLF line endings', () => {
    expect(applyPatchToSource('a = 1\r\n', 'X')).not.toMatch(/[^\r]\n/)
  })
})
