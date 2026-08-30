import { useEffect, useRef } from 'react'
import { useDashboardStore } from '../store'
import { useEditorSettings } from '../settingsStore'
import { useEscapeToClose } from '../useEscapeToClose'
import { PLUGIN_TYPES } from '@shared/plugins'
import { PLUGIN_SETTINGS_PANELS } from '../pluginSettingsPanels'

// The plugin enable/disable + app-wide-config list — split out from the
// per-dashboard instance/mapping UI, which now lives in its own
// EventSourcesModal.tsx. "Plugin" (this modal) is the capability itself
// (on/off, app-wide setup like DCS-BIOS's docs folder); "Event source"
// (that modal) is a per-dashboard INSTANCE of one, producing fields you map
// into variables — see PluginTypeMeta's own label/instanceLabel comment in
// shared/plugins/types.ts for where those two names actually diverge
// (Screen Capture + OCR).
//
// `focusKind` lets a "this plugin is disabled"/"configure it" link
// elsewhere (EventSourcesModal, opened separately) jump straight here via
// openPluginsModal(kind) in settingsStore.ts, expanding and scrolling to
// the matching row.
export function PluginsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const enabledPlugins = useDashboardStore((s) => s.enabledPlugins)
  const requestAppSettings = useDashboardStore((s) => s.requestAppSettings)
  const updateEnabledPlugins = useDashboardStore((s) => s.updateEnabledPlugins)
  const focusKind = useEditorSettings((s) => s.pluginsModalFocusKind)
  useEscapeToClose(onClose)

  useEffect(() => {
    if (enabledPlugins === null) requestAppSettings()
  }, [enabledPlugins, requestAppSettings])

  const detailsRefs = useRef<Map<string, HTMLDetailsElement>>(new Map())
  useEffect(() => {
    if (!focusKind) return
    detailsRefs.current.get(focusKind)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [focusKind])

  const enabledKinds = enabledPlugins ?? PLUGIN_TYPES.map((t) => t.kind)

  function toggle(kind: string, enabled: boolean): void {
    const next = enabled ? Array.from(new Set([...enabledKinds, kind])) : enabledKinds.filter((k) => k !== kind)
    updateEnabledPlugins(next)
  }

  return (
    <div className="variables-modal-overlay" onPointerDown={onClose}>
      <div className="variables-modal settings-modal" onPointerDown={(e) => e.stopPropagation()}>
        <div className="variables-modal__header">
          <h2 className="variables-modal__title">Plugins</h2>
          <button type="button" className="modal-close" title="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="variables-modal__body">
          <p className="properties__hint">
            Enabled plugins appear in the "+ Add event source" picker (Event Sources, in the toolbar). Disabling one
            pauses it — its configuration and mapped variables are kept, not deleted; any widget it also gates (e.g.
            Screen Capture's own widget) goes inert too.
          </p>

          <div className="variables-modal__scroll">
            <div className="settings-modal__sources">
              {PLUGIN_TYPES.map((type) => {
                const enabled = enabledKinds.includes(type.kind)
                const Panel = PLUGIN_SETTINGS_PANELS[type.kind]
                return (
                  <details
                    key={type.kind}
                    ref={(el) => {
                      if (el) detailsRefs.current.set(type.kind, el)
                      else detailsRefs.current.delete(type.kind)
                    }}
                    className="settings-modal__source"
                    open={type.kind === focusKind}
                  >
                    <summary className="settings-modal__source-summary">
                      <input
                        type="checkbox"
                        checked={enabled}
                        // Prevents the checkbox click from also triggering the
                        // native <details> toggle on its enclosing <summary>.
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => toggle(type.kind, e.target.checked)}
                      />
                      <span>{type.label}</span>
                      {!Panel && <span className="properties__hint-inline">No settings</span>}
                    </summary>
                    {Panel && (enabled ? <div className="settings-modal__source-panel"><Panel /></div> : (
                      <p className="properties__hint">Enable this plugin to configure it.</p>
                    ))}
                  </details>
                )
              })}
            </div>
          </div>

          <div className="variables-modal__actions">
            <button type="button" className="device-modal__save" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
