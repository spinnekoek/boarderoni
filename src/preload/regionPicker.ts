// Preload for the screen-region picker overlay window only (see
// main/screenCapture.ts's openRegionPicker) — a separate, tiny
// contextBridge surface because that window is an ephemeral, native,
// non-deck-aware dialog (same conceptual category as a plain
// dialog.showOpenDialog), not part of the main app's own bridge.
import { contextBridge, ipcRenderer } from 'electron'

export interface PickedRect {
  x: number
  y: number
  width: number
  height: number
}

contextBridge.exposeInMainWorld('regionPicker', {
  // rect is in this window's own CSS-pixel (DIP) coordinate space, i.e.
  // local to the display — main process adds the display's own origin and
  // converts to physical pixels (see screenCapture.ts). null means
  // cancelled (Escape).
  submit: (rect: PickedRect | null): void => ipcRenderer.send('region-picker:submit', rect)
})
