import { useEffect } from 'react'
import { useDashboardStore } from '../store'
import { useConfirmStore } from '../confirmStore'
import { useEscapeToClose } from '../useEscapeToClose'
import { ALLOWED_SOUND_EXTENSIONS } from '@shared/sounds'
import { playSound } from '../soundPlayer'

const SOUND_ACCEPT = ALLOWED_SOUND_EXTENSIONS.map((ext) => `.${ext}`).join(',')

// App-wide, user-uploaded sounds — the audio counterpart to FontsModal, and
// laid out the same way for the same reason (its own focused toolbar modal
// rather than another section of a kitchen-sink Settings dialog).
export function SoundsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const customSounds = useDashboardStore((s) => s.customSounds)
  const requestCustomSounds = useDashboardStore((s) => s.requestCustomSounds)
  const uploadCustomSound = useDashboardStore((s) => s.uploadCustomSound)
  const deleteCustomSound = useDashboardStore((s) => s.deleteCustomSound)
  const updateCustomSoundStartAt = useDashboardStore((s) => s.updateCustomSoundStartAt)
  const confirm = useConfirmStore((s) => s.confirm)
  useEscapeToClose(onClose)

  useEffect(() => {
    requestCustomSounds()
  }, [requestCustomSounds])

  function handleSoundFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') uploadCustomSound(reader.result, file.name.replace(/\.[^.]+$/, ''), file.name)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  // Unlike a font, deleting a sound can't be spotted by looking at the
  // canvas — every Play Sound action pointing at it just silently stops
  // making noise — so this one confirms first.
  async function removeSound(soundId: string, label: string): Promise<void> {
    const ok = await confirm(`Delete "${label}"? Any action using it will stop playing anything.`, { confirmLabel: 'Delete' })
    if (ok) deleteCustomSound(soundId)
  }

  return (
    <div className="variables-modal-overlay" onPointerDown={onClose}>
      <div className="variables-modal settings-modal" onPointerDown={(e) => e.stopPropagation()}>
        <div className="variables-modal__header">
          <h2 className="variables-modal__title">Sounds</h2>
          <button type="button" className="modal-close" title="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="variables-modal__body">
          <p className="properties__hint">
            Uploaded sounds are available to every deck&rsquo;s &quot;Play sound&quot; action, app-wide — not scoped to one deck.
            Bytes are stored locally and served only to your own connected clients, never uploaded anywhere else.
          </p>
          <p className="properties__hint">
            Unlike fonts, sounds <strong>are</strong> bundled into a deck when you export it, so a deck you share still plays
            correctly on another machine. Only upload audio you have the rights to share that way.
          </p>
          <div className="properties__field">
            <span>Upload</span>
            <div className="properties__file-row">
              <label className="properties__file-button">
                Choose sound file
                <input type="file" accept={SOUND_ACCEPT} onChange={handleSoundFile} />
              </label>
            </div>
          </div>

          <div className="variables-modal__scroll">
            {customSounds.length === 0 ? (
              <p className="properties__hint">No sounds uploaded yet.</p>
            ) : (
              <ul className="settings-modal__device-list">
                {customSounds.map((sound) => (
                  <li key={sound.id} className="settings-modal__device-row sounds-modal__row">
                    <span className="settings-modal__device-name">{sound.label}</span>
                    <label
                      className="sounds-modal__start-at"
                      title="Skips the first part of the file, for a sample with silence before the sound actually starts. Applies everywhere this sound is used."
                    >
                      <span>Start at</span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        placeholder="0"
                        value={sound.startAtMs ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value
                          updateCustomSoundStartAt(sound.id, raw === '' ? 0 : Number(raw))
                        }}
                      />
                      <span className="properties__unit">ms</span>
                    </label>
                    {/* Plays at full volume, but WITH this sound's own start
                        offset — the point of previewing here is checking that
                        offset is right, which playing from 0 wouldn't show. */}
                    <button type="button" className="properties__file-button" title="Preview" onClick={() => playSound(sound, 1, sound.startAtMs ?? 0)}>
                      ▶ Preview
                    </button>
                    <button type="button" className="device-approval-card__deny" onClick={() => void removeSound(sound.id, sound.label)}>
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
