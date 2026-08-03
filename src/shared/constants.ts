// Single port serves the WebSocket (state sync + triggers) and, in a production
// build, the static renderer bundle that the Android WebView loads.
export const SERVER_PORT = 17334

// Default inner padding (px) for a button widget when it hasn't set its own.
export const DEFAULT_WIDGET_PADDING = 8

// Default label font size (px) for a button widget when it hasn't set its own.
export const DEFAULT_WIDGET_FONT_SIZE = 14

// How much to lighten a widget's default color for its auto-derived
// "clicked" look, when per-state configuration is turned off.
export const AUTO_CLICKED_LIGHTEN = 0.18
