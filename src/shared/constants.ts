// Single port serves the WebSocket (state sync + triggers) and, in a production
// build, the static renderer bundle that the Android WebView loads.
export const SERVER_PORT = 17334

// The MCP server (see main/mcp/) gets its OWN port, deliberately never
// shared with SERVER_PORT above: that listener binds with no host arg
// (all-interfaces, advertised over mDNS for the Android client), while the
// MCP server needs to be loopback-only (127.0.0.1) — an AI agent driving
// live dashboard edits is a much more powerful control surface than
// anything else this app exposes, and Node's http.Server only supports one
// bind per listen() call, so sharing SERVER_PORT would mean either exposing
// MCP on the LAN or loopback-binding the whole app server and breaking the
// phone client. See main/mcp/server.ts for the loopback bind + bearer-token
// auth this port is gated behind.
export const MCP_SERVER_PORT = 17335

// mDNS/DNS-SD service type the desktop app advertises itself under (via
// bonjour-service) so the Android app never needs a manually-typed IP. The
// Android client resolves this via NsdManager to get the desktop's current
// address, plus two TXT records:
//   webPort — where to load the HTML/JS from. Always SERVER_PORT in a
//     packaged build, but in `electron-vite dev` it's the Vite dev server's
//     port instead, so the phone gets the same hot-reload the desktop window
//     gets. The WebSocket itself is unaffected — that's always SERVER_PORT.
//   dev — '1' if webPort points at the Vite dev server, '0' otherwise.
export const MDNS_SERVICE_TYPE = 'boarderoni'

// WebSocket close code the server uses when a connection's `?deck=` id is
// missing/invalid, or the deck it named has since been deleted. In the
// 4000-4999 private-use range (RFC 6455) so it can't collide with a
// protocol-level code. The client (store.ts) treats this as "give up and
// fall back to the deck picker" rather than its normal auto-reconnect.
export const DECK_CLOSE_CODE_UNKNOWN = 4004

// WebSocket close code the server uses when a desktop operator explicitly
// denies a pending device (see device:deny in main/index.ts). The client
// treats this like DECK_CLOSE_CODE_UNKNOWN in that it stops auto-reconnecting
// — retrying would just get denied again — but shows a distinct "denied"
// screen instead of falling back to the deck picker.
export const DECK_CLOSE_CODE_DENIED = 4005

// Default inner padding (px) for a button widget when it hasn't set its own.
export const DEFAULT_WIDGET_PADDING = 8

// Default label font size (px) for a button widget when it hasn't set its own.
export const DEFAULT_WIDGET_FONT_SIZE = 14

// How much to lighten a widget's default color for its auto-derived
// "clicked" look, when per-state configuration is turned off.
export const AUTO_CLICKED_LIGHTEN = 0.18

// Fallback for Dashboard.gridSize/SubDeck.gridSize when unset — a screen
// saved before per-screen grid size existed, or a freshly-created sub-deck,
// which doesn't copy its parent's value on purpose (see SubDeck.gridSize's
// own comment in shared/types.ts). Matches the single global value every
// screen used to share.
export const DEFAULT_GRID_SIZE = 8

// Fallback for Dashboard.canvasWidth/Height and SubDeck.canvasWidth/Height
// when unset — a screen saved before per-screen canvas size existed. Matches
// DEVICE_PRESETS[0] (renderer/src/devicePresets.ts), the editor's own
// default preview size, so an old dashboard's client letterboxing
// (see ClientCanvas.tsx) starts from the same reference size the editor was
// already showing it at, rather than some unrelated guess.
export const DEFAULT_CANVAS_WIDTH = 1920
export const DEFAULT_CANVAS_HEIGHT = 1080

// Shorthand recognized in SendDcsCommandAction's plain (non-expression)
// Value field — typing exactly this instead of opening ƒx and writing out
// `return variables.$value;` by hand does the same thing. See
// runSendDcsCommand in main/index.ts and SendDcsCommandActionEditor's
// handleTest in PropertiesPanel.tsx, which both special-case it.
export const DCS_COMMAND_VALUE_SHORTHAND = '$value'
