export interface DevicePreset {
	id: string;
	label: string;
	width: number;
	height: number;
}

// Standalone stand-ins for a real device config UI (planned separately) —
// picking one just sets what size guide rectangle the canvas shows.
export const DEVICE_PRESETS: DevicePreset[] = [
	{ id: "preset-1920x1080", label: "Desktop 1920×1080", width: 1920, height: 1080 },
	{ id: "preset-1366x768", label: "Desktop 1366×768", width: 1366, height: 768 },
	{ id: "preset-1280x720", label: "Desktop 1280×720", width: 1280, height: 720 },
	{ id: "preset-1344x807", label: "Desktop 1344×807", width: 1344, height: 807 },
];
