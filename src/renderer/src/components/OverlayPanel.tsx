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
  variables,
  deckId,
  errors,
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
  variables: VariableMap
  deckId: string | null
  errors: Record<string, string>
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

  const sizeCss = sizeUnit === 'px' ? `${size}px` : `${size}%`

  return (
    <>
      <div className="overlay-panel__scrim" onPointerDown={onDismiss} />
      <div
        className="overlay-panel"
        style={{ ...panelStyle(edge, sizeCss, open), backgroundColor }}
        onPointerDown={(e) => e.stopPropagation()}
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
        <ScreenWidgetsLayer widgets={subDeck.widgets} variables={variables} deckId={deckId} errors={errors} />
      </div>
    </>
  )
}
