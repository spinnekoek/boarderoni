import { useEffect, useState } from 'react'
import { toDataURL } from 'qrcode'
import { useEscapeToClose } from '../useEscapeToClose'
import { openExternal } from '../electronBridge'
import { SERVER_PORT } from '@shared/constants'

interface ApkInfo {
  available: boolean
  url: string | null
  appUrl: string | null
}

// window.location.hostname isn't the LAN address here — the editor window
// loads from localhost (dev server) or file:// (packaged build), neither of
// which a phone could reach. The main process resolves the real LAN address
// for the QR/link itself; this just needs to reach the local server.
function apiHost(): string {
  return window.location.hostname || 'localhost'
}

// Click opens it in the system's default browser (via electronBridge —
// clicking a plain <a> here would just navigate the editor window itself
// away from the app), Copy is the other half of "copy that address, or
// click on it."
function LinkRow({ url }: { url: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  function handleCopy(): void {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="mobile-app-modal__link-row">
      <button type="button" className="mobile-app-modal__link" onClick={() => openExternal(url)}>
        {url}
      </button>
      <button type="button" className="mobile-app-modal__copy" onClick={handleCopy}>
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  )
}

// The APK download URL is a long GitHub release link with no natural break
// points — shown in a read-only textbox (scrolls inside itself) instead of
// as text, so it can't widen the modal into a horizontal scrollbar.
function UrlField({ url }: { url: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  function handleCopy(): void {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="mobile-app-modal__link-row">
      <input readOnly className="mobile-app-modal__url" value={url} onFocus={(e) => e.currentTarget.select()} />
      <button type="button" className="mobile-app-modal__copy" onClick={handleCopy}>
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  )
}

export function MobileAppModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  useEscapeToClose(onClose)
  const [info, setInfo] = useState<ApkInfo | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`http://${apiHost()}:${SERVER_PORT}/api/apk-info`)
      .then((res) => res.json())
      .then((data: ApkInfo) => setInfo(data))
      .catch(() => setError("Couldn't reach the desktop server for APK info."))
  }, [])

  useEffect(() => {
    if (!info?.url) return
    toDataURL(info.url, { width: 240, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setError('Failed to generate the QR code.'))
  }, [info])

  return (
    <div className="device-modal-overlay" onPointerDown={onClose}>
      <div className="device-modal" onPointerDown={(e) => e.stopPropagation()}>
        <div className="device-modal__header">
          <h2 className="device-modal__title">Mobile app</h2>
          <button type="button" className="modal-close" title="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="device-modal__body">
          {error && <p className="properties__hint">{error}</p>}

          {!error && !info && <p className="properties__hint">Checking for a build…</p>}

          {!error && info?.available && info.url && (
            <>
              <p className="properties__hint">
                Scan with your phone's camera to download the latest release from GitHub and install the app.
              </p>
              {qrDataUrl && (
                <div style={{ textAlign: 'center', margin: '12px 0' }}>
                  <img src={qrDataUrl} alt="QR code linking to the Boarderoni APK download" width={240} height={240} />
                </div>
              )}
              <UrlField url={info.url} />
            </>
          )}

          {!error && info?.appUrl && (
            <>
              <p className="properties__hint">Already have the app, or just want it in a regular browser?</p>
              <LinkRow url={info.appUrl} />
            </>
          )}

          <div className="variables-modal__actions">
            <button type="button" className="device-modal__save" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
