import { useEffect, useRef, useState } from 'react'
import { useDashboardStore } from '../store'
import { displayDeviceName } from '@shared/deviceName'
import type { DeviceInfo } from '@shared/types'

// Thresholds for the lag/buffer color coding below — deliberately generous
// (a LAN wifi hop routinely has a few hundred ms of jitter on its own) so
// this only actually flags a device once it's genuinely falling behind, not
// on every ordinary blip.
const LAG_WARN_MS = 1000
const LAG_BAD_MS = 4000
const BUFFERED_WARN_BYTES = 64_000
const BUFFERED_BAD_BYTES = 512_000

function severity(device: DeviceInfo): 'ok' | 'warn' | 'bad' {
  if (!device.connected) return 'ok'
  const lag = device.lagMs ?? 0
  const buffered = device.bufferedAmount ?? 0
  if (lag >= LAG_BAD_MS || buffered >= BUFFERED_BAD_BYTES) return 'bad'
  if (lag >= LAG_WARN_MS || buffered >= BUFFERED_WARN_BYTES) return 'warn'
  return 'ok'
}

// Rolling sparkline of this device's last N lag samples, oldest to newest —
// purely a display concern derived from `devices` (already in the store),
// so it lives as component-local history rather than a new store field.
// Color still switches at the same LAG_WARN_MS/LAG_BAD_MS thresholds as the
// lag number itself, but height scales against its own, taller ceiling —
// topping bars out at LAG_BAD_MS made every bad spike look identical
// (pinned at 100%) with no visual sense of just how far behind a really bad
// stretch was, so a bar going red happens partway up (at 4s/10s = 40%)
// rather than exactly at the top.
const LAG_SPARK_SAMPLES = 20
const LAG_SPARK_MIN_HEIGHT_PCT = 12
const LAG_SPARK_MAX_MS = 10_000

function lagBarSeverity(lagMs: number): 'ok' | 'warn' | 'bad' {
  if (lagMs >= LAG_BAD_MS) return 'bad'
  if (lagMs >= LAG_WARN_MS) return 'warn'
  return 'ok'
}

function useLagHistory(lagMs: number | undefined): number[] {
  const historyRef = useRef<number[]>([])
  const [, bump] = useState(0)
  useEffect(() => {
    historyRef.current = [...historyRef.current, lagMs ?? 0].slice(-LAG_SPARK_SAMPLES)
    bump((n) => n + 1)
  }, [lagMs])
  return historyRef.current
}

function LagSparkline({ lagMs }: { lagMs: number | undefined }): React.JSX.Element {
  const history = useLagHistory(lagMs)
  return (
    <span
      className="status-bar__spark"
      data-tooltip="Recent lag samples, oldest (left) to newest (right) — color switches at the same warn/bad thresholds as the lag number; height scales up to 10s"
    >
      {history.map((sample, i) => (
        <span
          key={i}
          className={`status-bar__spark-bar status-bar__spark-bar--${lagBarSeverity(sample)}`}
          style={{ height: `${Math.max(LAG_SPARK_MIN_HEIGHT_PCT, Math.min(100, (sample / LAG_SPARK_MAX_MS) * 100))}%` }}
        />
      ))}
    </span>
  )
}

function formatLag(lagMs: number | undefined): string {
  if (lagMs === undefined) return '—'
  // A literal 0 here would claim zero transit+processing time, which never
  // actually happens — it just means the true value fell below what
  // Date.now() can resolve (capped at 1ms, and often coarsened further by
  // the browser for timing-attack mitigation — see reportLagFromServerTime
  // in store.ts). Showing "<1ms" says that honestly instead of implying a
  // physically impossible exact zero; adding decimal places instead would
  // fabricate precision this measurement never actually had.
  if (lagMs < 1) return '<1ms'
  if (lagMs < 1000) return `${lagMs}ms`
  return `${(lagMs / 1000).toFixed(1)}s`
}

function formatBuffered(bytes: number | undefined): string {
  if (bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes}B`
  return `${(bytes / 1024).toFixed(1)}KB`
}

// eventLoopDelayMeanMs thresholds — the DCS-BIOS worker (a fixed ~20Hz
// ceiling, see main/plugins/dcsbios.ts's own comment) is designed around
// ~50ms ticks, so a mean delay still well under that is healthy; anything
// climbing toward or past a full tick period means the worker is genuinely
// falling behind processing what it's receiving, not just ordinary jitter.
const EVENT_LOOP_WARN_MS = 20
const EVENT_LOOP_BAD_MS = 100

function dcsBiosSeverity(eventLoopDelayMeanMs: number): 'ok' | 'warn' | 'bad' {
  if (eventLoopDelayMeanMs >= EVENT_LOOP_BAD_MS) return 'bad'
  if (eventLoopDelayMeanMs >= EVENT_LOOP_WARN_MS) return 'warn'
  return 'ok'
}

// Always-visible footer bar (unlike DebugPanel, which is opt-in) — the
// user-facing answer to "is a client actually keeping up." lagMs is that
// device's own self-reported render lag (see device:lag-report in store.ts);
// bufferedAmount is this socket's outbound send-buffer depth sampled
// server-side (see broadcastDevices in main/index.ts) — a rising buffer is
// usually the leading indicator, since it means the server is producing
// broadcasts faster than the connection can drain them, before that ever
// shows up as rendered lag on the device itself.
export function StatusBar(): React.JSX.Element {
  const devices = useDashboardStore((s) => s.devices)
  const connectedDevices = devices.filter((d) => d.connected)
  const enabledPlugins = useDashboardStore((s) => s.enabledPlugins)
  const dcsBiosStatus = useDashboardStore((s) => s.dcsBiosStatus)
  const dcsBiosStats = useDashboardStore((s) => s.dcsBiosStats)
  // Nothing to show at all while the plugin's off — unlike Devices (a core
  // concept this app always has), a disabled/unconfigured DCS-BIOS source
  // has no meaningful "off" state worth taking up bar space for.
  const showDcsBios = enabledPlugins?.includes('dcsbios') ?? false

  return (
    <div className="status-bar">
      <span className="status-bar__label" data-tooltip="Approved clients (tablets/phones) currently connected to this deck">
        Devices
      </span>
      {connectedDevices.length === 0 ? (
        <span className="status-bar__empty" data-tooltip="No approved client currently has a live connection to this deck">
          No devices connected
        </span>
      ) : (
        connectedDevices.map((device) => <DeviceRow key={device.id} device={device} />)
      )}
      {showDcsBios && (
        <>
          <span className="status-bar__label" data-tooltip="The DCS-BIOS event source plugin, connecting to DCS over its UDP export">
            DCS-BIOS
          </span>
          {!dcsBiosStatus?.connected ? (
            <span className="status-bar__empty" data-tooltip="The DCS-BIOS plugin is enabled but hasn't received any UDP export data from DCS yet">
              Not connected
            </span>
          ) : (
            <span
              className={`status-bar__device status-bar__device--${dcsBiosStats ? dcsBiosSeverity(dcsBiosStats.eventLoopDelayMeanMs) : 'ok'}`}
            >
              <span
                className="status-bar__dot"
                data-tooltip="Green: healthy. Yellow/red: the worker's event-loop delay has crossed a threshold — see the loop tooltip"
              />
              <span className="status-bar__metric" data-tooltip="UDP packets received per second from DCS-BIOS — near-zero while 'connected' usually means DCS is paused/loading, not actually mid-mission">
                pkt/s <span className="status-bar__value">{dcsBiosStats ? Math.round(dcsBiosStats.packetsPerSec) : '—'}</span>
              </span>
              <span className="status-bar__metric" data-tooltip="Mean delay between when the worker means to run and when it actually does — rising past a normal tick period means it's falling behind processing DCS's own output">
                loop <span className="status-bar__value">{dcsBiosStats ? `${dcsBiosStats.eventLoopDelayMeanMs.toFixed(1)}ms` : '—'}</span>
              </span>
            </span>
          )}
        </>
      )}
    </div>
  )
}

// Own component (not inlined in the `.map` above) so useLagHistory's hooks
// get a stable per-device instance — React keys the component instance
// (and thus its hook state) by `key`, not by array position, so a device
// disconnecting/reconnecting or the list reordering doesn't scramble whose
// history is whose the way a shared ref keyed by array index would.
function DeviceRow({ device }: { device: DeviceInfo }): React.JSX.Element {
  return (
    <span className={`status-bar__device status-bar__device--${severity(device)}`}>
      <span
        className="status-bar__dot"
        data-tooltip="Green: healthy. Yellow/red: lag or buffered send data has crossed a threshold — see this device's own lag/buf tooltips"
      />
      <span className="status-bar__name" data-tooltip="This device's name, set in its own Device Settings (5-finger tap on the client)">
        {displayDeviceName(device)}
      </span>
      <span
        className="status-bar__metric"
        data-tooltip="How far behind this device's own rendering was as of its last report. High and climbing with buf staying near 0B means this device's own hardware can't keep up processing updates, not a network problem — try lowering the update frequency on whichever event source(s) are ticking fastest (Event Sources modal) to reduce how often it has to re-render"
      >
        lag <span className="status-bar__value">{formatLag(device.lagMs)}</span>
      </span>
      <LagSparkline lagMs={device.lagMs} />
      <span className="status-bar__metric" data-tooltip="Bytes currently queued in this device's outbound send buffer">
        buf <span className="status-bar__value">{formatBuffered(device.bufferedAmount)}</span>
      </span>
    </span>
  )
}
