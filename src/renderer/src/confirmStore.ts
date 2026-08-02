import { create } from 'zustand'

interface ConfirmRequest {
  message: string
  confirmLabel: string
  cancelLabel: string
  resolve: (value: boolean) => void
}

interface ConfirmState {
  request: ConfirmRequest | null
  confirm: (message: string, options?: { confirmLabel?: string; cancelLabel?: string }) => Promise<boolean>
  resolve: (value: boolean) => void
}

// App-wide imperative confirm dialog: any component can `await confirm(...)`
// instead of window.confirm, and the single <ConfirmModal/> mounted in App
// renders whatever request is pending.
export const useConfirmStore = create<ConfirmState>((set, get) => ({
  request: null,

  confirm: (message, options) => {
    return new Promise((resolve) => {
      set({
        request: {
          message,
          confirmLabel: options?.confirmLabel ?? 'Confirm',
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
