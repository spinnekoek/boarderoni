import { useEffect, useState } from 'react'
import { withOpacity } from '@shared/color'
import { resolveBorderColor, type VariableMap } from '@shared/expr'
import type { DcsViewportWidget } from '@shared/types'
import { screenCaptureFrameUrl, screenCaptureStreamUrl } from '../../screenCapture'
import { useDashboardStore } from '../../store'

// Same fit-vocabulary mapping as ScreenCaptureWidgetContent — kept
// duplicated rather than shared since it's three lines and this widget
// otherwise has no dependency on that file.
const OBJECT_FIT: Record<NonNullable<DcsViewportWidget['fit']>, React.CSSProperties['objectFit']> = {
  cover: 'cover',
  contain: 'contain',
  stretch: 'fill',
  tile: 'cover',
  none: 'none'
}

// Near-identical to ScreenCaptureWidgetContent, reusing the exact same
// frame/stream HTTP helpers (main/index.ts's resolveStreamableWidget
// accepts both widget types on the same routes) — the only real difference
// is what "configured" and "disabled" mean: there's no region to pick here,
// just a componentKey, and it's gated on the virtual display actually being
// ready, not just the plugin toggle.
export function DcsViewportWidgetContent({
  widget,
  variables,
  deckId
}: {
  widget: DcsViewportWidget
  variables: VariableMap
  deckId: string | null
}): React.JSX.Element {
  const resolvedBorder = resolveBorderColor(widget, variables)
  const borderColor = withOpacity(resolvedBorder.color ?? 'transparent', resolvedBorder.opacity ?? widget.borderOpacity ?? 1)
  const streamMode = widget.streamMode ?? 'poll'
  const fps = widget.fps ?? 5
  const pluginEnabled = useDashboardStore((s) => s.enabledPlugins === null || s.enabledPlugins.includes('dcsViewports'))
  const displayReady = useDashboardStore((s) => s.dcsViewportsStatus?.displayReady ?? false)
  const configured = deckId !== null && widget.componentKey !== undefined && pluginEnabled && displayReady

  // Gates the very first frame request, not just later polling — an mjpeg
  // widget opens its stream connection the moment its <img src> is set, so
  // "tap to start" has to withhold rendering the <img> at all until tapped,
  // not just pause an interval. Resets to the closed state on every remount
  // (dashboard reload/switch), per tapToStream's own comment in shared/types.
  // Defaults to on (tap required) — only an explicit `false` streams
  // immediately.
  const [started, setStarted] = useState(widget.tapToStream === false)

  const [pollNonce, setPollNonce] = useState(0)
  useEffect(() => {
    if (streamMode !== 'poll' || !configured || !started) return
    const interval = setInterval(() => setPollNonce((n) => n + 1), 1000 / fps)
    return () => clearInterval(interval)
  }, [streamMode, configured, started, fps])

  const filters: string[] = []
  if (widget.brightness !== undefined && widget.brightness !== 1) filters.push(`brightness(${widget.brightness})`)
  if (widget.contrast !== undefined && widget.contrast !== 1) filters.push(`contrast(${widget.contrast})`)
  if (widget.saturation !== undefined && widget.saturation !== 1) filters.push(`saturate(${widget.saturation})`)

  const outerStyle: React.CSSProperties = {
    borderStyle: 'solid',
    borderWidth: widget.borderWidth ?? 2,
    borderColor,
    ...(widget.zIndex !== undefined && { zIndex: widget.zIndex })
  }

  if (!pluginEnabled) {
    return (
      <div className="deck-screen-capture deck-screen-capture--empty" style={outerStyle}>
        <span className="deck-screen-capture__hint">DCS Viewports plugin is disabled — enable it in Settings</span>
      </div>
    )
  }

  if (!displayReady) {
    return (
      <div className="deck-screen-capture deck-screen-capture--empty" style={outerStyle}>
        <span className="deck-screen-capture__hint">Virtual display not ready — check DCS Viewports settings</span>
      </div>
    )
  }

  if (!configured) {
    return (
      <div className="deck-screen-capture deck-screen-capture--empty" style={outerStyle}>
        <span className="deck-screen-capture__hint">Pick a component in Properties</span>
      </div>
    )
  }

  if (!started) {
    return (
      <div
        className="deck-screen-capture deck-screen-capture--empty deck-screen-capture--tap"
        style={outerStyle}
        role="button"
        tabIndex={0}
        onClick={() => setStarted(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setStarted(true)
        }}
      >
        <span className="deck-screen-capture__hint">Tap to start streaming</span>
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
        draggable={false}
        style={{ objectFit: OBJECT_FIT[widget.fit ?? 'cover'], filter: filters.length > 0 ? filters.join(' ') : undefined }}
      />
    </div>
  )
}
