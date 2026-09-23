import type { PluginConfigPanelProps } from './types'

export const DEFAULT_RANDOM_MIN = 0
export const DEFAULT_RANDOM_MAX = 1

// The template's own config UI half (see main/plugins/random.ts's producer
// for the other half) — demonstrates a configurable per-instance field, not
// just an output one, the way every other kind with config
// (ScreenCaptureConfigPanel's intervalMs, WindowsAudioConfigPanel's
// updateHz) already does. Deliberately doesn't clamp min <= max here; the
// producer itself tolerates either order (see its own comment) so this
// stays simple free-typing number fields rather than needing the
// clamp-on-blur dance PropertiesPanel's own width/height fields use — this
// panel typically committing far less often than a properties field, and
// no widget being resized as it's being edited, made that not worth
// carrying over.
export function RandomConfigPanel({ source, onPatchConfig }: PluginConfigPanelProps): React.JSX.Element {
  const min = typeof source.config?.min === 'number' ? source.config.min : DEFAULT_RANDOM_MIN
  const max = typeof source.config?.max === 'number' ? source.config.max : DEFAULT_RANDOM_MAX

  return (
    <div className="events-modal__source-config">
      <label className="dcsbios-settings__field">
        <span>Min</span>
        <input
          type="number"
          value={min}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (!Number.isNaN(n)) onPatchConfig({ ...source.config, min: n })
          }}
        />
      </label>
      <label className="dcsbios-settings__field">
        <span>Max</span>
        <input
          type="number"
          value={max}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (!Number.isNaN(n)) onPatchConfig({ ...source.config, max: n })
          }}
        />
      </label>
      <p className="properties__hint-inline">A new random value between Min and Max is emitted once per second.</p>
    </div>
  )
}

// Default config for a freshly-added Random Number event source — see
// EventSourcesModal.tsx's addSource, which calls this instead of
// hardcoding the shape inline (same convention as defaultWindowsAudioConfig).
export function defaultRandomConfig(): Record<string, unknown> {
  return { min: DEFAULT_RANDOM_MIN, max: DEFAULT_RANDOM_MAX }
}
