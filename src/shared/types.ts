export interface KeypressAction {
  kind: 'keypress'
  keys: string[]
}

export type WidgetAction = KeypressAction

// x/y/w/h are absolute CSS pixels on the dashboard canvas — not grid units.
// A widget is always rendered at exactly this pixel size on every client, no
// responsive scaling, so what you place inside a device's bounds rectangle
// in the editor is exactly what fits on that device's screen.
export type HorizontalAlign = 'left' | 'center' | 'right'
export type VerticalAlign = 'top' | 'center' | 'bottom'

// Each label is an independently-styled/positioned text layer within the
// button's box — no auto-stacking, so two labels sharing the same
// align/verticalAlign simply overlap. Keybindings stay on the widget itself
// (see ButtonWidget.action) since they trigger the button, not a label.
export interface WidgetLabel {
  id: string
  text: string
  fontFamily?: string
  fontSize?: number
  textColor?: string
  textOpacity?: number
  align?: HorizontalAlign
  verticalAlign?: VerticalAlign
  padding?: number
}

export interface ButtonWidget {
  id: string
  type: 'button'
  x: number
  y: number
  w: number
  h: number
  labels: WidgetLabel[]
  color?: string
  borderColor?: string
  backgroundOpacity?: number
  borderOpacity?: number
  action: WidgetAction
}

export type Widget = ButtonWidget

// 'cover'/'contain'/'stretch' scale the image proportionally or not, 'tile'
// repeats it at native size, 'none' places it at native size unscaled — the
// last of which pairs with backgroundAnchor for a fixed-position logo.
export type BackgroundFit = 'cover' | 'contain' | 'stretch' | 'tile' | 'none'
export type BackgroundAnchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

export interface Dashboard {
  id: string
  name: string
  backgroundColor: string
  // The image itself lives server-side and is fetched over plain HTTP at
  // /background-image — embedding it as a data URL here would mean every
  // dashboard:update (including per-frame widget drags) re-sends the whole
  // image over the WebSocket to every client.
  backgroundImageVersion?: number
  backgroundImageMime?: string
  backgroundFit?: BackgroundFit
  backgroundAnchor?: BackgroundAnchor
  // Rendering inset (px) applied to every widget's left/top edge — affects
  // actual layout on every client (including the deployed mobile view), so
  // unlike snapToGrid/gridSize (editor-only, in settingsStore.ts) this has to
  // live in the synced dashboard, not local editor settings.
  spacing?: number
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
  | { type: 'background-image:upload'; dataUrl: string }
  | { type: 'background-image:clear' }

export type ServerToClient =
  | { type: 'dashboard:sync'; dashboard: Dashboard }
  | { type: 'action:error'; widgetId: string; message: string }
  | { type: 'devices:sync'; devices: DeviceInfo[] }

export const DEFAULT_DASHBOARD: Dashboard = {
  id: 'default',
  name: 'Untitled Dashboard',
  backgroundColor: '#14161b',
  backgroundFit: 'cover',
  backgroundAnchor: 'center',
  widgets: []
}
