import { useEffect, useRef, useState } from 'react'
import { useDashboardStore } from '../store'
import type { DcsBiosSettings } from '@shared/dcsBiosTypes'

const MIN_UPDATE_HZ = 1
const MAX_UPDATE_HZ = 25

export function DcsBiosSettingsPanel(): React.JSX.Element {
  const settings = useDashboardStore((s) => s.dcsBiosSettings)
  const requestSettings = useDashboardStore((s) => s.requestDcsBiosSettings)
  const updateSettings = useDashboardStore((s) => s.updateDcsBiosSettings)
  const requestValidation = useDashboardStore((s) => s.requestDcsBiosDocsDirValidation)
  const validation = useDashboardStore((s) => s.dcsBiosDocsDirValidation)
  const pickFolder = useDashboardStore((s) => s.pickDcsBiosDocsFolder)
  const pickedFolder = useDashboardStore((s) => s.dcsBiosPickedFolder)

  const [draft, setDraft] = useState<DcsBiosSettings | null>(null)
  const initialized = useRef(false)
  const lastPicked = useRef<string | null>(null)

  useEffect(() => {
    requestSettings()
  }, [requestSettings])

  // Seed the editable draft once the real settings arrive — subsequent
  // pushes (e.g. this panel's own Save round-tripping) don't clobber
  // whatever's being edited.
  useEffect(() => {
    if (settings && !initialized.current) {
      initialized.current = true
      setDraft(settings)
      requestValidation(settings.docsDir)
    }
  }, [settings, requestValidation])

  // The "Browse…" folder picker reports back through the same store slice
  // a Save round-trip would use — only react to an actual new pick (a
  // cancelled dialog reports `path: null`, which is correctly ignored here).
  useEffect(() => {
    if (pickedFolder && pickedFolder !== lastPicked.current) {
      lastPicked.current = pickedFolder
      setDraft((d) => (d ? { ...d, docsDir: pickedFolder } : d))
      requestValidation(pickedFolder)
    }
  }, [pickedFolder, requestValidation])

  if (!draft) {
    return <p className="properties__hint">Loading DCS-BIOS settings…</p>
  }

  function patch(fields: Partial<DcsBiosSettings>): void {
    setDraft((d) => (d ? { ...d, ...fields } : d))
  }

  const showValidation = validation && validation.docsDir === draft.docsDir

  return (
    <div className="dcsbios-settings">
      <label className="dcsbios-settings__field">
        <span>DCS-BIOS docs folder</span>
        <div className="dcsbios-settings__path-row">
          <input
            value={draft.docsDir}
            placeholder="…\Saved Games\DCS\Scripts\DCS-BIOS\doc\json"
            onChange={(e) => patch({ docsDir: e.target.value })}
            onBlur={(e) => requestValidation(e.target.value)}
          />
          <button type="button" className="properties__file-button" onClick={pickFolder}>
            Browse…
          </button>
        </div>
        {showValidation && (
          <p className={`properties__hint${validation.valid ? '' : ' dcsbios-settings__error'}`}>
            {validation.valid
              ? `Found ${validation.aircraftCount} aircraft module${validation.aircraftCount === 1 ? '' : 's'}.`
              : 'No DCS-BIOS aircraft docs found at this path.'}
          </p>
        )}
      </label>

      <label className="dcsbios-settings__field">
        <span>Multicast address</span>
        <input value={draft.multicastAddress} onChange={(e) => patch({ multicastAddress: e.target.value })} />
      </label>

      <label className="dcsbios-settings__field">
        <span>Multicast port</span>
        <input
          type="number"
          value={draft.multicastPort}
          onChange={(e) => patch({ multicastPort: Number(e.target.value) })}
        />
      </label>

      <label className="dcsbios-settings__field">
        <span>Command (send) port</span>
        <input type="number" value={draft.sendPort} onChange={(e) => patch({ sendPort: Number(e.target.value) })} />
        <span className="properties__hint-inline">Reserved for sending commands back to DCS-BIOS — stored now, not used yet.</span>
      </label>

      <label className="dcsbios-settings__field">
        <span>Default update frequency: {draft.defaultUpdateHz}/sec</span>
        <input
          type="range"
          min={MIN_UPDATE_HZ}
          max={MAX_UPDATE_HZ}
          value={draft.defaultUpdateHz}
          onChange={(e) => patch({ defaultUpdateHz: Number(e.target.value) })}
        />
        <span className="properties__hint-inline">The starting rate a newly-added DCS-BIOS event source uses — each source can override it.</span>
      </label>

      <div className="dcsbios-settings__actions">
        <button type="button" className="device-modal__save" onClick={() => updateSettings(draft)}>
          Save connection settings
        </button>
      </div>
    </div>
  )
}
