import { useEffect, useRef, useState } from 'react'

// Scales a fixed canvasWidth x canvasHeight box to fit (contain, not cover —
// never stretched off-aspect) whatever this is actually rendered inside of,
// and centers it there. Every widget's x/y/w/h, and the background image's
// own background-size:cover crop, are only correct at the reference
// resolution a screen was designed at (see SubDeck.canvasWidth/Height's own
// comment in shared/types.ts) — a deployed viewport that doesn't happen to
// match that 1:1 needs the whole thing scaled together and letterboxed,
// rather than the background and the (otherwise still-unscaled) widgets
// drifting apart independently.
export function LetterboxedCanvas({
  canvasWidth,
  canvasHeight,
  children
}: {
  canvasWidth: number
  canvasHeight: number
  children: React.ReactNode
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ width: canvasWidth, height: canvasHeight })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setContainerSize({ width: el.clientWidth, height: el.clientHeight })
    })
    observer.observe(el)
    setContainerSize({ width: el.clientWidth, height: el.clientHeight })
    return () => observer.disconnect()
  }, [])

  const scale = Math.min(containerSize.width / canvasWidth, containerSize.height / canvasHeight) || 1
  const offsetX = (containerSize.width - canvasWidth * scale) / 2
  const offsetY = (containerSize.height - canvasHeight * scale) / 2

  return (
    <div ref={containerRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          left: offsetX,
          top: offsetY,
          width: canvasWidth,
          height: canvasHeight,
          transform: `scale(${scale})`,
          transformOrigin: 'top left'
        }}
      >
        {children}
      </div>
    </div>
  )
}
