// Presence of window.BoarderoniAndroid IS the "am I running inside the
// Boarderoni Android app" signal — it's a JS interface the app's WebView
// registers on itself (see MainActivity.kt's WebAppBridge/
// addJavascriptInterface), so it can't exist in a regular mobile browser or
// any other WebView. More reliable than user-agent sniffing, which a generic
// WebView-based app could share anyway.
interface BoarderoniAndroidBridge {
  setKeepScreenOn: (enabled: boolean) => void
  changeServer: () => void
}

declare global {
  interface Window {
    BoarderoniAndroid?: BoarderoniAndroidBridge
  }
}

export function isBoarderoniAndroidApp(): boolean {
  return typeof window !== 'undefined' && window.BoarderoniAndroid !== undefined
}

export function setKeepScreenOn(enabled: boolean): void {
  window.BoarderoniAndroid?.setKeepScreenOn(enabled)
}

// Drops the native app back to its searching/manual-entry screen — the
// escape hatch for a wrong manual IP/port, or just wanting a different
// desktop, now reachable from the 5-finger modal instead of an always-on
// floating button.
export function changeServer(): void {
  window.BoarderoniAndroid?.changeServer()
}
