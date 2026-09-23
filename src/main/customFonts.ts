// App-wide custom font library — uploaded once (Settings' "Custom fonts"
// panel), available to every deck's labels afterward, same "not scoped to
// one deck" reasoning as appSettings.ts. Each font's bytes live at
// fontFile(id) (see main/index.ts's GET /fonts/:id route); this module only
// owns the manifest (id/label/filename) and the upload/delete file-handling
// that keeps it in sync with what's actually on disk.
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { ALLOWED_FONT_EXTENSIONS, fontExtension, type CustomFont } from '../shared/fonts'

function fontsDir(): string {
  return join(app.getPath('userData'), 'fonts')
}

function manifestFile(): string {
  return join(fontsDir(), 'manifest.json')
}

// Also the GET /fonts/:id route's own lookup — no extension on disk (same
// convention as deckBackgroundImageFile), since the manifest's `filename`
// already carries it for the Content-Type/format() lookups in
// shared/fonts.ts.
export function customFontFile(id: string): string {
  return join(fontsDir(), id)
}

let cached: CustomFont[] | null = null

export function getCustomFonts(): CustomFont[] {
  if (cached) return cached
  try {
    cached = JSON.parse(readFileSync(manifestFile(), 'utf-8')) as CustomFont[]
  } catch {
    cached = []
  }
  return cached
}

function saveManifest(fonts: CustomFont[]): void {
  cached = fonts
  mkdirSync(fontsDir(), { recursive: true })
  writeFileSync(manifestFile(), JSON.stringify(fonts, null, 2), 'utf-8')
}

// Shared by both entry points below. Returns null for a malformed data URL
// or a filename extension outside ALLOWED_FONT_EXTENSIONS — callers treat
// either the same way (silently drop), same as background-image:upload's own
// malformed-data-URL handling.
function writeFont(id: string, dataUrl: string, label: string, filename: string): CustomFont | null {
  const match = /^data:([\w/+.-]*);base64,(.+)$/.exec(dataUrl)
  if (!match) return null
  if (!ALLOWED_FONT_EXTENSIONS.includes(fontExtension(filename))) return null
  const [, , base64] = match
  const font: CustomFont = { id, label: label.trim() || filename, filename }
  mkdirSync(fontsDir(), { recursive: true })
  writeFileSync(customFontFile(font.id), Buffer.from(base64, 'base64'))
  saveManifest([...getCustomFonts().filter((f) => f.id !== id), font])
  return font
}

export function addCustomFont(dataUrl: string, label: string, filename: string): CustomFont | null {
  return writeFont(randomUUID(), dataUrl, label, filename)
}

// Deck import's own entry point — mirrors addCustomSoundWithId in
// customSounds.ts (see that file's own comment on why this exists and sounds
// share the same shape): keeps the id the export carried so the imported
// deck's labels, which reference a font BY id via WidgetLabel.fontFamily,
// still resolve, and so re-importing (or importing two decks sharing a font)
// doesn't accumulate duplicate copies. An id already present is left
// completely alone — whatever is on disk here is assumed to be the same
// font, and overwriting it would silently change every other deck already
// using it.
export function addCustomFontWithId(id: string, dataUrl: string, label: string, filename: string): CustomFont | null {
  const existing = getCustomFonts().find((f) => f.id === id)
  if (existing) return existing
  return writeFont(id, dataUrl, label, filename)
}

export function deleteCustomFont(id: string): void {
  const file = customFontFile(id)
  if (existsSync(file)) unlinkSync(file)
  saveManifest(getCustomFonts().filter((f) => f.id !== id))
}

// null clears the override back to labels.tsx's own DEFAULT_LABEL_LINE_HEIGHT
// — see CustomFont.lineHeight's own comment. A fontId that no longer exists
// (deleted out from under a stale request) is a silent no-op, same as
// deleteCustomFont above never erroring on a missing file.
export function updateCustomFontLineHeight(id: string, lineHeight: number | null): void {
  saveManifest(
    getCustomFonts().map((f) => {
      if (f.id !== id) return f
      if (lineHeight === null) {
        const { lineHeight: _lineHeight, ...rest } = f
        return rest
      }
      return { ...f, lineHeight }
    })
  )
}
