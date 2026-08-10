// Thin wrapper around the contextBridge API preload/index.ts exposes — see
// its comment for why this exists instead of just being on the WS protocol
// like everything else the renderer talks to the app about.
interface ElectronBridge {
  openExternal: (url: string) => void
}

declare global {
  interface Window {
    electronAPI?: ElectronBridge
  }
}

// Also undefined inside the Android WebView (no preload script there) —
// callers already only reach this from edit mode, which is Electron-only,
// but the optional chaining is cheap insurance either way.
export function openExternal(url: string): void {
  window.electronAPI?.openExternal(url)
}
