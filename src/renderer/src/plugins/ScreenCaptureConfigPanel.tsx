import { useEffect } from 'react'
import { useDashboardStore } from '../store'
import type { ScreenRegion } from '@shared/types'
import type { PluginConfigPanelProps } from './types'

// Matches the clamp range in main/plugins/screenCapture.ts's producer —
// kept in sync manually since one's a renderer-side slider and the other's
// the main-process tick scheduler, with no shared module between them for a
// single small numeric range.
const MIN_OCR_INTERVAL_MS = 200
const MAX_OCR_INTERVAL_MS = 5000
export const DEFAULT_OCR_INTERVAL_MS = 1000

// Screen Capture's own plugin config — which monitor/region to grab and how
// often to OCR it. This is the OCR plugin's config; the
// 'screen-capture' WIDGET has its own separate region/monitor fields (set
// directly on the widget via Properties, not here) since a dashboard can
// have many capture widgets sharing this one plugin's on/off switch.
export function ScreenCaptureConfigPanel({ source, onPatchConfig }: PluginConfigPanelProps): React.JSX.Element {
  const screenCaptureDisplays = useDashboardStore((s) => s.screenCaptureDisplays)
  const requestScreenCaptureDisplays = useDashboardStore((s) => s.requestScreenCaptureDisplays)
  const pickPluginRegion = useDashboardStore((s) => s.pickPluginRegion)

  useEffect(() => {
    if (screenCaptureDisplays === null) requestScreenCaptureDisplays()
  }, [screenCaptureDisplays, requestScreenCaptureDisplays])

  const displayId = typeof source.config?.displayId === 'number' ? source.config.displayId : undefined
  const region = source.config?.region as ScreenRegion | undefined
  const regionSummary = region
    ? `${Math.round(region.width)}×${Math.round(region.height)} at (${Math.round(region.x)}, ${Math.round(region.y)})`
    : 'No region selected'
  const intervalMs = typeof source.config?.intervalMs === 'number' ? source.config.intervalMs : DEFAULT_OCR_INTERVAL_MS

  return (
    <div className="events-modal__source-config">
      <label className="dcsbios-settings__field">
        <span>Monitor</span>
        <select value={displayId ?? ''} onChange={(e) => onPatchConfig({ ...source.config, displayId: Number(e.target.value) })}>
          <option value="">Pick a monitor…</option>
          {(screenCaptureDisplays ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      <div className="dcsbios-settings__field">
        <span>Region: {regionSummary}</span>
        <button
          type="button"
          className="properties__file-button"
          disabled={(screenCaptureDisplays ?? []).length === 0}
          onClick={() => pickPluginRegion(source.id, displayId ?? screenCaptureDisplays?.[0]?.id ?? 0)}
        >
          Pick region
        </button>
      </div>
      <label className="dcsbios-settings__field">
        <span>Poll interval: {intervalMs}ms</span>
        <input
          type="range"
          min={MIN_OCR_INTERVAL_MS}
          max={MAX_OCR_INTERVAL_MS}
          step={100}
          value={intervalMs}
          onChange={(e) => onPatchConfig({ ...source.config, intervalMs: Number(e.target.value) })}
        />
        <span className="properties__hint-inline">
          How often the region is re-captured and OCR'd. Recognition itself may take longer than this on a slow machine — ticks never overlap
          regardless of what this is set to.
        </span>
      </label>
    </div>
  )
}
