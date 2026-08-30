import { useEffect, useRef, useState } from 'react'
import { useDashboardStore } from '../store'
import type { PluginConfigPanelProps } from './types'

const MIN_UPDATE_HZ = 1
const MAX_UPDATE_HZ = 25

function DcsBiosStatusBanner({ onConfigure }: { onConfigure: () => void }): React.JSX.Element {
  const status = useDashboardStore((s) => s.dcsBiosStatus)
  const stats = useDashboardStore((s) => s.dcsBiosStats)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  // Self-scaling rather than pinned to an arbitrary absolute ceiling, which
  // would make typical traffic look either empty or permanently maxed out.
  const maxWritesSeenRef = useRef(1)
  if (stats) maxWritesSeenRef.current = Math.max(maxWritesSeenRef.current, stats.writesPerSec)

  let message: string
  if (!status || !status.everConnected) {
    message = 'DCS-BIOS: no data received yet — check DCS is running with DCS-BIOS installed and export enabled.'
  } else if (!status.connected) {
    message = 'DCS-BIOS: connection lost — is DCS still running?'
  } else if (status.activeAircraft) {
    message = `DCS-BIOS: connected — flying ${status.activeAircraft}`
  } else {
    message = 'DCS-BIOS: connected, no aircraft loaded'
  }

  const barPct = stats ? Math.min(100, Math.round((stats.writesPerSec / maxWritesSeenRef.current) * 100)) : 0
  const laggy = stats ? stats.eventLoopDelayMeanMs > 20 : false

  return (
    <div className="events-modal__dcsbios-status">
      <div className="events-modal__dcsbios-status-row">
        <span className={`app__status app__status--${status?.connected ? 'on' : 'off'}`}>{status?.connected ? 'online' : 'offline'}</span>
        <span>{message}</span>
        <button type="button" className="events-modal__configure-link" onClick={onConfigure}>
          Configure in Settings
        </button>
      </div>
      <button type="button" className="events-modal__diagnostics-toggle" onClick={() => setDiagnosticsOpen((o) => !o)}>
        {diagnosticsOpen ? 'Hide diagnostics' : 'Show diagnostics'}
      </button>
      {diagnosticsOpen && (
        <div className="events-modal__diagnostics">
          <p className="properties__hint-inline">Reflects DCS-BIOS's own output rate — not affected by any source's update-frequency slider below.</p>
          <div className="events-modal__diagnostics-bar-track">
            <div className="events-modal__diagnostics-bar-fill" style={{ width: `${barPct}%` }} />
          </div>
          <div className="events-modal__diagnostics-numbers">
            <span>{stats ? stats.packetsPerSec.toFixed(1) : '0.0'} packets/sec</span>
            <span>{stats ? stats.writesPerSec.toFixed(1) : '0.0'} writes/sec</span>
            <span className={laggy ? 'dcsbios-settings__error' : undefined}>
              event loop delay: {stats ? stats.eventLoopDelayMeanMs.toFixed(1) : '0.0'}ms avg / {stats ? stats.eventLoopDelayMaxMs.toFixed(1) : '0.0'}ms max
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// DCS-BIOS's own plugin config panel — aircraft picker + update-rate slider,
// plus the live connection status banner while enabled. The field browser
// itself (dynamicFields — see EventSourcesModal.tsx) stays generic there since
// it's about ADDING mappings, not this plugin's own config.
export function DcsBiosConfigPanel({ source, kindEnabled, onPatchConfig, onOpenSettings }: PluginConfigPanelProps): React.JSX.Element {
  const dcsBiosAircraft = useDashboardStore((s) => s.dcsBiosAircraft)
  const requestDcsBiosAircraftList = useDashboardStore((s) => s.requestDcsBiosAircraftList)
  const dcsBiosSettings = useDashboardStore((s) => s.dcsBiosSettings)
  const requestDcsBiosSettings = useDashboardStore((s) => s.requestDcsBiosSettings)

  useEffect(() => {
    if (dcsBiosAircraft === null) requestDcsBiosAircraftList()
  }, [dcsBiosAircraft, requestDcsBiosAircraftList])

  useEffect(() => {
    if (dcsBiosSettings === null) requestDcsBiosSettings()
  }, [dcsBiosSettings, requestDcsBiosSettings])

  const aircraft = typeof source.config?.aircraft === 'string' ? source.config.aircraft : ''
  const DEFAULT_UPDATE_HZ = 10
  const updateHz = typeof source.config?.updateHz === 'number' ? source.config.updateHz : DEFAULT_UPDATE_HZ

  return (
    <>
      {kindEnabled && <DcsBiosStatusBanner onConfigure={onOpenSettings} />}
      <div className="events-modal__source-config">
        <label className="dcsbios-settings__field">
          <span>Aircraft</span>
          {dcsBiosAircraft === null ? (
            <span className="properties__hint-inline">Loading aircraft…</span>
          ) : dcsBiosAircraft.length === 0 ? (
            <span className="properties__hint-inline">No installed DCS-BIOS aircraft found — check the docs folder in Settings.</span>
          ) : (
            <select value={aircraft} onChange={(e) => onPatchConfig({ ...source.config, aircraft: e.target.value })}>
              <option value="">Pick an aircraft…</option>
              {dcsBiosAircraft.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
        </label>
        <label className="dcsbios-settings__field">
          <span>Update frequency: {updateHz}/sec</span>
          <input
            type="range"
            min={MIN_UPDATE_HZ}
            max={MAX_UPDATE_HZ}
            value={updateHz}
            onChange={(e) => onPatchConfig({ ...source.config, updateHz: Number(e.target.value) })}
          />
          <span className="properties__hint-inline">
            How often this plugin's mapped variables refresh — lower this if you don't need every change instantly and want to reduce
            broadcast/save load.
          </span>
        </label>
      </div>
    </>
  )
}

// Default config for a freshly-added DCS-BIOS event source — see
// EventSourcesModal.tsx's addSource, which calls this instead of hardcoding
// the shape inline.
export function defaultDcsBiosConfig(defaultUpdateHz: number | undefined): Record<string, unknown> {
  return { aircraft: '', updateHz: defaultUpdateHz ?? 10 }
}
