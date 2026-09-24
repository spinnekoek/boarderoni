// contextBridge is the correct escape hatch for the handful of things that
// genuinely need the main process (native OS integration) rather than the
// WebSocket server the renderer otherwise talks to exclusively — opening a
// URL in the system's default browser (shell.openExternal is main-process-
// only) being the first one. Keep this list short; most things still belong
// on the WS protocol, not here.
import { contextBridge, ipcRenderer } from 'electron'

// Fetched synchronously, once, so it's present before any renderer code
// runs — its presence is what makes the renderer boot as the editor (see
// App.tsx's readMode), and it's what the server checks before granting
// edit rights (see EDITOR_TOKEN in main/index.ts). null for any window
// that isn't the editor.
const editorToken: string | null = ipcRenderer.sendSync('get-editor-token')

contextBridge.exposeInMainWorld('electronAPI', {
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  editorToken
})
