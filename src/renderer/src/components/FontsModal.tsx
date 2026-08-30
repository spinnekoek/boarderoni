import { useEffect } from 'react'
import { useDashboardStore } from '../store'
import { useEscapeToClose } from '../useEscapeToClose'
import { ALLOWED_FONT_EXTENSIONS, DEFAULT_LABEL_LINE_HEIGHT } from '@shared/fonts'

const FONT_ACCEPT = ALLOWED_FONT_EXTENSIONS.map((ext) => `.${ext}`).join(',')

// App-wide, user-uploaded fonts — split out of the old monolithic
// SettingsModal into its own toolbar modal, same as Plugins/Approved
// devices, each now a focused concern with its own toolbar button instead
// of one kitchen-sink Settings modal.
export function FontsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const customFonts = useDashboardStore((s) => s.customFonts)
  const requestCustomFonts = useDashboardStore((s) => s.requestCustomFonts)
  const uploadCustomFont = useDashboardStore((s) => s.uploadCustomFont)
  const deleteCustomFont = useDashboardStore((s) => s.deleteCustomFont)
  const updateCustomFontLineHeight = useDashboardStore((s) => s.updateCustomFontLineHeight)
  useEscapeToClose(onClose)

  useEffect(() => {
    requestCustomFonts()
  }, [requestCustomFonts])

  function handleFontFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') uploadCustomFont(reader.result, file.name.replace(/\.[^.]+$/, ''), file.name)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  return (
    <div className="variables-modal-overlay" onPointerDown={onClose}>
      <div className="variables-modal settings-modal" onPointerDown={(e) => e.stopPropagation()}>
        <div className="variables-modal__header">
          <h2 className="variables-modal__title">Fonts</h2>
          <button type="button" className="modal-close" title="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="variables-modal__body">
          <p className="properties__hint">
            Uploaded fonts appear in every label's Font picker, app-wide — not scoped to one deck. Bytes are stored
            locally and served only to your own connected clients (desktop editor and any approved view devices),
            never uploaded anywhere else.
          </p>
          <p className="properties__hint">
            <strong>You&rsquo;re responsible for having the rights to use whatever font you upload here.</strong>{' '}
            Most commercial fonts (desktop licenses in particular) do <em>not</em> permit embedding the font file in
            software you distribute or share — that typically needs a separate app/embedding license from the
            foundry. Free/open fonts explicitly licensed for this (e.g. SIL Open Font License) are the safe default;
            a font you just downloaded from a random "free fonts" site often isn&rsquo;t actually licensed for this
            at all, whatever the site claims.
          </p>
          <div className="properties__field">
            <span>Upload</span>
            <div className="properties__file-row">
              <label className="properties__file-button">
                Choose font file
                <input type="file" accept={FONT_ACCEPT} onChange={handleFontFile} />
              </label>
            </div>
          </div>

          <div className="variables-modal__scroll">
            {customFonts.length === 0 ? (
              <p className="properties__hint">No custom fonts uploaded yet.</p>
            ) : (
              <ul className="settings-modal__device-list">
                {customFonts.map((font) => (
                  <li key={font.id} className="settings-modal__device-row">
                    <span className="settings-modal__device-name">{font.label}</span>
                    <label
                      className="settings-modal__font-line-height"
                      title="Some fonts' own internal metrics need a different line height than the shared default to avoid overlapping or too-loose lines — blank uses that default."
                    >
                      <span>Line height</span>
                      <input
                        type="number"
                        step={0.01}
                        min={0.1}
                        placeholder={String(DEFAULT_LABEL_LINE_HEIGHT)}
                        value={font.lineHeight ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value
                          updateCustomFontLineHeight(font.id, raw === '' ? null : Number(raw))
                        }}
                      />
                    </label>
                    <button type="button" className="device-approval-card__deny" onClick={() => deleteCustomFont(font.id)}>
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
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
