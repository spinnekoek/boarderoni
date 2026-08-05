import { useEffect, useRef, useState } from 'react'
import { hexToHsv, hsvToHex } from '@shared/color'

const HEX_PATTERN = /^#?[0-9a-fA-F]{6}$/

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

// Saturation/value square + hue slider + hex input, in the app's own dark
// theme — used in place of the OS-native <input type="color"> dialog, which
// looks jarring next to the rest of the editor.
export function HsvColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }): React.JSX.Element {
  const [hsv, setHsv] = useState(() => hexToHsv(value))
  const [hexInput, setHexInput] = useState(value)
  const svRef = useRef<HTMLDivElement>(null)
  const hueRef = useRef<HTMLDivElement>(null)

  // Picking a swatch elsewhere, or an expression resolving to a new color,
  // changes `value` out from under us — resync rather than fight it.
  useEffect(() => {
    setHsv(hexToHsv(value))
    setHexInput(value)
  }, [value])

  function commit(next: [number, number, number]): void {
    setHsv(next)
    const hex = hsvToHex(...next)
    setHexInput(hex)
    onChange(hex)
  }

  function handleSvPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    const el = svRef.current
    if (!el) return
    el.setPointerCapture(e.pointerId)
    const hue = hsv[0]
    function apply(clientX: number, clientY: number): void {
      const rect = el!.getBoundingClientRect()
      const s = clamp01((clientX - rect.left) / rect.width)
      const v = clamp01(1 - (clientY - rect.top) / rect.height)
      commit([hue, s, v])
    }
    apply(e.clientX, e.clientY)
    function onMove(ev: PointerEvent): void {
      apply(ev.clientX, ev.clientY)
    }
    function onUp(): void {
      el!.removeEventListener('pointermove', onMove)
      el!.removeEventListener('pointerup', onUp)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }

  function handleHuePointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    const el = hueRef.current
    if (!el) return
    el.setPointerCapture(e.pointerId)
    const [, s, v] = hsv
    function apply(clientX: number): void {
      const rect = el!.getBoundingClientRect()
      const h = clamp01((clientX - rect.left) / rect.width) * 360
      commit([h, s, v])
    }
    apply(e.clientX)
    function onMove(ev: PointerEvent): void {
      apply(ev.clientX)
    }
    function onUp(): void {
      el!.removeEventListener('pointermove', onMove)
      el!.removeEventListener('pointerup', onUp)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }

  function handleHexChange(raw: string): void {
    setHexInput(raw)
    if (!HEX_PATTERN.test(raw)) return
    const hex = raw.startsWith('#') ? raw : `#${raw}`
    setHsv(hexToHsv(hex))
    onChange(hex)
  }

  const [hue, sat, val] = hsv

  return (
    <div className="hsv-picker">
      <div
        ref={svRef}
        className="hsv-picker__sv"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hue}, 100%, 50%)`
        }}
        onPointerDown={handleSvPointerDown}
      >
        <div className="hsv-picker__sv-thumb" style={{ left: `${sat * 100}%`, top: `${(1 - val) * 100}%` }} />
      </div>
      <div ref={hueRef} className="hsv-picker__hue" onPointerDown={handleHuePointerDown}>
        <div className="hsv-picker__hue-thumb" style={{ left: `${(hue / 360) * 100}%` }} />
      </div>
      <input className="hsv-picker__hex" value={hexInput} onChange={(e) => handleHexChange(e.target.value)} spellCheck={false} />
    </div>
  )
}
