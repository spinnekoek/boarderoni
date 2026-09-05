import { useEffect, useState } from 'react'
import { backgroundImageStyle, backgroundImageUrl } from '../background'
import { ScreenWidgetsLayer } from './ViewCanvas'
import type { VariableMap } from '@shared/expr'
import type { BackgroundAnchor, BackgroundFit, OverlayEdge, OverlaySizeUnit, SubDeck } from '@shared/types'

function panelStyle(edge: OverlayEdge, sizeCss: string, open: boolean): React.CSSProperties {
  switch (edge) {
    case 'left':
      return { top: 0, left: 0, bottom: 0, width: sizeCss, transform: open ? 'translateX(0)' : 'translateX(-100%)' }
    case 'right':
      return { top: 0, right: 0, bottom: 0, width: sizeCss, transform: open ? 'translateX(0)' : 'translateX(100%)' }
    case 'top':
      return { top: 0, left: 0, right: 0, height: sizeCss, transform: open ? 'translateY(0)' : 'translateY(-100%)' }
    case 'bottom':
      return { bottom: 0, left: 0, right: 0, height: sizeCss, transform: open ? 'translateY(0)' : 'translateY(100%)' }
  }
}

// A slide-over sub-deck panel — see OpenOverlayAction's own comment in
// shared/types.ts. Mounts closed and animates open on the next frame (a
// transform set synchronously from the very first render would start
// already-open, since React never renders the "before" frame a CSS
// transition needs to animate from); dismissal — via the scrim tap below,
// or the store's activeOverlay clearing out from under this component
// entirely (an explicit close-overlay widget action, or a fullscreen
// navigate) — is instant, no exit animation.
export function OverlayPanel({
  subDeck,
  edge,
  size,
  sizeUnit,
  scale,
  canvasWidth,
  canvasHeight,
  variables,
  deckId,
  errors,
  customFonts,
  backgroundColor,
  backgroundImageVersion,
  backgroundFit,
  backgroundAnchor,
  onDismiss
}: {
  subDeck: SubDeck
  edge: OverlayEdge
  size: number
  sizeUnit: OverlaySizeUnit
  // The main canvas's own current letterbox scale-to-fit factor (see
  // ViewCanvas's mainScale) — applied to the panel's own px-based edge size
  // below (a raw device-pixel sizeCss would be a completely different
  // proportion of the screen on a phone than on the design resolution it
  // was authored against; 'percent' is already a fraction of the real
  // screen, correct as-is) AND, unconditionally regardless of sizeUnit, to
  // the widget content below — see its own comment for why that can't just
  // reuse LetterboxedCanvas.
  scale: number
  // This sub-deck's own reference resolution (see getSubDeckCanvasSize in
  // shared/subDecks.ts) — widgets below are authored against this, not the
  // panel's own real on-screen box.
  canvasWidth: number
  canvasHeight: number
  variables: VariableMap
  deckId: string | null
  errors: Record<string, string>
  customFonts: unknown
  backgroundColor: string
  backgroundImageVersion?: number
  backgroundFit?: BackgroundFit
  backgroundAnchor?: BackgroundAnchor
  onDismiss: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const sizeCss = sizeUnit === 'px' ? `${size * scale}px` : `${size}%`

  return (
    <>
      <div className="overlay-panel__scrim" onPointerDown={onDismiss} />
      <div
        className="overlay-panel"
        style={{ ...panelStyle(edge, sizeCss, open), backgroundColor }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Deliberately NOT a LetterboxedCanvas — that fits its content to
        whatever real pixel box it's actually measured inside of, but this
        panel's own box is already sized as `scale` fraction of its design
        size (sizeCss above), so independently re-fitting content to that
        (already-scaled-down) box would scale it down a SECOND time. This
        widget content instead gets the exact same `scale` factor applied
        directly, at its own true canvasWidth/canvasHeight size — one
        global scale, matching how the main canvas's own widgets are scaled,
        not a second independently-computed fit-to-container ratio. */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: canvasWidth,
            height: canvasHeight,
            transform: `scale(${scale})`,
            transformOrigin: 'top left'
          }}
        >
          {backgroundImageVersion && deckId && (
            <div
              className="dashboard-wallpaper"
              style={{
                backgroundImage: `url(${backgroundImageUrl(deckId, backgroundImageVersion)})`,
                ...backgroundImageStyle(backgroundFit ?? 'cover', backgroundAnchor ?? 'center')
              }}
            />
          )}
          <ScreenWidgetsLayer widgets={subDeck.widgets} variables={variables} deckId={deckId} errors={errors} customFonts={customFonts} />
        </div>
      </div>
    </>
  )
}
