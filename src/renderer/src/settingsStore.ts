import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEVICE_PRESETS } from './devicePresets'

const MIN_PROPERTIES_WIDTH = 200
// Bumped from 480 — the Send DCS command action's field browser (identifier
// + category + value hint in one row) needs more room to stay readable than
// the panel's older, simpler fields ever did. Still just a ceiling the
// user can drag to, not a forced size.
const MAX_PROPERTIES_WIDTH = 900

interface EditorSettings {
  snapToGrid: boolean
  // gridSize itself moved onto Dashboard/SubDeck (see store.ts's setGridSize
  // and shared/subDecks.ts's getSubDeckGridSize) — it's per-screen now, not
  // a single machine-local preference like this one, so it doesn't belong in
  // this store anymore. snapToGrid (whether to snap at all) stays here; only
  // the step size became per-screen.
  propertiesWidth: number
  // A DEVICE_PRESETS id, or a connected device's id — whichever the canvas's
  // dashed bounding box currently previews. Falls back to the first preset
  // if it names a device that's since disconnected.
  selectedDeviceId: string
  // Not persisted (see the `partialize` option below) — purely runtime UI
  // state so any component (not just Toolbar, which renders the modal) can
  // trigger it. `settingsFocusKind` lets a caller (e.g. EventsModal's
  // DCS-BIOS status banner) deep-link straight to one kind's settings panel
  // instead of just telling the user where to look.
  settingsModalOpen: boolean
  settingsFocusKind: string | null
  setSnapToGrid: (value: boolean) => void
  setPropertiesWidth: (value: number) => void
  setSelectedDeviceId: (id: string) => void
  openSettings: (focusKind?: string) => void
  closeSettings: () => void
}

// Editor-only preferences (not part of the synced dashboard data), persisted
// locally so they survive a reload. This is the home for future toolbar
// additions too.
export const useEditorSettings = create<EditorSettings>()(
  persist(
    (set) => ({
      snapToGrid: true,
      propertiesWidth: 260,
      selectedDeviceId: DEVICE_PRESETS[0].id,
      settingsModalOpen: false,
      settingsFocusKind: null,
      setSnapToGrid: (value) => set({ snapToGrid: value }),
      setPropertiesWidth: (value) =>
        set({ propertiesWidth: Math.min(MAX_PROPERTIES_WIDTH, Math.max(MIN_PROPERTIES_WIDTH, Math.round(value))) }),
      setSelectedDeviceId: (id) => set({ selectedDeviceId: id }),
      openSettings: (focusKind) => set({ settingsModalOpen: true, settingsFocusKind: focusKind ?? null }),
      closeSettings: () => set({ settingsModalOpen: false, settingsFocusKind: null })
    }),
    {
      name: 'boarderoni-editor-settings',
      // Transient UI state — reopening the app with the settings modal
      // already open (or focused on whatever kind it last was) would be a
      // surprise, not a convenience, so these two are excluded from the
      // persisted snapshot.
      partialize: (state) => {
        const { settingsModalOpen: _open, settingsFocusKind: _focus, ...rest } = state
        return rest
      }
    }
  )
)
