import type { PluginTypeMeta } from './types'

// Formerly two separate things — an 'ocrRegion' plugin (OCR text/
// number out of a screen region) and the Screen Capture widget's own live
// image, un-gated by anything. Both ride the exact same OS-level screen-grab
// (see main/screenCapture.ts's captureRegionJpeg), so they're one plugin now
// — disabling it stops the OCR producer's polling AND renders every
// 'screen-capture' widget inert (see widgetTypes below and
// isWidgetTypeGatedByDisabledPlugin in shared/plugins/index.ts), instead of
// two different toggles for one underlying capability.
//
// Fields are static (unlike 'dcsbios') — the main-process producer (see
// main/plugins/screenCapture.ts) always emits exactly these two keys,
// 'value' only when the recognized text actually contains a number.
// config.{region,displayId,intervalMs} are set via the region-picker overlay
// + interval slider in renderer/src/plugins/ScreenCaptureConfigPanel.tsx.
//
// label vs instanceLabel: the PLUGIN is "Screen Capture + OCR" (it gates
// both the screen-capture widget and this event source), but the event
// source you actually add only ever produces OCR'd text/numbers — the
// bigger "stream a live region onto the dashboard" behavior is entirely
// the screen-capture WIDGET's own domain, configured directly on the
// widget in Properties, not through this event source at all. So
// EventSourcesModal's picker/kind-badge just says "OCR."
export const screenCapturePlugin: PluginTypeMeta = {
  kind: 'screenCapture',
  label: 'Screen Capture + OCR',
  instanceLabel: 'OCR',
  fields: [
    { key: 'text', label: 'Recognized text (OCR)' },
    { key: 'value', label: 'Recognized number (OCR)' }
  ],
  config: [
    { key: 'displayId', label: 'Display id', type: 'number', description: 'From list_displays.' },
    {
      key: 'region',
      label: 'Capture region',
      type: 'object',
      description:
        '{x, y, width, height} in virtual-desktop pixels — pass a display\'s own `bounds` from list_displays as-is to OCR the whole monitor. A sub-region needs the app\'s own region-picker overlay to choose precisely.'
    },
    { key: 'intervalMs', label: 'OCR poll interval (ms)', type: 'number', description: 'Clamped to 200-5000; defaults to 1000 if unset.' }
  ],
  widgetTypes: ['screen-capture']
}
