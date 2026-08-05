// Single port serves the WebSocket (state sync + triggers) and, in a production
// build, the static renderer bundle that the Android WebView loads.
export const SERVER_PORT = 17334

// WebSocket close code the server uses when a connection's `?deck=` id is
// missing/invalid, or the deck it named has since been deleted. In the
// 4000-4999 private-use range (RFC 6455) so it can't collide with a
// protocol-level code. The client (store.ts) treats this as "give up and
// fall back to the deck picker" rather than its normal auto-reconnect.
export const DECK_CLOSE_CODE_UNKNOWN = 4004

// Default inner padding (px) for a button widget when it hasn't set its own.
export const DEFAULT_WIDGET_PADDING = 8

// Default label font size (px) for a button widget when it hasn't set its own.
export const DEFAULT_WIDGET_FONT_SIZE = 14

// How much to lighten a widget's default color for its auto-derived
// "clicked" look, when per-state configuration is turned off.
export const AUTO_CLICKED_LIGHTEN = 0.18
