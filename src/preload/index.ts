// contextBridge is the correct escape hatch for the handful of things that
// genuinely need the main process (native OS integration) rather than the
// WebSocket server the renderer otherwise talks to exclusively — opening a
// URL in the system's default browser (shell.openExternal is main-process-
// only) being the first one. Keep this list short; most things still belong
// on the WS protocol, not here.
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url)
})
