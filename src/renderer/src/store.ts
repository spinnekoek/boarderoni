import { create } from 'zustand'
import { SERVER_PORT, DECK_CLOSE_CODE_UNKNOWN } from '@shared/constants'
import { DEFAULT_DASHBOARD, type ClientToServer, type Dashboard, type DeviceInfo, type ServerToClient, type Widget } from '@shared/types'
import { getDeviceId, setLastDeckId, clearLastDeckId } from './id'

type Mode = 'edit' | 'view'

interface DashboardStore {
  // Null until a deck is chosen in the picker — the single source of truth
  // for "which screen is showing" (see App.tsx).
  deckId: string | null
  dashboard: Dashboard
  mode: Mode
  connected: boolean
  errors: Record<string, string>
  selectedWidgetIds: string[]
  // Which base block of a selected morph widget the properties panel's
  // spacing/radius/border sub-panel targets — reset to null on every
  // widget-selection change (see selectWidget/pasteWidgets/removeWidget(s)).
  selectedBlockId: string | null
  // Which of the selected widget's states the editor canvas previews (its
  // properties panel tab) — reset to 0 (Default) on every selection change.
  activeStateIndex: number
  devices: DeviceInfo[]
  connect: (mode: Mode, deckId: string) => void
  // Tears down the current connection and returns to the deck picker (the
  // "← Decks" button in edit mode, "Change deck" in the view-mode device
  // settings modal).
  disconnect: () => void
  updateWidgets: (widgets: Widget[]) => void
  updateDashboardMeta: (
    fields: Partial<
      Pick<Dashboard, 'name' | 'backgroundColor' | 'backgroundFit' | 'backgroundAnchor' | 'variables' | 'eventSources'>
    >
  ) => void
  uploadBackgroundImage: (dataUrl: string) => void
  clearBackgroundImage: () => void
  addWidget: (widget: Widget) => void
  pasteWidgets: (widgets: Widget[]) => void
  bringToFront: (ids: string[]) => void
  sendToBack: (ids: string[]) => void
  removeWidget: (id: string) => void
  removeWidgets: (ids: string[]) => void
  triggerWidget: (id: string) => void
  selectWidget: (id: string | null, options?: { additive?: boolean }) => void
  // Marquee (shift-drag) selection — replaces the current selection by
  // default, or unions with it when additive (shift-drag always passes
  // additive, matching shift-click's existing meaning elsewhere).
  selectWidgets: (ids: string[], options?: { additive?: boolean }) => void
  selectBlock: (id: string | null) => void
  setActiveStateIndex: (index: number | ((current: number) => number)) => void
  renameDevice: (deviceId: string, name: string) => void
}

let socket: WebSocket | null = null
// Set by disconnect() just before closing, so the close listener below knows
// this was a deliberate "back to picker" close rather than a network drop —
// without it, the existing auto-reconnect would silently redial the same
// deck 1.5s after the user chose to leave it.
let intentionalDisconnect = false

function send(message: ClientToServer): void {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message))
  }
}

function isTextInputElement(el: Element | null): boolean {
  return el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
}

function sendHello(mode: Mode): void {
  if (mode === 'view') {
    send({
      type: 'hello',
      role: mode,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      userAgent: navigator.userAgent,
      deviceId: getDeviceId()
    })
  } else {
    send({ type: 'hello', role: mode })
  }
}

// Shared "back to the picker" state, used both by an explicit disconnect()
// and by the close listener's DECK_CLOSE_CODE_UNKNOWN branch below.
function pickerResetState(): Pick<
  DashboardStore,
  'deckId' | 'connected' | 'dashboard' | 'devices' | 'errors' | 'selectedWidgetIds' | 'selectedBlockId' | 'activeStateIndex'
> {
  return {
    deckId: null,
    connected: false,
    dashboard: DEFAULT_DASHBOARD,
    devices: [],
    errors: {},
    selectedWidgetIds: [],
    selectedBlockId: null,
    activeStateIndex: 0
  }
}

export const useDashboardStore = create<DashboardStore>((set, get) => ({
  deckId: null,
  dashboard: DEFAULT_DASHBOARD,
  mode: 'edit',
  connected: false,
  errors: {},
  selectedWidgetIds: [],
  selectedBlockId: null,
  activeStateIndex: 0,
  devices: [],

  connect: (mode, deckId) => {
    set({ mode, deckId })
    setLastDeckId(deckId)
    if (socket) return

    const host = window.location.hostname || 'localhost'
    const ws = new WebSocket(`ws://${host}:${SERVER_PORT}/ws?deck=${encodeURIComponent(deckId)}`)
    socket = ws

    ws.addEventListener('open', () => {
      set({ connected: true })
      sendHello(mode)
    })

    ws.addEventListener('close', (event) => {
      socket = null
      if (intentionalDisconnect) {
        intentionalDisconnect = false
        return
      }
      if (event.code === DECK_CLOSE_CODE_UNKNOWN) {
        // The deck this connection named is missing or was deleted — retrying
        // it would just spin forever, so fall back to the picker instead of
        // auto-reconnecting. Also forget it as "last opened" — otherwise the
        // next launch would just try to restore this same dead id again.
        clearLastDeckId()
        set(pickerResetState())
        return
      }
      set({ connected: false })
      setTimeout(() => get().connect(mode, deckId), 1500)
    })

    ws.addEventListener('message', (event) => {
      const message: ServerToClient = JSON.parse(event.data)
      if (message.type === 'dashboard:sync') {
        set({ dashboard: message.dashboard })
      } else if (message.type === 'action:error') {
        set((s) => ({ errors: { ...s.errors, [message.widgetId]: message.message } }))
      } else if (message.type === 'devices:sync') {
        set({ devices: message.devices })
      }
    })

    if (mode === 'view') {
      // Android shrinks window.innerHeight when the on-screen keyboard opens
      // (e.g. focusing the device settings modal's name field), which would
      // otherwise get reported as the device's real viewport and shrink its
      // guide bounds on the desktop. Skip the resize while a text field is
      // focused; focusout re-syncs once the keyboard has had a moment to
      // close back down.
      window.addEventListener('resize', () => {
        if (isTextInputElement(document.activeElement)) return
        sendHello(mode)
      })
      document.addEventListener(
        'focusout',
        (e) => {
          if (isTextInputElement(e.target as Element | null)) {
            setTimeout(() => sendHello(mode), 250)
          }
        },
        true
      )
    }
  },

  disconnect: () => {
    intentionalDisconnect = true
    socket?.close()
    socket = null
    clearLastDeckId()
    set(pickerResetState())
  },

  updateWidgets: (widgets) => {
    const dashboard = { ...get().dashboard, widgets }
    set({ dashboard })
    send({ type: 'dashboard:update', dashboard })
  },

  updateDashboardMeta: (fields) => {
    const dashboard = { ...get().dashboard, ...fields }
    set({ dashboard })
    send({ type: 'dashboard:update', dashboard })
  },

  uploadBackgroundImage: (dataUrl) => {
    send({ type: 'background-image:upload', dataUrl })
  },

  clearBackgroundImage: () => {
    send({ type: 'background-image:clear' })
  },

  addWidget: (widget) => {
    get().updateWidgets([...get().dashboard.widgets, widget])
  },

  // Pasted widgets replace the current selection with themselves, so a
  // pasted batch is immediately draggable as a group without an extra click.
  pasteWidgets: (widgets) => {
    get().updateWidgets([...get().dashboard.widgets, ...widgets])
    set({ selectedWidgetIds: widgets.map((w) => w.id), selectedBlockId: null, activeStateIndex: 0 })
  },

  // Widgets render (and thus paint-stack) in array order — last wins any
  // overlap. These reorder within the array without touching x/y/etc, so a
  // widget can be pulled on top of (or pushed under) whatever it visually
  // overlaps without an explicit per-widget z-index.
  bringToFront: (ids) => {
    const idSet = new Set(ids)
    const widgets = get().dashboard.widgets
    get().updateWidgets([...widgets.filter((w) => !idSet.has(w.id)), ...widgets.filter((w) => idSet.has(w.id))])
  },

  sendToBack: (ids) => {
    const idSet = new Set(ids)
    const widgets = get().dashboard.widgets
    get().updateWidgets([...widgets.filter((w) => idSet.has(w.id)), ...widgets.filter((w) => !idSet.has(w.id))])
  },

  removeWidget: (id) => {
    get().updateWidgets(get().dashboard.widgets.filter((w) => w.id !== id))
    set((s) => ({ selectedWidgetIds: s.selectedWidgetIds.filter((w) => w !== id), selectedBlockId: null }))
  },

  removeWidgets: (ids) => {
    const idSet = new Set(ids)
    get().updateWidgets(get().dashboard.widgets.filter((w) => !idSet.has(w.id)))
    set((s) => ({ selectedWidgetIds: s.selectedWidgetIds.filter((w) => !idSet.has(w)), selectedBlockId: null }))
  },

  triggerWidget: (id) => {
    // Optimistically clear any error from a previous attempt — otherwise a
    // stale red banner sticks on the widget forever, even after fixing
    // whatever caused it, since nothing else ever removes an entry here. A
    // fresh action:error re-populates it if this attempt fails too.
    set((s) => {
      if (!(id in s.errors)) return {}
      const errors = { ...s.errors }
      delete errors[id]
      return { errors }
    })
    send({ type: 'action:trigger', widgetId: id })
  },

  selectWidget: (id, options) => {
    if (id === null) {
      set({ selectedWidgetIds: [], selectedBlockId: null, activeStateIndex: 0 })
      return
    }
    if (options?.additive) {
      set((s) => ({
        selectedWidgetIds: s.selectedWidgetIds.includes(id)
          ? s.selectedWidgetIds.filter((w) => w !== id)
          : [...s.selectedWidgetIds, id],
        selectedBlockId: null,
        activeStateIndex: 0
      }))
      return
    }
    set((s) => {
      // A no-op re-click on an already-sole-selected widget (see
      // useWidgetDrag's handlePointerUp, which re-confirms selection on
      // every clean click so a multi-select can collapse to one) must not
      // clobber a block selection made in this same click's pointerdown.
      if (s.selectedWidgetIds.length === 1 && s.selectedWidgetIds[0] === id) return {}
      return { selectedWidgetIds: [id], selectedBlockId: null, activeStateIndex: 0 }
    })
  },

  selectWidgets: (ids, options) => {
    set((s) => ({
      selectedWidgetIds: options?.additive ? Array.from(new Set([...s.selectedWidgetIds, ...ids])) : ids,
      selectedBlockId: null,
      activeStateIndex: 0
    }))
  },

  selectBlock: (id) => {
    set({ selectedBlockId: id })
  },

  setActiveStateIndex: (indexOrUpdater) => {
    set((s) => ({
      activeStateIndex: typeof indexOrUpdater === 'function' ? indexOrUpdater(s.activeStateIndex) : indexOrUpdater
    }))
  },

  renameDevice: (deviceId, name) => {
    send({ type: 'device:rename', deviceId, name })
  }
}))
