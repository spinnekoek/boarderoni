import { create } from 'zustand'

interface PromptRequest {
  message: string
  defaultValue: string
  confirmLabel: string
  cancelLabel: string
  resolve: (value: string | null) => void
}

interface PromptState {
  request: PromptRequest | null
  // Resolves to the entered (trimmed) text, or null if cancelled/dismissed —
  // same imperative await-this shape as useConfirmStore's own confirm(),
  // just for "ask for a name" instead of "ask for a yes/no" (see
  // ContextMenu.tsx's "Save as variant" for the first caller).
  prompt: (message: string, options?: { defaultValue?: string; confirmLabel?: string; cancelLabel?: string }) => Promise<string | null>
  resolve: (value: string | null) => void
}

export const usePromptStore = create<PromptState>((set, get) => ({
  request: null,

  prompt: (message, options) => {
    return new Promise((resolve) => {
      set({
        request: {
          message,
          defaultValue: options?.defaultValue ?? '',
          confirmLabel: options?.confirmLabel ?? 'Save',
          cancelLabel: options?.cancelLabel ?? 'Cancel',
          resolve
        }
      })
    })
  },

  resolve: (value) => {
    get().request?.resolve(value)
    set({ request: null })
  }
}))
