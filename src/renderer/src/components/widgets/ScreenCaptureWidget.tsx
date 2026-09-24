import { useEffect, useState } from 'react'
import { withOpacity } from '@shared/color'
import { resolveBorderColor, type VariableMap } from '@shared/expr'
import type { ScreenCaptureWidget } from '@shared/types'
import { screenCaptureFrameUrl, screenCaptureStreamUrl } from '../../screenCapture'
import { useDashboardStore } from '../../store'

// CSS object-fit's vocabulary doesn't exactly match BackgroundFit's — this
// widget reuses that type/UI for consistency with the background image
// picker rather than inventing a second one, mapping the two mismatches:
// 'stretch' has no object-fit equivalent named the same (it's 'fill'), and
// 'tile' (repeating at native size) isn't meaningful for a live feed at all,
// so it just reads as 'cover'.
const OBJECT_FIT: Record<NonNullable<ScreenCaptureWidget['fit']>, React.CSSProperties['objectFit']> = {
  cover: 'cover',
  contain: 'contain',
  stretch: 'fill',
  tile: 'cover',
  none: 'none'
}

// Passive — no pointer handlers, nothing to trigger, same as GaugeWidget.
// Shared as-is between the editor preview (CanvasWidget) and the
// client (ClientCanvas), so picking a region shows a live preview in the
// editor too, without needing the phone. `deckId` (unlike every other
// widget content component) is needed here because the frame/stream itself
// is fetched over plain HTTP scoped to a deck, not carried in `widget`.
export function ScreenCaptureWidgetContent({
  widget,
  variables,
  deckId
}: {
  widget: ScreenCaptureWidget
  variables: VariableMap
  deckId: string | null
}): React.JSX.Element {
  const resolvedBorder = resolveBorderColor(widget, variables)
  const borderColor = withOpacity(resolvedBorder.color ?? 'transparent', resolvedBorder.opacity ?? widget.borderOpacity ?? 1)
  const streamMode = widget.streamMode ?? 'poll'
  const fps = widget.fps ?? 5
  // null (not yet arrived — see main/index.ts's sendInitialState) reads as
  // enabled, so this doesn't flash a disabled state before that first
  // message lands.
  const pluginEnabled = useDashboardStore((s) => s.enabledPlugins === null || s.enabledPlugins.includes('screenCapture'))
  const configured = deckId !== null && widget.region !== undefined && pluginEnabled

  // Poll mode: re-fetch a fresh frame on a client-side timer, cache-busted
  // via the URL's own query param. MJPEG mode needs no such loop — the
  // <img> is pointed at the persistent stream once and the browser/WebView
  // updates it in place as the server pushes frames (see
  // main/screenCapture.ts's addMjpegViewer).
  const [pollNonce, setPollNonce] = useState(0)
  useEffect(() => {
    if (streamMode !== 'poll' || !configured) return
    const interval = setInterval(() => setPollNonce((n) => n + 1), 1000 / fps)
    return () => clearInterval(interval)
  }, [streamMode, configured, fps])

  const filters: string[] = []
  if (widget.brightness !== undefined && widget.brightness !== 1) filters.push(`brightness(${widget.brightness})`)
  if (widget.contrast !== undefined && widget.contrast !== 1) filters.push(`contrast(${widget.contrast})`)
  if (widget.saturation !== undefined && widget.saturation !== 1) filters.push(`saturate(${widget.saturation})`)

  const outerStyle: React.CSSProperties = {
    borderStyle: 'solid',
    borderWidth: 2,
    borderColor,
    ...(widget.zIndex !== undefined && { zIndex: widget.zIndex })
  }

  if (!pluginEnabled) {
    return (
      <div className="deck-screen-capture deck-screen-capture--empty" style={outerStyle}>
        <span className="deck-screen-capture__hint">Screen Capture plugin is disabled — enable it in Settings</span>
      </div>
    )
  }

  if (!configured) {
    return (
      <div className="deck-screen-capture deck-screen-capture--empty" style={outerStyle}>
        <span className="deck-screen-capture__hint">Pick a region in Properties</span>
      </div>
    )
  }

  const src = streamMode === 'mjpeg' ? screenCaptureStreamUrl(deckId, widget.id) : screenCaptureFrameUrl(deckId, widget.id, pollNonce)

  return (
    <div className="deck-screen-capture" style={outerStyle}>
      <img
        key={streamMode}
        className="deck-screen-capture__img"
        src={src}
        alt=""
        // Browsers make <img> natively draggable by default (HTML5 drag-
        // and-drop) — left on, that hijacks the pointer mid-gesture and
        // breaks the widget's own pointer-capture-based drag/resize (see
        // useWidgetDrag.ts): the widget doesn't move while the mouse is
        // still held, then keeps tracking the cursor after release since
        // the drag's pointerup never arrived to clear its state.
        draggable={false}
        style={{ objectFit: OBJECT_FIT[widget.fit ?? 'cover'], filter: filters.length > 0 ? filters.join(' ') : undefined }}
      />
    </div>
  )
}
