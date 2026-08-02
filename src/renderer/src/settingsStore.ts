import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface EditorSettings {
  snapToGrid: boolean
  gridSize: number
  setSnapToGrid: (value: boolean) => void
  setGridSize: (value: number) => void
}

// Editor-only preferences (not part of the synced dashboard data), persisted
// locally so they survive a reload. This is the home for future toolbar
// additions too.
export const useEditorSettings = create<EditorSettings>()(
  persist(
    (set) => ({
      snapToGrid: true,
      gridSize: 8,
      setSnapToGrid: (value) => set({ snapToGrid: value }),
      setGridSize: (value) => set({ gridSize: Math.max(1, Math.round(value)) })
    }),
    { name: 'boarderoni-editor-settings' }
  )
)
