// Which device ids are allowed to receive dashboard content (and, as of the
// lobby connection, even the deck list itself) — see
// device:approval-requested/device:approve/device:deny in main/index.ts, and
// device:list-approved/device:revoke for the settings modal's management UI.
// Global, not per-deck: a device trusted once shouldn't have to be
// re-approved just for switching which deck it's viewing. Same cached-JSON-
// file shape as appSettings.ts.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { app } from 'electron'
import type { ApprovedDeviceSummary } from '../shared/types'

// The persisted-on-disk shape of one record — a superset of
// ApprovedDeviceSummary (the settings modal's own view of the list) that
// additionally carries the device's own credential. `tokenHash` never
// leaves this module: listApprovedDevices() below strips it before handing
// records to the renderer, same as a password hash never round-tripping to
// a client. Approval alone (a bare deviceId, self-reported by the client —
// see id.ts's getDeviceId) used to be the whole trust check; that let any
// socket that had merely SEEN an approved device's id (e.g. from a
// devices:sync broadcast, visible to any already-trusted socket) impersonate
// it. A per-device bearer token, minted server-side and never derivable from
// the id, is what actually makes "approved" a credential rather than a
// self-asserted claim.
interface StoredDevice extends ApprovedDeviceSummary {
  tokenHash: string
}

function approvedDevicesFilePath(): string {
  return join(app.getPath('userData'), 'approved-devices.json')
}

let cached: Map<string, StoredDevice> | null = null

function load(): Map<string, StoredDevice> {
  if (cached) return cached
  try {
    const raw = readFileSync(approvedDevicesFilePath(), 'utf-8')
    const records = JSON.parse(raw) as StoredDevice[]
    cached = new Map(records.map((r) => [r.id, r]))
  } catch {
    cached = new Map()
  }
  return cached
}

function persist(records: Map<string, StoredDevice>): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(approvedDevicesFilePath(), JSON.stringify(Array.from(records.values()), null, 2), 'utf-8')
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// Still used for the pre-token-gate checks that only need "is this id known
// at all" (none remain after this change — kept for any future non-identity
// use, e.g. the settings modal listing). Actual access decisions go through
// verifyDeviceToken below instead.
export function isDeviceApproved(deviceId: string): boolean {
  return load().has(deviceId)
}

// Constant-time by construction: timingSafeEqual throws on a length
// mismatch rather than short-circuiting, which would itself leak the
// correct length — hashToken's fixed-width hex digest sidesteps that
// entirely, so a mismatched raw token length never reaches the compare.
export function verifyDeviceToken(deviceId: string | undefined, token: string | undefined): boolean {
  if (!deviceId || !token) return false
  const record = load().get(deviceId)
  // A record approved before tokenHash existed (every entry in
  // approved-devices.json predating this feature) has no hash to compare
  // against — treated as unverified, same as a wrong token, rather than
  // trusted-by-absence or a thrown error. Deliberate: this is what forces
  // every pre-existing approval to go through device:pending again once,
  // the correct posture for a credential that previously didn't exist at
  // all (there is no old token to grandfather in), not a bug to work around.
  if (!record || typeof record.tokenHash !== 'string') return false
  const expected = Buffer.from(record.tokenHash, 'hex')
  const actual = Buffer.from(hashToken(token), 'hex')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

// name is a fresh snapshot on every (re-)approval, not just the first —
// re-approving an already-approved device (e.g. it showed up pending again
// after a revoke) refreshes the label the settings modal shows for it. Also
// mints a FRESH token on every call, including a re-approval of an already-
// approved device — there's no "keep the old token" path, so a device that
// still holds a stale one (e.g. after an operator revoked-then-re-approved
// it rather than just leaving the original approval alone) has to go
// through hello/device:pending again to pick up the new one, same as a
// never-approved device would. Returns the plaintext token — the ONLY time
// it ever exists outside this module — for the caller (main/index.ts's
// device:approve handler) to push down the requesting socket; only the
// hash is ever persisted.
export function approveDevice(deviceId: string, name: string): string {
  const token = randomBytes(32).toString('base64url')
  const records = load()
  records.set(deviceId, { id: deviceId, name, approvedAt: Date.now(), tokenHash: hashToken(token) })
  persist(records)
  return token
}

export function revokeDevice(deviceId: string): void {
  const records = load()
  if (!records.delete(deviceId)) return
  persist(records)
}

// Keeps the settings modal's list in sync with a device:rename — otherwise
// the name shown there is frozen at whatever it was the moment approval
// happened, which reads as broken once someone actually renames it. No-op
// (not an upsert) for a device that isn't currently approved: there's no
// approvedAt to attach a name to yet, and it'll get a fresh snapshot from
// approveDevice whenever it actually is approved.
export function renameApprovedDevice(deviceId: string, name: string): void {
  const records = load()
  const existing = records.get(deviceId)
  if (!existing || existing.name === name) return
  records.set(deviceId, { ...existing, name })
  persist(records)
}

// Strips tokenHash explicitly — StoredDevice structurally satisfies
// ApprovedDeviceSummary, so TypeScript won't catch a plain `return
// Array.from(...)` leaking the hash to whatever calls this (the
// device:approved-list WS reply, ultimately the settings modal). A stolen
// hash isn't the same risk as a stolen token (verifyDeviceToken still needs
// the raw value, which the hash doesn't reveal), but there's no reason for
// it to leave this module at all.
export function listApprovedDevices(): ApprovedDeviceSummary[] {
  return Array.from(load().values())
    .map(({ tokenHash: _tokenHash, ...summary }) => summary)
    .sort((a, b) => b.approvedAt - a.approvedAt)
}
