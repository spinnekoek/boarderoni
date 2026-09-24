import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEVICE_PRESETS } from './devicePresets'

const MIN_PROPERTIES_WIDTH = 200
// Bumped from 480 — the Send DCS command action's field browser (identifier
// + category + value hint in one row) needs more room to stay readable than
// the panel's older, simpler fields ever did. Still just a ceiling the
// user can drag to, not a forced size.
const MAX_PROPERTIES_WIDTH = 900

export interface Camera {
  x: number
  y: number
  zoom: number
}

export const INITIAL_CAMERA: Camera = { x: 80, y: 80, zoom: 1 }

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
  // Shows editor-only layout aids (currently: each position label's own
  // alignment box, red-outlined — see .deck-toggle-switch__label / .debug-mode
  // in styles.css) that are otherwise invisible, to make align/anchor
  // settings' actual effect easier to reason about. Never affects the
  // client, only the editor canvas.
  debugMode: boolean
  // Canvas pan/zoom — not persisted (see partialize below): reopening the
  // app centered on wherever the camera last was would be a surprise, not a
  // convenience. Lives here rather than as Canvas's own local state so
  // other components (e.g. Palette, to spawn a new widget under the
  // currently-visible corner rather than the board's origin) can read it
  // too.
  camera: Camera
  // The Event Sources modal's own last-active source tab (a Plugin.id) —
  // lives here, not the modal's local state, since the modal fully unmounts
  // on close (see Toolbar.tsx's `{eventSourcesOpen && <EventSourcesModal .../>}`),
  // which would otherwise discard it every time. A stale id (source
  // deleted, or this dashboard has none) is already handled by
  // EventSourcesModal's own fallback-to-first-source effect, so persisting
  // it across dashboards/restarts is harmless even though it's only really
  // meaningful within one.
  eventSourcesModalActiveSourceId: string | null
  // Not persisted (see `partialize` below) — purely runtime UI state so any
  // component (not just Toolbar, which renders the modal) can trigger it.
  // EventSourcesModal's own "this plugin is disabled"/"configure it" links
  // use `openPluginsModal(kind)` to jump straight to and expand that kind's
  // row in the (separate) Plugins modal, instead of just telling the user
  // where to look.
  pluginsModalOpen: boolean
  pluginsModalFocusKind: string | null
  setSnapToGrid: (value: boolean) => void
  setPropertiesWidth: (value: number) => void
  setSelectedDeviceId: (id: string) => void
  setDebugMode: (value: boolean) => void
  setCamera: (updater: Camera | ((camera: Camera) => Camera)) => void
  setEventSourcesModalActiveSourceId: (id: string | null) => void
  openPluginsModal: (focusKind?: string) => void
  closePluginsModal: () => void
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
      debugMode: false,
      camera: INITIAL_CAMERA,
      eventSourcesModalActiveSourceId: null,
      pluginsModalOpen: false,
      pluginsModalFocusKind: null,
      setSnapToGrid: (value) => set({ snapToGrid: value }),
      setPropertiesWidth: (value) =>
        set({ propertiesWidth: Math.min(MAX_PROPERTIES_WIDTH, Math.max(MIN_PROPERTIES_WIDTH, Math.round(value))) }),
      setSelectedDeviceId: (id) => set({ selectedDeviceId: id }),
      setDebugMode: (value) => set({ debugMode: value }),
      setCamera: (updater) => set((s) => ({ camera: typeof updater === 'function' ? updater(s.camera) : updater })),
      setEventSourcesModalActiveSourceId: (id) => set({ eventSourcesModalActiveSourceId: id }),
      openPluginsModal: (focusKind) => set({ pluginsModalOpen: true, pluginsModalFocusKind: focusKind ?? null }),
      closePluginsModal: () => set({ pluginsModalOpen: false, pluginsModalFocusKind: null })
    }),
    {
      name: 'boarderoni-editor-settings',
      // Transient UI state — reopening the app with the Plugins modal
      // already open (or focused on whatever kind it last was), or centered
      // on wherever the canvas was last panned/zoomed to, would be a
      // surprise, not a convenience, so these are excluded from the
      // persisted snapshot.
      partialize: (state) => {
        const { camera: _camera, pluginsModalOpen: _open, pluginsModalFocusKind: _focus, ...rest } = state
        return rest
      }
    }
  )
)
