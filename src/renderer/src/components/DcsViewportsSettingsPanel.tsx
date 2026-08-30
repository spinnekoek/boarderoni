import { useEffect, useRef, useState } from 'react'
import { useDashboardStore } from '../store'
import type { DcsViewportsSettings } from '@shared/dcsViewportsTypes'
import { DCS_AIRCRAFT_CATALOG } from '@shared/dcsViewportsCatalog'

const RELEASES_URL = 'https://github.com/VirtualDrivers/Virtual-Display-Driver/releases'

// App-wide settings panel for the 'dcsViewports' core plugin — see
// shared/plugins/dcsViewports.ts. Same draft/initialized-ref/patch/Save
// shape as DcsBiosSettingsPanel.tsx, just with two folder fields instead of
// one, plus a resolution and an aircraft picker.
export function DcsViewportsSettingsPanel(): React.JSX.Element {
  const settings = useDashboardStore((s) => s.dcsViewportsSettings)
  const requestSettings = useDashboardStore((s) => s.requestDcsViewportsSettings)
  const updateSettings = useDashboardStore((s) => s.updateDcsViewportsSettings)
  const status = useDashboardStore((s) => s.dcsViewportsStatus)
  const requestStatus = useDashboardStore((s) => s.requestDcsViewportsStatus)
  const requestDcsInstallDirValidation = useDashboardStore((s) => s.requestDcsViewportsDcsInstallDirValidation)
  const dcsInstallDirValidation = useDashboardStore((s) => s.dcsViewportsDcsInstallDirValidation)
  const requestSavedGamesDirValidation = useDashboardStore((s) => s.requestDcsViewportsSavedGamesDirValidation)
  const savedGamesDirValidation = useDashboardStore((s) => s.dcsViewportsSavedGamesDirValidation)
  const pickDcsInstallFolder = useDashboardStore((s) => s.pickDcsViewportsDcsInstallFolder)
  const pickedDcsInstallFolder = useDashboardStore((s) => s.dcsViewportsPickedDcsInstallFolder)
  const pickSavedGamesFolder = useDashboardStore((s) => s.pickDcsViewportsSavedGamesFolder)
  const pickedSavedGamesFolder = useDashboardStore((s) => s.dcsViewportsPickedSavedGamesFolder)
  // Reuses the screen-capture widget's own display list (main/screenCapture.ts's
  // listDisplays) rather than adding a parallel dcsViewports-specific query —
  // it already has everything needed (id/label/bounds) for every physical
  // monitor.
  const displays = useDashboardStore((s) => s.screenCaptureDisplays)
  const requestDisplays = useDashboardStore((s) => s.requestScreenCaptureDisplays)

  const [draft, setDraft] = useState<DcsViewportsSettings | null>(null)
  const initialized = useRef(false)
  const lastPickedDcsInstall = useRef<string | null>(null)
  const lastPickedSavedGames = useRef<string | null>(null)

  useEffect(() => {
    requestSettings()
    requestStatus()
    requestDisplays()
  }, [requestSettings, requestStatus, requestDisplays])

  useEffect(() => {
    if (settings && !initialized.current) {
      initialized.current = true
      setDraft(settings)
      requestDcsInstallDirValidation(settings.dcsInstallDir)
      requestSavedGamesDirValidation(settings.savedGamesDir)
    }
  }, [settings, requestDcsInstallDirValidation, requestSavedGamesDirValidation])

  useEffect(() => {
    if (pickedDcsInstallFolder && pickedDcsInstallFolder !== lastPickedDcsInstall.current) {
      lastPickedDcsInstall.current = pickedDcsInstallFolder
      setDraft((d) => (d ? { ...d, dcsInstallDir: pickedDcsInstallFolder } : d))
      requestDcsInstallDirValidation(pickedDcsInstallFolder)
    }
  }, [pickedDcsInstallFolder, requestDcsInstallDirValidation])

  useEffect(() => {
    if (pickedSavedGamesFolder && pickedSavedGamesFolder !== lastPickedSavedGames.current) {
      lastPickedSavedGames.current = pickedSavedGamesFolder
      setDraft((d) => (d ? { ...d, savedGamesDir: pickedSavedGamesFolder } : d))
      requestSavedGamesDirValidation(pickedSavedGamesFolder)
    }
  }, [pickedSavedGamesFolder, requestSavedGamesDirValidation])

  if (!draft) {
    return <p className="properties__hint">Loading DCS Viewports settings…</p>
  }

  function patch(fields: Partial<DcsViewportsSettings>): void {
    setDraft((d) => (d ? { ...d, ...fields } : d))
  }

  function save(): void {
    if (draft) updateSettings(draft)
  }

  const showDcsInstallValidation = dcsInstallDirValidation && dcsInstallDirValidation.dir === draft.dcsInstallDir
  const showSavedGamesValidation = savedGamesDirValidation && savedGamesDirValidation.dir === draft.savedGamesDir

  return (
    <div className="dcsbios-settings">
      {status && !status.driverInstalled && (
        <p className="properties__hint dcsbios-settings__error">
          Virtual Display Driver not detected.{' '}
          <a href={RELEASES_URL} target="_blank" rel="noreferrer">
            Download it here
          </a>
          , then come back and save these settings.
        </p>
      )}
      {status && status.driverInstalled && !status.displayReady && (
        <p className="properties__hint dcsbios-settings__error">
          Driver detected, but the virtual display isn't ready{status.reason ? `: ${status.reason}` : '.'}
        </p>
      )}
      {status && status.displayReady && (
        <p className="properties__hint">Virtual display ready at {status.bounds?.width}×{status.bounds?.height}.</p>
      )}
      {status && status.luaWritten && status.luaPath && (
        <p className="properties__hint">Boarderoni.lua written to {status.luaPath}.</p>
      )}
      {status && !status.luaWritten && status.luaPath && (
        <p className="properties__hint dcsbios-settings__error">
          Boarderoni.lua not written yet — expected at {status.luaPath}. Enable this plugin (or Save below) once the
          virtual display is ready.
        </p>
      )}
      {status && !status.luaPath && (
        <p className="properties__hint dcsbios-settings__error">
          Boarderoni.lua not written yet — set a valid Saved Games folder below.
        </p>
      )}

      <label className="dcsbios-settings__field">
        <span>Virtual Display Driver install folder</span>
        <input
          value={draft.vddInstallDir}
          placeholder="C:\VirtualDisplayDriver"
          onChange={(e) => patch({ vddInstallDir: e.target.value })}
        />
      </label>

      <label className="dcsbios-settings__field">
        <span>DCS install folder</span>
        <div className="dcsbios-settings__path-row">
          <input
            value={draft.dcsInstallDir}
            placeholder="C:\Program Files\Eagle Dynamics\DCS World"
            onChange={(e) => patch({ dcsInstallDir: e.target.value })}
            onBlur={(e) => requestDcsInstallDirValidation(e.target.value)}
          />
          <button type="button" className="properties__file-button" onClick={pickDcsInstallFolder}>
            Browse…
          </button>
        </div>
        {showDcsInstallValidation && (
          <p className={`properties__hint${dcsInstallDirValidation.valid ? '' : ' dcsbios-settings__error'}`}>
            {dcsInstallDirValidation.valid ? 'Found DCS.exe.' : 'DCS.exe not found at this path.'}
          </p>
        )}
      </label>

      <label className="dcsbios-settings__field">
        <span>DCS Saved Games folder</span>
        <div className="dcsbios-settings__path-row">
          <input
            value={draft.savedGamesDir}
            placeholder="%USERPROFILE%\Saved Games\DCS.openbeta"
            onChange={(e) => patch({ savedGamesDir: e.target.value })}
            onBlur={(e) => requestSavedGamesDirValidation(e.target.value)}
          />
          <button type="button" className="properties__file-button" onClick={pickSavedGamesFolder}>
            Browse…
          </button>
        </div>
        {showSavedGamesValidation && (
          <p className={`properties__hint${savedGamesDirValidation.valid ? '' : ' dcsbios-settings__error'}`}>
            {savedGamesDirValidation.valid ? 'Folder found.' : 'Folder not found.'}
          </p>
        )}
      </label>

      <label className="dcsbios-settings__field">
        <span>Main / gaming monitor</span>
        <select
          value={draft.primaryDisplayId ?? ''}
          onChange={(e) => patch({ primaryDisplayId: e.target.value === '' ? null : Number(e.target.value) })}
        >
          <option value="">Auto (Windows primary display)</option>
          {(displays ?? [])
            .filter((d) => d.id !== status?.displayId)
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
        </select>
        <span className="properties__hint-inline">
          DCS's main 3D view is sized to this monitor. Only needed if Windows' own "primary display" isn't the one you
          actually game on — otherwise leave this on Auto.
        </span>
      </label>

      <label className="dcsbios-settings__field">
        <span>Active aircraft</span>
        <select value={draft.activeAircraft} onChange={(e) => patch({ activeAircraft: e.target.value })}>
          {Object.entries(DCS_AIRCRAFT_CATALOG).map(([id, aircraft]) => (
            <option key={id} value={id}>
              {aircraft.label}
            </option>
          ))}
        </select>
        <span className="properties__hint-inline">
          Only changes which components the DCS Viewport widget offers — every configured aircraft's components are
          always written to the lua file below, so switching planes in DCS works without touching this.
        </span>
      </label>

      <p className="properties__hint">
        In DCS: Options → System → Monitors → select <strong>Boarderoni</strong>.
      </p>
      {status?.recommendedGameResolution && (
        <p className="properties__hint">
          Then Options → System → Resolution →{' '}
          <strong>
            {status.recommendedGameResolution.width}×{status.recommendedGameResolution.height}, Fullscreen
          </strong>
          . DCS renders one surface spanning every monitor currently connected — including ones not used for any
          viewport — then crops Center/the MFCDs out of it by pixel position, so this has to cover your full desktop,
          not just the primary monitor and virtual display. Computed live from your current Windows arrangement; a
          moved or newly connected monitor changes this number even if it's otherwise unrelated to DCS.
        </p>
      )}

      <div className="dcsbios-settings__actions">
        <button type="button" className="device-modal__save" onClick={save}>
          Save DCS Viewports settings
        </button>
      </div>
    </div>
  )
}
