import { create } from 'zustand'
import { SERVER_PORT } from '@shared/constants'
import { DEFAULT_DASHBOARD, type ClientToServer, type Dashboard, type DeviceInfo, type ServerToClient, type Widget } from '@shared/types'

type Mode = 'edit' | 'view'

interface DashboardStore {
  dashboard: Dashboard
  mode: Mode
  connected: boolean
  errors: Record<string, string>
  selectedWidgetId: string | null
  devices: DeviceInfo[]
  connect: (mode: Mode) => void
  updateWidgets: (widgets: Widget[]) => void
  updateDashboardMeta: (
    fields: Partial<Pick<Dashboard, 'name' | 'backgroundColor' | 'backgroundFit' | 'backgroundAnchor' | 'spacing'>>
  ) => void
  uploadBackgroundImage: (dataUrl: string) => void
  clearBackgroundImage: () => void
  addWidget: (widget: Widget) => void
  removeWidget: (id: string) => void
  triggerWidget: (id: string) => void
  selectWidget: (id: string | null) => void
}

let socket: WebSocket | null = null

function send(message: ClientToServer): void {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message))
  }
}

function sendHello(mode: Mode): void {
  if (mode === 'view') {
    send({ type: 'hello', role: mode, viewport: { width: window.innerWidth, height: window.innerHeight } })
  } else {
    send({ type: 'hello', role: mode })
  }
}

export const useDashboardStore = create<DashboardStore>((set, get) => ({
  dashboard: DEFAULT_DASHBOARD,
  mode: 'edit',
  connected: false,
  errors: {},
  selectedWidgetId: null,
  devices: [],

  connect: (mode) => {
    set({ mode })
    if (socket) return

    const host = window.location.hostname || 'localhost'
    const ws = new WebSocket(`ws://${host}:${SERVER_PORT}/ws`)
    socket = ws

    ws.addEventListener('open', () => {
      set({ connected: true })
      sendHello(mode)
    })

    ws.addEventListener('close', () => {
      set({ connected: false })
      socket = null
      setTimeout(() => get().connect(mode), 1500)
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
      window.addEventListener('resize', () => sendHello(mode))
    }
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

  removeWidget: (id) => {
    get().updateWidgets(get().dashboard.widgets.filter((w) => w.id !== id))
    if (get().selectedWidgetId === id) set({ selectedWidgetId: null })
  },

  triggerWidget: (id) => {
    send({ type: 'action:trigger', widgetId: id })
  },

  selectWidget: (id) => {
    set({ selectedWidgetId: id })
  }
}))
