import { useEffect } from 'react'
import { useDashboardStore } from '../store'
import { useEditorSettings } from '../settingsStore'
import { useEscapeToClose } from '../useEscapeToClose'
import { EVENT_SOURCE_TYPES } from '@shared/eventSources'
import { DATA_SOURCE_SETTINGS_PANELS } from '../dataSourceSettingsPanels'

// Generic, not DCS-BIOS-specific — every EVENT_SOURCE_TYPES kind gets a row
// here automatically. A kind with an entry in DATA_SOURCE_SETTINGS_PANELS
// gets an expandable panel; one without (e.g. 'datetime') just gets the
// enable toggle. This is the template future high-intensity data sources
// plug into: add an EVENT_SOURCE_TYPES entry and, if it needs
// configuration, one line in dataSourceSettingsPanels.tsx — nothing here
// changes.
export function SettingsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const enabledDataSources = useDashboardStore((s) => s.enabledDataSources)
  const requestAppSettings = useDashboardStore((s) => s.requestAppSettings)
  const updateEnabledDataSources = useDashboardStore((s) => s.updateEnabledDataSources)
  const focusKind = useEditorSettings((s) => s.settingsFocusKind)
  useEscapeToClose(onClose)

  useEffect(() => {
    requestAppSettings()
  }, [requestAppSettings])

  // Opt-out by default while the real list is still loading, matching the
  // main process's own default (see appSettings.ts) — never flashes "all
  // disabled" for a moment on open.
  const enabledSet = new Set(enabledDataSources ?? EVENT_SOURCE_TYPES.map((t) => t.kind))

  function toggle(kind: string, enabled: boolean): void {
    const current = enabledDataSources ?? EVENT_SOURCE_TYPES.map((t) => t.kind)
    const next = enabled ? Array.from(new Set([...current, kind])) : current.filter((k) => k !== kind)
    updateEnabledDataSources(next)
  }

  return (
    <div className="variables-modal-overlay" onPointerDown={onClose}>
      <div className="variables-modal settings-modal" onPointerDown={(e) => e.stopPropagation()}>
        <div className="variables-modal__header">
          <h2 className="variables-modal__title">Settings</h2>
          <button type="button" className="modal-close" title="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="variables-modal__body">
          <p className="properties__hint">
            Enabled data sources appear in the "Add event source" picker (Events, in the toolbar). Disabling one pauses
            it — its configuration and mapped variables are kept, not deleted.
          </p>

          <div className="variables-modal__scroll">
            <div className="settings-modal__sources">
              {EVENT_SOURCE_TYPES.map((type) => {
                const enabled = enabledSet.has(type.kind)
                const Panel = DATA_SOURCE_SETTINGS_PANELS[type.kind]
                return (
                  <details key={type.kind} className="settings-modal__source" open={type.kind === focusKind}>
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
                      <p className="properties__hint">Enable this data source to configure it.</p>
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
