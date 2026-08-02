export interface KeypressAction {
  kind: 'keypress'
  keys: string[]
}

export type WidgetAction = KeypressAction

// x/y/w/h are absolute CSS pixels on the dashboard canvas — not grid units.
// A widget is always rendered at exactly this pixel size on every client, no
// responsive scaling, so what you place inside a device's bounds rectangle
// in the editor is exactly what fits on that device's screen.
export interface ButtonWidget {
  id: string
  type: 'button'
  x: number
  y: number
  w: number
  h: number
  label: string
  fontFamily?: string
  action: WidgetAction
}

export type Widget = ButtonWidget

export interface Dashboard {
  id: string
  name: string
  widgets: Widget[]
}

export interface DeviceInfo {
  id: string
  width: number
  height: number
}

export type ClientToServer =
  | { type: 'hello'; role: 'edit' | 'view'; viewport?: { width: number; height: number } }
  | { type: 'dashboard:update'; dashboard: Dashboard }
  | { type: 'action:trigger'; widgetId: string }

export type ServerToClient =
  | { type: 'dashboard:sync'; dashboard: Dashboard }
  | { type: 'action:error'; widgetId: string; message: string }
  | { type: 'devices:sync'; devices: DeviceInfo[] }

export const DEFAULT_DASHBOARD: Dashboard = {
  id: 'default',
  name: 'Untitled Dashboard',
  widgets: []
}
