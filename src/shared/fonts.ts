export interface FontOption {
	id: string;
	label: string;
	cssFamily: string;
	monospace?: boolean;
}

// Self-hosted (via @fontsource) rather than linked to Google's CDN, so the
// exact same glyphs render on the desktop editor and the Android WebView
// with no dependence on internet access or OS font fallback.
export const FONT_OPTIONS: FontOption[] = [
	{ id: "inter", label: "Inter", cssFamily: "Inter" },
	{ id: "roboto", label: "Roboto", cssFamily: "Roboto" },
	{ id: "poppins", label: "Poppins", cssFamily: "Poppins" },
	{ id: "jetbrainsMono", label: "JetBrains Mono", cssFamily: '"JetBrains Mono"', monospace: true },
	{ id: "robotoMono", label: "Roboto Mono", cssFamily: '"Roboto Mono"', monospace: true },
	{
		id: "hornetDisplayRegular",
		label: "Hornet Display Regular",
		cssFamily: '"HornetDisplay-Regular"',
		monospace: true,
	},
	{ id: "hornetDisplayBold", label: "Hornet Display Bold", cssFamily: '"HornetDisplay-Bold"', monospace: true },
];

export const DEFAULT_FONT_ID = "inter";

export function resolveFont(id: string | undefined): FontOption {
	return FONT_OPTIONS.find((f) => f.id === id) ?? FONT_OPTIONS.find((f) => f.id === DEFAULT_FONT_ID)!;
}
