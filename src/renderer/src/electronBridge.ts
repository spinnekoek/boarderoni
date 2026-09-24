// Thin wrapper around the contextBridge API preload/index.ts exposes — see
// its comment for why this exists instead of just being on the WS protocol
// like everything else the renderer talks to the app about.
interface ElectronBridge {
  openExternal: (url: string) => void
  editorToken: string | null
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

// Only ever set inside the editor's own Electron window — a browser tab or
// the Android WebView has no preload, so this is undefined there. Doubles
// as the "am I the editor?" signal (see App.tsx's readMode) and the
// credential the server requires for edit rights (the WS hello's
// editorToken, and editorHeaders below for /api/decks*).
export function getEditorToken(): string | undefined {
  return window.electronAPI?.editorToken ?? undefined
}

// Must match EDITOR_TOKEN_HEADER in main/index.ts.
export function editorHeaders(extra?: Record<string, string>): Record<string, string> {
  return { ...extra, 'X-Boarderoni-Editor-Token': getEditorToken() ?? '' }
}
