// Single port serves the WebSocket (state sync + triggers) and, in a production
// build, the static renderer bundle that the Android WebView loads.
export const SERVER_PORT = 17334

// Guide rectangle shown in the editor when no device is currently connected.
export const DEFAULT_DEVICE_BOUNDS = { width: 1280, height: 800 }
