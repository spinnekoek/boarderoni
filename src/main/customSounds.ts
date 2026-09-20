// App-wide custom sound library — uploaded once (Settings' "Sounds" panel),
// available to every deck's Play Sound actions afterward. Deliberately a
// near-copy of customFonts.ts (same manifest//id-as-filename-on-disk layout,
// same upload validation), since the two have the same lifecycle; the one
// real difference is addCustomSoundWithId below, which deck import needs and
// fonts have no equivalent of.
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { ALLOWED_SOUND_EXTENSIONS, soundExtension, type CustomSound } from '../shared/sounds'

function soundsDir(): string {
  return join(app.getPath('userData'), 'sounds')
}

function manifestFile(): string {
  return join(soundsDir(), 'manifest.json')
}

// Also the GET /sounds/:id route's own lookup — no extension on disk (same
// convention as customFontFile/deckBackgroundImageFile), since the manifest's
// `filename` already carries it for the Content-Type lookup.
export function customSoundFile(id: string): string {
  return join(soundsDir(), id)
}

let cached: CustomSound[] | null = null

export function getCustomSounds(): CustomSound[] {
  if (cached) return cached
  try {
    cached = JSON.parse(readFileSync(manifestFile(), 'utf-8')) as CustomSound[]
  } catch {
    cached = []
  }
  return cached
}

function saveManifest(sounds: CustomSound[]): void {
  cached = sounds
  mkdirSync(soundsDir(), { recursive: true })
  writeFileSync(manifestFile(), JSON.stringify(sounds, null, 2), 'utf-8')
}

// Shared by both entry points below. Returns null for a malformed data URL
// or a filename extension outside ALLOWED_SOUND_EXTENSIONS — callers treat
// either the same way (silently drop), same as addCustomFont.
function writeSound(id: string, dataUrl: string, label: string, filename: string, startAtMs?: number): CustomSound | null {
  const match = /^data:([\w/+.-]*);base64,(.+)$/.exec(dataUrl)
  if (!match) return null
  if (!ALLOWED_SOUND_EXTENSIONS.includes(soundExtension(filename))) return null
  const [, , base64] = match
  const sound: CustomSound = { id, label: label.trim() || filename, filename, ...(startAtMs ? { startAtMs } : {}) }
  mkdirSync(soundsDir(), { recursive: true })
  writeFileSync(customSoundFile(sound.id), Buffer.from(base64, 'base64'))
  saveManifest([...getCustomSounds().filter((s) => s.id !== id), sound])
  return sound
}

export function addCustomSound(dataUrl: string, label: string, filename: string): CustomSound | null {
  return writeSound(randomUUID(), dataUrl, label, filename)
}

// Deck import's own entry point: keeps the id the export carried rather than
// minting a new one, so re-importing a deck (or importing two decks that
// share a sound) doesn't accumulate duplicate copies of the same audio under
// different ids — and so the imported deck's actions, which reference sounds
// BY id, still resolve. An id already present is left completely alone:
// whatever is on disk here is assumed to be the same sound, and overwriting
// it would silently change every other deck already using it.
export function addCustomSoundWithId(id: string, dataUrl: string, label: string, filename: string, startAtMs?: number): CustomSound | null {
  const existing = getCustomSounds().find((s) => s.id === id)
  if (existing) return existing
  return writeSound(id, dataUrl, label, filename, startAtMs)
}

// 0 clears the offset back to playing from the start — stored as an absent
// field rather than a literal 0 so the manifest stays clean, same shape
// updateCustomFontLineHeight uses for its own null case. A soundId that no
// longer exists is a silent no-op, matching deleteCustomSound.
export function updateCustomSoundStartAt(id: string, startAtMs: number): void {
  const clamped = Math.max(0, Math.round(startAtMs))
  saveManifest(
    getCustomSounds().map((s) => {
      if (s.id !== id) return s
      if (clamped === 0) {
        const { startAtMs: _startAtMs, ...rest } = s
        return rest
      }
      return { ...s, startAtMs: clamped }
    })
  )
}

export function deleteCustomSound(id: string): void {
  const file = customSoundFile(id)
  if (existsSync(file)) unlinkSync(file)
  saveManifest(getCustomSounds().filter((s) => s.id !== id))
}
