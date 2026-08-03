import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEVICE_PRESETS } from './devicePresets'

const MIN_PROPERTIES_WIDTH = 200
const MAX_PROPERTIES_WIDTH = 480

interface EditorSettings {
  snapToGrid: boolean
  gridSize: number
  propertiesWidth: number
  // A DEVICE_PRESETS id, or a connected device's id — whichever the canvas's
  // dashed bounding box currently previews. Falls back to the first preset
  // if it names a device that's since disconnected.
  selectedDeviceId: string
  setSnapToGrid: (value: boolean) => void
  setGridSize: (value: number) => void
  setPropertiesWidth: (value: number) => void
  setSelectedDeviceId: (id: string) => void
}

// Editor-only preferences (not part of the synced dashboard data), persisted
// locally so they survive a reload. This is the home for future toolbar
// additions too.
export const useEditorSettings = create<EditorSettings>()(
  persist(
    (set) => ({
      snapToGrid: true,
      gridSize: 8,
      propertiesWidth: 260,
      selectedDeviceId: DEVICE_PRESETS[0].id,
      setSnapToGrid: (value) => set({ snapToGrid: value }),
      setGridSize: (value) => set({ gridSize: Math.max(1, Math.round(value)) }),
      setPropertiesWidth: (value) =>
        set({ propertiesWidth: Math.min(MAX_PROPERTIES_WIDTH, Math.max(MIN_PROPERTIES_WIDTH, Math.round(value))) }),
      setSelectedDeviceId: (id) => set({ selectedDeviceId: id })
    }),
    { name: 'boarderoni-editor-settings' }
  )
)
