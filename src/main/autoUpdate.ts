import { autoUpdater } from 'electron-updater'
import { dialog } from 'electron'

// Reads the GitHub `publish` block already in electron-builder.yml (baked
// into app-update.yml at build time) — no separate feed config needed here.
// Only meaningful in a packaged build: a dev/unpackaged run has no
// app-update.yml, and electron-updater no-ops (with a log warning) rather
// than throwing.
autoUpdater.logger = console

let checkedThisSession = false

// Called once from app.whenReady, then again on demand from the tray's
// "Check for updates" item — the flag just avoids two toast dialogs
// stacking if both happen to land close together.
export function checkForUpdates(manual: boolean): void {
  if (!manual && checkedThisSession) return
  checkedThisSession = true

  autoUpdater.checkForUpdates().catch((err: unknown) => {
    console.error('[boarderoni] update check failed', err)
    if (manual) {
      dialog.showMessageBox({
        type: 'error',
        title: 'Update check failed',
        message: 'Could not check for updates.',
        detail: err instanceof Error ? err.message : String(err)
      })
    }
  })

  if (manual) {
    autoUpdater.once('update-not-available', () => {
      dialog.showMessageBox({ type: 'info', title: 'Up to date', message: 'Boarderoni is up to date.' })
    })
  }
}

autoUpdater.on('update-downloaded', (info) => {
  dialog
    .showMessageBox({
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      title: 'Update ready',
      message: `Boarderoni ${info.version} has been downloaded.`,
      detail: 'Restart now to install it, or it will install automatically the next time you quit.'
    })
    .then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall()
    })
})

autoUpdater.on('error', (err) => {
  console.error('[boarderoni] auto-updater error', err)
})
