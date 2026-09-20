// App-wide custom sound library — the audio counterpart to fonts.ts, and
// deliberately modelled on it (same id/label/filename manifest shape, same
// upload-time extension whitelist, same GET /sounds/:id serving).
//
// One deliberate difference from fonts: a deck export BUNDLES the bytes of
// every sound its actions reference (see DeckExportFile.sounds), the way the
// background image already does. Fonts don't, which is why there's a standing
// TODO about warning when an imported deck names a font this install doesn't
// have — bundling sidesteps that failure mode entirely rather than detecting
// it after the fact.

export interface CustomSound {
	id: string;
	label: string;
	filename: string;
	// Where playback starts within this file, in milliseconds. Lives on the
	// SOUND rather than on each PlaySoundAction because it describes the file
	// itself — a lot of sound effects have a moment of dead air at the front,
	// and that's equally true every time the file is played, from wherever.
	// Setting it once on upload means every action using the sound inherits a
	// correctly-trimmed start instead of each one re-deriving the same number.
	// Unset/0 plays from the beginning.
	startAtMs?: number;
}

export const SOUND_MIME_BY_EXTENSION: Record<string, string> = {
	mp3: 'audio/mpeg',
	wav: 'audio/wav',
	ogg: 'audio/ogg',
	m4a: 'audio/mp4',
	aac: 'audio/aac',
	flac: 'audio/flac',
	webm: 'audio/webm'
};

// Also main/customSounds.ts's upload-time whitelist — same "known kinds
// only" reasoning as ALLOWED_FONT_EXTENSIONS (the file input's own `accept`
// only stops an accidental pick; this is the actual gate).
export const ALLOWED_SOUND_EXTENSIONS = Object.keys(SOUND_MIME_BY_EXTENSION);

export function soundExtension(filename: string): string {
	return filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
}

// Clamps a stored 0-100 volume to the 0-1 gain an HTMLAudioElement's own
// `.volume` expects. Tolerates a missing/garbage value rather than muting or
// throwing — an action saved before this field existed, or hand-edited in a
// deck's JSON, should still play at full volume rather than silently doing
// nothing audible.
export function soundVolumeToGain(volume: number | undefined): number {
	if (typeof volume !== 'number' || Number.isNaN(volume)) return 1;
	return Math.min(1, Math.max(0, volume / 100));
}
