// Which device ids are allowed to receive dashboard content (and, as of the
// lobby connection, even the deck list itself) — see
// device:approval-requested/device:approve/device:deny in main/index.ts, and
// device:list-approved/device:revoke for the settings modal's management UI.
// Global, not per-deck: a device trusted once shouldn't have to be
// re-approved just for switching which deck it's viewing. Same cached-JSON-
// file shape as appSettings.ts.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { ApprovedDeviceSummary } from '../shared/types'

function approvedDevicesFilePath(): string {
  return join(app.getPath('userData'), 'approved-devices.json')
}

let cached: Map<string, ApprovedDeviceSummary> | null = null

function load(): Map<string, ApprovedDeviceSummary> {
  if (cached) return cached
  try {
    const raw = readFileSync(approvedDevicesFilePath(), 'utf-8')
    const records = JSON.parse(raw) as ApprovedDeviceSummary[]
    cached = new Map(records.map((r) => [r.id, r]))
  } catch {
    cached = new Map()
  }
  return cached
}

function persist(records: Map<string, ApprovedDeviceSummary>): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(approvedDevicesFilePath(), JSON.stringify(Array.from(records.values()), null, 2), 'utf-8')
}

export function isDeviceApproved(deviceId: string): boolean {
  return load().has(deviceId)
}

// name is a fresh snapshot on every (re-)approval, not just the first —
// re-approving an already-approved device (e.g. it showed up pending again
// after a revoke) refreshes the label the settings modal shows for it.
export function approveDevice(deviceId: string, name: string): void {
  const records = load()
  records.set(deviceId, { id: deviceId, name, approvedAt: Date.now() })
  persist(records)
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

export function listApprovedDevices(): ApprovedDeviceSummary[] {
  return Array.from(load().values()).sort((a, b) => b.approvedAt - a.approvedAt)
}
