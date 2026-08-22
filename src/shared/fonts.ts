export interface FontOption {
	id: string;
	label: string;
	cssFamily: string;
	monospace?: boolean;
	// Unset uses the shared default every built-in font already looks right
	// with (see labels.tsx's own DEFAULT_LABEL_LINE_HEIGHT) — only a custom
	// font (see CustomFont.lineHeight below) actually sets this, when its own
	// internal metrics make that default too tight/loose for it specifically.
	lineHeight?: number;
}

// A user-uploaded font (see Settings' "Custom fonts" panel and
// main/customFonts.ts) — app-wide, not per-deck, same as the built-in
// FONT_OPTIONS below. `id` is server-generated (randomUUID) and doubles as
// the path segment the file is served from (GET /fonts/<id>); `filename` is
// only kept for display in the settings list. Deliberately NOT a FontOption
// itself — resolveFont derives one from just the `id` (see
// customFontCssFamily below) so rendering a label never needs the full
// CustomFont list in scope, only whichever id it was saved with.
export interface CustomFont {
	id: string;
	label: string;
	filename: string;
	// Overrides DEFAULT_LABEL_LINE_HEIGHT (labels.tsx) for labels using this
	// font specifically — some fonts' own internal ascent/descent/line-gap
	// metrics make that shared default render lines overlapping (too tight)
	// or too loosely spaced, and unlike font-size/color there's no per-label
	// field that could work around it, since the mismatch comes from the
	// font file itself, not anything about a given label. Unset uses the
	// shared default, same as every built-in font.
	lineHeight?: number;
}

// Namespaces a CustomFont's id inside WidgetLabel.fontFamily so resolveFont
// can tell a custom font's id apart from a built-in FontOption's id (e.g. a
// custom font named the same as a future built-in addition) without needing
// to search the custom font list at all — the prefix alone is enough to know
// which branch to take below.
const CUSTOM_FONT_PREFIX = "custom:";

export function isCustomFontId(id: string | undefined): boolean {
	return id !== undefined && id.startsWith(CUSTOM_FONT_PREFIX);
}

export function customFontFieldValue(customFontId: string): string {
	return `${CUSTOM_FONT_PREFIX}${customFontId}`;
}

// The raw CustomFont.id (no prefix) — also the /fonts/<id> URL segment, see
// customFontFaces.ts's own useCustomFontFaces.
export function customFontIdFromFieldValue(fieldValue: string): string {
	return fieldValue.slice(CUSTOM_FONT_PREFIX.length);
}

// A quoted CSS font-family value unique to this one custom font — the actual
// @font-face binding this name to the uploaded file's bytes happens at
// runtime (see useCustomFontFaces.ts), once the font list is known; this
// function only needs to be deterministic from the id; it doesn't touch that
// list.
function customFontCssFamily(fieldValue: string): string {
	return `"${fieldValue}"`;
}

export function customFontToOption(font: CustomFont): FontOption {
	const fieldValue = customFontFieldValue(font.id);
	return { id: fieldValue, label: font.label, cssFamily: customFontCssFamily(fieldValue), lineHeight: font.lineHeight };
}

// Module-level, not React state — resolveFont (below) is a plain function
// called from labels.tsx's render path all over the widget tree, on both the
// editor and the Android view client, with no store/props access of its own
// (see resolveFont's own comment). Kept in sync by registerCustomFonts,
// called from store.ts's fonts:list handler — the same "side effect outside
// the render tree, driven by that one message" shape
// useCustomFontFaces/syncCustomFontFaces already uses for the actual
// @font-face rules these ids resolve to.
const customFontLineHeights = new Map<string, number>();

export function registerCustomFonts(fonts: CustomFont[]): void {
	customFontLineHeights.clear();
	for (const font of fonts) {
		if (font.lineHeight !== undefined) customFontLineHeights.set(font.id, font.lineHeight);
	}
}

// Keyed by extension (lowercase, no dot) rather than trusting whatever MIME
// type the browser's <input type="file"> reported for the picked file —
// that's inconsistent/often empty for font files across browsers/OSes, while
// the extension the user themselves chose when naming the file is reliable.
// Shared by main/customFonts.ts (HTTP Content-Type when serving GET
// /fonts/<id>) and useCustomFontFaces.ts (the @font-face `format()` hint) so
// the two can never disagree about what a given upload actually is.
export const FONT_MIME_BY_EXTENSION: Record<string, string> = {
	ttf: 'font/ttf',
	otf: 'font/otf',
	woff: 'font/woff',
	woff2: 'font/woff2'
};

const FONT_FORMAT_BY_EXTENSION: Record<string, string> = {
	ttf: 'truetype',
	otf: 'opentype',
	woff: 'woff',
	woff2: 'woff2'
};

// Also main/customFonts.ts's upload-time whitelist — anything else is
// rejected before it ever reaches disk, same "known kinds only" reasoning as
// the accept attribute on the file input itself (which only keeps a user
// from accidentally picking the wrong file; this is the actual gate).
export const ALLOWED_FONT_EXTENSIONS = Object.keys(FONT_MIME_BY_EXTENSION);

export function fontExtension(filename: string): string {
	return filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
}

export function fontFormatHint(filename: string): string | undefined {
	return FONT_FORMAT_BY_EXTENSION[fontExtension(filename)];
}

// Self-hosted (via @fontsource) rather than linked to Google's CDN, so the
// exact same glyphs render on the desktop editor and the Android WebView
// with no dependence on internet access or OS font fallback.
export const FONT_OPTIONS: FontOption[] = [
	{ id: "aldrich", label: "Aldrich", cssFamily: "Aldrich" },
	{ id: "audiowide", label: "Audiowide", cssFamily: "Audiowide" },
	{ id: "hornetDisplayBold", label: "Hornet Display Bold", cssFamily: '"HornetDisplay-Bold"', monospace: true },
	{
		id: "hornetDisplayRegular",
		label: "Hornet Display Regular",
		cssFamily: '"HornetDisplay-Regular"',
		monospace: true,
	},
	{ id: "inter", label: "Inter", cssFamily: "Inter" },
	{ id: "jetbrainsMono", label: "JetBrains Mono", cssFamily: '"JetBrains Mono"', monospace: true },
	// Free/OFL-licensed stand-ins for the (proprietary, unlicensed-for-bundling)
	// Eurostile/Microgramma/Handel Gothic cockpit-instrument look — see the
	// font-licensing discussion this was added from.
	{ id: "librestile", label: "Librestile", cssFamily: "Librestile" },
	{ id: "michroma", label: "Michroma", cssFamily: "Michroma" },
	{ id: "orbitron", label: "Orbitron", cssFamily: "Orbitron" },
	{ id: "poppins", label: "Poppins", cssFamily: "Poppins" },
	{ id: "roboto", label: "Roboto", cssFamily: "Roboto" },
	{ id: "robotoMono", label: "Roboto Mono", cssFamily: '"Roboto Mono"', monospace: true },
];

export const DEFAULT_FONT_ID = "inter";

// Matches .deck-button__label's own line-height in styles.css — kept here
// too (not just relying on that CSS rule) so a custom font's own override
// (see CustomFont.lineHeight/FontOption.lineHeight above) always has a real
// number to fall back to/reset to, the same default every built-in font
// already renders fine with. Used by labels.tsx's own render path and by
// SettingsModal's Custom fonts line-height input (its placeholder/blank
// value).
export const DEFAULT_LABEL_LINE_HEIGHT = 0.9;

// A custom font's id is self-describing (see customFontCssFamily above) —
// resolving one never needs the actual CustomFont list, so this stays a pure
// function of `id` alone, safe to call from labels.tsx's render path on
// both the editor and the Android view client without either needing the
// list in scope.
export function resolveFont(id: string | undefined): FontOption {
	if (isCustomFontId(id)) {
		return {
			id: id!,
			label: id!,
			cssFamily: customFontCssFamily(id!),
			lineHeight: customFontLineHeights.get(customFontIdFromFieldValue(id!))
		};
	}
	return FONT_OPTIONS.find((f) => f.id === id) ?? FONT_OPTIONS.find((f) => f.id === DEFAULT_FONT_ID)!;
}
