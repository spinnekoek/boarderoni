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

// A named, independently-styled visual variant of a widget. "Default" (the
// first entry, always present) is the idle look; "Clicked" (conventionally
// the second entry) is shown while the button is held on the view client.
// Anything past those two is inert for now — no runtime mechanism switches to
// them yet, that's future state-machine work — but they're fully editable so
// design work can get ahead of it.
export interface WidgetState {
  id: string
  name: string
  labels: WidgetLabel[]
  color?: string
  borderColor?: string
  backgroundOpacity?: number
  borderOpacity?: number
  // Marks the one state that plays while the button is held on the view
  // client (see getEffectiveStates in shared/states.ts) — a structural flag,
  // not derived from `name`, so renaming some other state to "Clicked"
  // doesn't make it activate on tap. Set only on the state created by
  // enabling states the first time, or by "Reset states"; never on a
  // manually-added state.
  isClicked?: boolean
}

export interface ButtonWidget {
  id: string
  type: 'button'
  x: number
  y: number
  w: number
  h: number
  action: WidgetAction
  // Off (default): only "states[0]" is editable; a lightened version of its
  // color stands in for "clicked" automatically. On: every state is exposed
  // and independently configurable in the properties panel.
  statesEnabled?: boolean
  states: WidgetState[]
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
  // Stable per-browser id the view client generates once and persists
  // locally (see id.ts's getDeviceId) — NOT tied to any one WebSocket
  // connection, so the same device is recognized across reconnects instead
  // of showing up as a brand new entry every time.
  id: string
  width: number
  height: number
  // Raw navigator.userAgent from the view client — real device names aren't
  // exposed to web content, so this is the only material to work with. See
  // friendlyDeviceName in shared/deviceName.ts for turning it into a label.
  userAgent?: string
  // False once its socket disconnects — the entry itself is kept (not
  // removed) so a device picked in the editor's device dropdown stays picked
  // while it reconnects, instead of the selection silently jumping away.
  connected: boolean
  // User-set name from the view client's device settings modal (5-finger
  // tap). Takes priority over the userAgent-derived friendly name wherever a
  // device is displayed — see displayDeviceName in shared/deviceName.ts.
  customName?: string
}

export type ClientToServer =
  | {
      type: 'hello'
      role: 'edit' | 'view'
      viewport?: { width: number; height: number }
      userAgent?: string
      deviceId?: string
    }
  | { type: 'dashboard:update'; dashboard: Dashboard }
  | { type: 'action:trigger'; widgetId: string }
  | { type: 'background-image:upload'; dataUrl: string }
  | { type: 'background-image:clear' }
  | { type: 'device:rename'; deviceId: string; name: string }

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
