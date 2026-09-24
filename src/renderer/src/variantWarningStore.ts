import { create } from 'zustand'

export interface VariantWarning {
  id: string
  message: string
}

interface VariantWarningState {
  warnings: VariantWarning[]
  pushWarning: (message: string) => void
  dismissWarning: (id: string) => void
}

let nextWarningId = 0

// Editor-only, client-local notice for "this widget variant references
// variables that don't exist yet" (see Palette.tsx's own
// findMissingVariantVariables) — distinct from store.ts's own
// ActionErrorToast/ToastStack, which is a client concern
// (runtime action-sequence failures) deliberately never rendered in the
// editor at all. This only ever fires from placing a widget variant, so it
// gets its own tiny store rather than overloading that unrelated one.
export const useVariantWarningStore = create<VariantWarningState>((set) => ({
  warnings: [],

  pushWarning: (message) => {
    const id = `variant-warning-${nextWarningId++}`
    set((s) => ({ warnings: [...s.warnings, { id, message }].slice(-5) }))
  },

  dismissWarning: (id) => {
    set((s) => ({ warnings: s.warnings.filter((w) => w.id !== id) }))
  }
}))
