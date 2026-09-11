// App-wide, user-saved widget-variant presets (see CustomVariant's own
// comment in shared/types.ts) — same "one JSON manifest in userData"
// pattern as customFonts.ts's own manifest half, just without a matching
// per-item binary file, since a variant's whole payload is JSON-serializable
// widget config.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import type { CustomVariant, Widget } from '../shared/types'

function manifestFile(): string {
  return join(app.getPath('userData'), 'custom-variants.json')
}

let cached: CustomVariant[] | null = null

export function getCustomVariants(): CustomVariant[] {
  if (cached) return cached
  try {
    cached = JSON.parse(readFileSync(manifestFile(), 'utf-8')) as CustomVariant[]
  } catch {
    cached = []
  }
  return cached
}

function saveManifest(variants: CustomVariant[]): void {
  cached = variants
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(manifestFile(), JSON.stringify(variants, null, 2), 'utf-8')
}

export function addCustomVariant(name: string, widgets: Widget[]): CustomVariant {
  const variant: CustomVariant = { id: randomUUID(), name, widgets }
  saveManifest([...getCustomVariants(), variant])
  return variant
}

export function deleteCustomVariant(id: string): void {
  saveManifest(getCustomVariants().filter((v) => v.id !== id))
}
