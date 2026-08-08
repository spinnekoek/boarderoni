import { create } from 'zustand'
import { SERVER_PORT, DECK_CLOSE_CODE_UNKNOWN } from '@shared/constants'
import { DEFAULT_DASHBOARD, type ClientToServer, type Dashboard, type DeviceInfo, type ServerToClient, type Widget } from '@shared/types'
import type { DcsBiosCommandCatalogEntry, DcsBiosFieldCatalogEntry, DcsBiosSettings, DcsBiosStatus, DcsBiosWorkerStats } from '@shared/dcsBiosTypes'
import { getDeviceId, setLastDeckId, clearLastDeckId } from './id'

// A field catalog fetch is either not yet requested (absent from the map),
// in flight, resolved, or failed — EventsModal's field browser (see
// components/EventsModal.tsx) renders a different state for each.
export type DcsBiosFieldCatalogState = 'loading' | { error: string } | DcsBiosFieldCatalogEntry[]
// Same idea, for a "Send DCS command" action's command browser (see
// PropertiesPanel.tsx's SendDcsCommandActionEditor).
export type DcsBiosCommandCatalogState = 'loading' | { error: string } | DcsBiosCommandCatalogEntry[]

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
  // DCS-BIOS event source support — all null/empty until first requested,
  // fetched once app-wide and cached rather than per EventSource instance
  // (see EventsModal.tsx). null means "not yet requested," distinct from
  // an empty result.
  dcsBiosAircraft: { id: string; name: string }[] | null
  dcsBiosFieldCatalogs: Record<string, DcsBiosFieldCatalogState>
  dcsBiosCommandCatalogs: Record<string, DcsBiosCommandCatalogState>
  dcsBiosStatus: DcsBiosStatus | null
  dcsBiosStats: DcsBiosWorkerStats | null
  dcsBiosSettings: DcsBiosSettings | null
  // Result of the most recent "Browse…"/inline validation call in the
  // DCS-BIOS settings panel — transient UI feedback, not persisted.
  dcsBiosDocsDirValidation: { docsDir: string; valid: boolean; aircraftCount: number } | null
  dcsBiosPickedFolder: string | null
  // Result of the most recent "Test" send from a Send DCS command action's
  // editor (see PropertiesPanel.tsx) — transient UI feedback, not persisted.
  dcsBiosSendCommandResult: { ok: boolean; error?: string } | null
  // "Enabled data sources" gate (see appSettings.ts) — null until first
  // requested. EventsModal's add-picker filters EVENT_SOURCE_TYPES by this.
  enabledDataSources: string[] | null
  requestDcsBiosAircraftList: () => void
  requestDcsBiosFieldCatalog: (aircraft: string) => void
  requestDcsBiosCommandCatalog: (aircraft: string) => void
  sendDcsBiosCommand: (identifier: string, argument: string) => void
  requestDcsBiosSettings: () => void
  updateDcsBiosSettings: (settings: Partial<DcsBiosSettings>) => void
  requestDcsBiosDocsDirValidation: (docsDir: string) => void
  pickDcsBiosDocsFolder: () => void
  requestAppSettings: () => void
  updateEnabledDataSources: (enabledDataSources: string[]) => void
  connect: (mode: Mode, deckId: string) => void
  // Tears down the current connection and returns to the deck picker (the
  // "← Decks" button in edit mode, "Change deck" in the view-mode device
  // settings modal).
  disconnect: () => void
  updateWidgets: (widgets: Widget[]) => void
  updateDashboardMeta: (
    fields: Partial<
      Pick<Dashboard, 'name' | 'backgroundColor' | 'backgroundColorExpr' | 'backgroundFit' | 'backgroundAnchor' | 'variables' | 'eventSources'>
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
  // value is set only for a live AdjusterWidget drag — see triggerWidget's
  // implementation and the 'action:trigger' WS message shape in types.ts.
  // final: false marks an in-flight drag tick (debounced server-side save
  // instead of a synchronous one); omit/true for a plain click or the drag's
  // final commit on pointer-up.
  triggerWidget: (id: string, value?: number, final?: boolean) => void
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
  dcsBiosAircraft: null,
  dcsBiosFieldCatalogs: {},
  dcsBiosCommandCatalogs: {},
  dcsBiosStatus: null,
  dcsBiosStats: null,
  dcsBiosSettings: null,
  dcsBiosDocsDirValidation: null,
  dcsBiosPickedFolder: null,
  dcsBiosSendCommandResult: null,
  enabledDataSources: null,

  requestDcsBiosAircraftList: () => {
    send({ type: 'dcsbios:list-aircraft' })
  },

  requestDcsBiosFieldCatalog: (aircraft) => {
    set((s) => ({ dcsBiosFieldCatalogs: { ...s.dcsBiosFieldCatalogs, [aircraft]: 'loading' } }))
    send({ type: 'dcsbios:field-catalog', aircraft })
  },

  requestDcsBiosCommandCatalog: (aircraft) => {
    set((s) => ({ dcsBiosCommandCatalogs: { ...s.dcsBiosCommandCatalogs, [aircraft]: 'loading' } }))
    send({ type: 'dcsbios:command-catalog', aircraft })
  },

  sendDcsBiosCommand: (identifier, argument) => {
    send({ type: 'dcsbios:send-command', identifier, argument })
  },

  requestDcsBiosSettings: () => {
    send({ type: 'dcsbios:get-settings' })
  },

  updateDcsBiosSettings: (settings) => {
    send({ type: 'dcsbios:update-settings', settings })
  },

  requestDcsBiosDocsDirValidation: (docsDir) => {
    send({ type: 'dcsbios:validate-docs-dir', docsDir })
  },

  pickDcsBiosDocsFolder: () => {
    send({ type: 'dcsbios:pick-docs-folder' })
  },

  requestAppSettings: () => {
    send({ type: 'app-settings:get' })
  },

  updateEnabledDataSources: (enabledDataSources) => {
    send({ type: 'app-settings:update', enabledDataSources })
  },

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
      } else if (message.type === 'variables:sync') {
        // Same effect as a dashboard:sync as far as `dashboard.variables` is
        // concerned, but leaves `dashboard.widgets`/`eventSources`/`devices`
        // etc. at their existing references instead of replacing the whole
        // object graph — see ServerToClient's own comment on this message.
        set((s) => ({ dashboard: { ...s.dashboard, variables: message.variables } }))
      } else if (message.type === 'action:error') {
        set((s) => ({ errors: { ...s.errors, [message.widgetId]: message.message } }))
      } else if (message.type === 'devices:sync') {
        set({ devices: message.devices })
      } else if (message.type === 'dcsbios:aircraft-list') {
        set({ dcsBiosAircraft: message.aircraft })
      } else if (message.type === 'dcsbios:field-catalog') {
        set((s) => ({ dcsBiosFieldCatalogs: { ...s.dcsBiosFieldCatalogs, [message.aircraft]: message.fields } }))
      } else if (message.type === 'dcsbios:field-catalog-error') {
        set((s) => ({ dcsBiosFieldCatalogs: { ...s.dcsBiosFieldCatalogs, [message.aircraft]: { error: message.message } } }))
      } else if (message.type === 'dcsbios:status') {
        const { type: _type, ...status } = message
        set({ dcsBiosStatus: status })
      } else if (message.type === 'dcsbios:stats') {
        const { type: _type, ...stats } = message
        set({ dcsBiosStats: stats })
      } else if (message.type === 'dcsbios:settings') {
        const { type: _type, ...settings } = message
        set({ dcsBiosSettings: settings })
      } else if (message.type === 'dcsbios:docs-dir-validation') {
        const { type: _type, ...validation } = message
        set({ dcsBiosDocsDirValidation: validation })
      } else if (message.type === 'dcsbios:docs-folder-picked') {
        set({ dcsBiosPickedFolder: message.path })
      } else if (message.type === 'dcsbios:command-catalog') {
        set((s) => ({ dcsBiosCommandCatalogs: { ...s.dcsBiosCommandCatalogs, [message.aircraft]: message.commands } }))
      } else if (message.type === 'dcsbios:command-catalog-error') {
        set((s) => ({ dcsBiosCommandCatalogs: { ...s.dcsBiosCommandCatalogs, [message.aircraft]: { error: message.message } } }))
      } else if (message.type === 'dcsbios:send-command-result') {
        set({ dcsBiosSendCommandResult: { ok: message.ok, error: message.error } })
      } else if (message.type === 'app-settings:settings') {
        set({ enabledDataSources: message.enabledDataSources })
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

  triggerWidget: (id, value, final) => {
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
    send({ type: 'action:trigger', widgetId: id, ...(value !== undefined && { value }), ...(final === false && { final }) })
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
