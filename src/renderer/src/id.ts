export function nextId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

const DEVICE_ID_KEY = 'boarderoni-device-id'

// A stable identity for this browser/WebView, persisted in localStorage so a
// view client reports the same id across reconnects and app relaunches
// instead of minting a new one (and thus a new device entry) every time.
export function getDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_KEY)
  if (existing) return existing
  const id = nextId()
  localStorage.setItem(DEVICE_ID_KEY, id)
  return id
}
