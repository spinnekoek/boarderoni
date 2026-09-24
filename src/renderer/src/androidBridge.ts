// Presence of window.BoarderoniAndroid IS the "am I running inside the
// Boarderoni Android app" signal — it's a JS interface the app's WebView
// registers on itself (see MainActivity.kt's WebAppBridge/
// addJavascriptInterface), so it can't exist in a regular mobile browser or
// any other WebView. More reliable than user-agent sniffing, which a generic
// WebView-based app could share anyway.
interface BoarderoniAndroidBridge {
  setKeepScreenOn: (enabled: boolean) => void
  changeServer: () => void
  connectionLost: () => void
  // TEMP DEBUG LOGGING — see MainActivity.kt's dlog()/setDebugLogging. Remove
  // this and setDebugLogging below once the spinner/reconnect bug is
  // diagnosed.
  setDebugLogging: (enabled: boolean) => void
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

// Drops back to the native searching/found-connect screen the same way
// changeServer() does, but WITHOUT forgetting the remembered server — the
// idea is "give up on this frozen session and let the user see what's
// happening," not "I want a different desktop." Called from ClientCanvas.tsx
// after the WebSocket has stayed disconnected for a while (see its own
// comment on the exact grace period) — a brief drop is expected to just
// reconnect on its own via store.ts's normal retry loop; this is only for
// when that's clearly not working. Optional-called (not just
// optional-accessed) so an older APK build that predates this bridge method
// degrades to a silent no-op instead of throwing.
export function connectionLost(): void {
  window.BoarderoniAndroid?.connectionLost?.()
}

// TEMP DEBUG LOGGING — see the interface comment above. Optional-called
// (not just optional-accessed) so a WebView still running an older APK
// build that predates this bridge method degrades to a silent no-op
// instead of throwing "setDebugLogging is not a function".
export function setDebugLogging(enabled: boolean): void {
  window.BoarderoniAndroid?.setDebugLogging?.(enabled)
}
