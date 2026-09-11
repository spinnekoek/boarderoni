import { useEffect, useRef, useState } from 'react'
import { useDashboardStore } from '../store'
import { useEditorSettings } from '../settingsStore'
import { useConfirmStore } from '../confirmStore'
import { DEFAULT_FONT_ID } from '@shared/fonts'
import { DEFAULT_WIDGET_COLOR } from '@shared/color'
import { isWidgetTypeGatedByDisabledPlugin } from '@shared/plugins'
import { nextId } from '../id'
import { cloneWidget } from '../clipboardStore'
import type {
  AdjusterSliderWidget,
  AdjusterKnobWidget,
  ButtonWidget,
  CustomVariant,
  DcsViewportWidget,
  DialSwitchWidget,
  DropdownWidget,
  EncoderWidget,
  BarGaugeWidget,
  ArcGaugeWidget,
  LabelWidget,
  LineWidget,
  MorphButtonWidget,
  RockerSwitchWidget,
  ScreenCaptureWidget,
  ToggleSwitchWidget,
  Widget
} from '@shared/types'

// A named, fully-preset alternative to a widget type's own plain default
// below — picked from the small chevron menu next to that widget's palette
// button instead of always getting the plain default. Toggle Switch is the
// first widget type to get one; more can grow their own variants list the
// same way later (see PaletteVariantButton, the shared UI for however many
// end up needing this). customVariantId is set only for one sourced from a
// user-saved CustomVariant (see customVariantsFor below) — PaletteVariantButton
// uses its presence to decide whether a dropdown row gets a delete button;
// the built-in arrays below never set it, so theirs never do.
interface WidgetVariant<W> {
  name: string
  build: (pos: { x: number; y: number }) => W
  customVariantId?: string
}

// A hex-bolt-guarded, 3-position (BRT/OFF/DIM) "STROBE" switch — a real
// aircraft-panel look, distinct from the plain Top/Bottom default below
// (that one came from a different, simpler Empty Wempty example toggle;
// this one replaced it once the deck's toggle was redone specifically to
// give this variant something to look like).
const TOGGLE_SWITCH_VARIANTS: WidgetVariant<ToggleSwitchWidget>[] = [
  {
    name: 'Aircraft Toggle',
    build: (pos) => ({
      id: nextId(),
      type: 'switch-toggle',
      x: pos.x,
      y: pos.y,
      w: 50,
      h: 50,
      orientation: 'vertical',
      positions: [
        {
          id: nextId(),
          name: 'Top',
          labels: [
            {
              id: nextId(),
              text: 'BRT',
              fontFamily: 'roboto',
              align: 'center',
              verticalAlign: 'center',
              fontSize: 10,
              padding: 0,
              textColor: '#a5a5a5',
              textOpacity: 1,
              labelDistance: 18
            }
          ],
          onSelect: [],
          momentary: false,
          color: '#2a2e37'
        },
        {
          id: nextId(),
          name: 'Middle',
          labels: [
            {
              id: nextId(),
              text: 'O␤F␤F',
              fontFamily: 'roboto',
              align: 'center',
              verticalAlign: 'center',
              fontSize: 10,
              padding: 0,
              textColor: '#a5a5a5',
              textAlign: 'center',
              labelDistance: 12
            }
          ],
          onSelect: []
        },
        {
          id: nextId(),
          name: 'Bottom',
          labels: [
            {
              id: nextId(),
              text: 'DIM',
              align: 'center',
              verticalAlign: 'center',
              fontSize: 10,
              textColor: '#a5a5a5',
              padding: 0,
              labelAnchor: 'bottom',
              labelDistance: 17,
              fontFamily: 'roboto'
            }
          ],
          onSelect: [],
          momentary: false
        }
      ],
      labels: [{ id: nextId(), text: 'STROBE', align: 'center', verticalAlign: 'top', fontSize: 12, padding: -20, fontFamily: 'roboto', rotation: 0 }],
      track: { color: '#14161b', backgroundOpacity: 0 },
      fill: { color: '#d3cfc5' },
      events: { press: [], release: [], positionChange: [], guardToggle: [] },
      borderColor: '#e8e8ea',
      leverLength: 34,
      barWidth: 69,
      barHeight: 23,
      barBorderWidth: 3,
      barBorderRadius: 7,
      bezelRadius: 30,
      leverBorderWidth: 6,
      barBorderColor: '#5e5a52',
      leverBorderColor: '#d3cfc5',
      innerBezelRadius: 14,
      innerBezelColor: '#ba1918',
      innerBezelBorderWidth: 3,
      innerBezelBorderColor: '#d9a219',
      interactionMode: 'drag',
      bezelShape: 'hexagon',
      bezelRotation: 0,
      fireWhileDragging: true,
      activePositionExpr:
        '// positions\nconst map = {\n  2: "Top",\n  1: "Middle",\n  0: "Bottom"\n};\n\nreturn map[variables.SOME_VARIABLE || 0];'
    })
  },
  {
    // A plain 2-position toggle under a flip-up safety cover — same Empty
    // Wempty source as the other variants above, custom MS33558 label font
    // swapped to the built-in 'roboto' for the same portability reason.
    name: 'Guarded Switch',
    build: (pos) => ({
      id: nextId(),
      type: 'switch-toggle',
      x: pos.x,
      y: pos.y,
      w: 40,
      h: 80,
      orientation: 'vertical',
      positions: [
        { id: nextId(), name: 'Top', labels: [], onSelect: [], color: '#2a2e37' },
        { id: nextId(), name: 'Bottom', labels: [], onSelect: [] }
      ],
      labels: [
        { id: nextId(), text: 'ALE-39␤RESET', align: 'center', verticalAlign: 'bottom', fontSize: 5, padding: -14, fontFamily: 'roboto', rotation: 0 }
      ],
      track: { color: '#14161b', backgroundOpacity: 0 },
      fill: { color: '#d3cfc5' },
      events: { press: [], release: [], positionChange: [], guardToggle: [] },
      borderColor: '#e8e8ea',
      leverLength: 62,
      barWidth: 69,
      barHeight: 23,
      barBorderWidth: 3,
      barBorderRadius: 7,
      bezelRadius: 30,
      leverBorderWidth: 6,
      barBorderColor: '#5e5a52',
      leverBorderColor: '#d3cfc5',
      bezelRotation: 0,
      innerBezelColor: '#14161b',
      innerBezelRadius: 14,
      innerBezelBorderColor: '#2a2e37',
      innerBezelBorderWidth: 3,
      guardEnabled: true,
      guard: { borderColor: '#bb5449', backgroundOpacity: 0.94 },
      guardOpenTop: -16,
      guardOpenHeight: 21,
      rotateAngle: 0,
      fireWhileDragging: true,
      guardTop: 0
    })
  }
]

// A green-on-black digital radio-frequency readout — statesEnabled so
// Clicked can look different (see PropertiesPanel's own state tabs), but
// this variant only carries the one Default state that's actually set on
// the Empty Wempty source widget; a second, Clicked-specific look is
// whatever's added from there, same as any other statesEnabled button.
const BUTTON_VARIANTS: WidgetVariant<ButtonWidget>[] = [
  {
    name: 'Aircraft Display',
    build: (pos) => ({
      id: nextId(),
      type: 'button',
      x: pos.x,
      y: pos.y,
      w: 240,
      h: 60,
      statesEnabled: true,
      states: [
        {
          id: nextId(),
          name: 'Default',
          labels: [
            {
              id: nextId(),
              text: '124.800 MHz',
              fontFamily: 'jetbrainsMono',
              align: 'left',
              verticalAlign: 'center',
              fontSize: 31,
              padding: 13,
              textColor: '#56b728',
              textOpacity: 1
            }
          ],
          spacingTop: 0,
          radiusBottomLeft: 2,
          radiusTopLeft: 2,
          radiusTopRight: 2,
          radiusBottomRight: 2,
          borderColor: '#3e3e3e',
          borderWidthTop: 1,
          borderWidthLeft: 1,
          borderWidthRight: 1,
          borderWidthBottom: 1,
          color: '#061806',
          spacingLeft: 0,
          spacingBottom: 0,
          spacingRight: 0
        }
      ],
      labels: [{ id: nextId(), text: '' }],
      events: { press: [], release: [], doublePress: [], triplePress: [] }
    })
  },
  {
    // Round green "READY" annunciator — colorExpr/glowColorExpr drive the
    // lit/unlit look off SOME_VARIABLE, same placeholder variable name the
    // Aircraft Toggle variant's own activePositionExpr already uses (edit it
    // in the properties panel to point at a real one).
    name: 'Green Indicator Light',
    build: (pos) => ({
      id: nextId(),
      type: 'button',
      x: pos.x,
      y: pos.y,
      w: 40,
      h: 40,
      events: { press: [], release: [], doublePress: [], triplePress: [] },
      statesEnabled: true,
      states: [
        {
          id: nextId(),
          name: 'Default',
          labels: [{ id: nextId(), text: 'READY', align: 'center', verticalAlign: 'top', fontSize: 5, textColor: '#a5a5a5', padding: -7 }],
          color: '#10db10',
          radiusTopLeft: 20,
          radiusBottomLeft: 20,
          radiusBottomRight: 20,
          radiusTopRight: 20,
          colorExpr: "return !!variables.SOME_VARIABLE ? '#10db10' : '#061806';",
          glowColor: '#2a2e37',
          glowColorExpr: "return !!variables.SOME_VARIABLE ? '#10db10' : null;"
        }
      ],
      labels: [{ id: nextId(), text: '' }]
    })
  }
]

// Two square-dial knobs off the same Empty Wempty aircraft-panel example as
// the Toggle/Button variants above — a BAL balance knob (VID/SYM tick
// labels) and an AOA indexer brightness knob (OFF/BRT tick labels). The
// source widgets used a user-uploaded custom font (MS33558, a placard
// stencil face) for their labels; swapped to the built-in 'roboto' here so
// the variant renders the same on every install, same call as Toggle/Button
// above already made for their own source examples.
const ADJUSTER_KNOB_VARIANTS: WidgetVariant<AdjusterKnobWidget>[] = [
  {
    name: 'Aircraft Dial 1',
    build: (pos) => ({
      id: nextId(),
      type: 'adjuster-knob',
      x: pos.x,
      y: pos.y,
      w: 40,
      h: 40,
      orientation: 'vertical',
      min: 0,
      max: 65535,
      events: {
        press: [],
        release: [],
        move: [
          {
            kind: 'action',
            id: nextId(),
            action: { kind: 'send-dcs-command', aircraft: 'FA-18C_hornet', identifier: '', interface: 'action', argument: '' }
          },
          {
            kind: 'action',
            id: nextId(),
            action: { kind: 'send-dcs-command', aircraft: 'FA-18C_hornet', identifier: 'HUD_BALANCE', interface: 'set_state', argument: '$value' }
          }
        ],
        doublePress: [],
        triplePress: []
      },
      fill: { color: '#5b8def', backgroundOpacity: 0 },
      track: { color: '#e2547b', backgroundOpacity: 0 },
      labels: [{ id: nextId(), text: 'BAL', align: 'center', verticalAlign: 'top', fontFamily: 'roboto', fontSize: 8, padding: -10, rotation: 0 }],
      startAngle: 210,
      endAngle: 510,
      dialShape: 'square',
      indicatorDistance: 8,
      indicatorShape: 'triangle',
      squareColor: '#14161b',
      dialDistance: 27,
      tickSets: [
        {
          id: nextId(),
          count: 2,
          showLabels: true,
          labelFontFamily: 'roboto',
          labelFontSize: 5,
          labelColor: '#a5a5a5',
          labelDistance: 11,
          labelTextExpr: "return variables.$value === 0 ? 'VID' : 'SYM';",
          size: 7
        }
      ],
      bezelBorderWidth: 2,
      borderColor: '#d8dbdb',
      bezelRadius: 44,
      bezelColor: '#acb3b3',
      indicatorStyle: { borderRadius: 1, height: 14 },
      indicatorColor: '#e8e8ea',
      squareHeight: 32,
      squareWidth: 18,
      rotateAngle: 0,
      valueExpr: 'return variables.HUD_BALANCE || 0;'
    })
  },
  {
    name: 'Aircraft Dial 2',
    build: (pos) => ({
      id: nextId(),
      type: 'adjuster-knob',
      x: pos.x,
      y: pos.y,
      w: 40,
      h: 40,
      orientation: 'vertical',
      min: 0,
      max: 65535,
      events: {
        press: [],
        release: [],
        move: [
          {
            kind: 'action',
            id: nextId(),
            action: { kind: 'send-dcs-command', aircraft: 'FA-18C_hornet', identifier: 'HUD_AOA_INDEXER', interface: 'set_state', argument: '$value' }
          }
        ],
        doublePress: [],
        triplePress: []
      },
      fill: { color: '#5b8def', backgroundOpacity: 0 },
      track: { color: '#e2547b', backgroundOpacity: 0 },
      labels: [{ id: nextId(), text: 'AOA', align: 'center', verticalAlign: 'top', fontFamily: 'roboto', fontSize: 8, padding: -10, rotation: 0 }],
      startAngle: 210,
      endAngle: 510,
      dialShape: 'square',
      indicatorDistance: 27,
      indicatorShape: 'tick',
      squareColor: '#dadada',
      dialDistance: 0,
      tickSets: [
        {
          id: nextId(),
          count: 2,
          showLabels: true,
          labelTextExpr: "return variables.$value === 0 ? 'OFF' : 'BRT';",
          labelFontSize: 5,
          labelFontFamily: 'roboto',
          labelColor: '#a5a5a5',
          labelDistance: 11
        }
      ],
      bezelBorderWidth: 2,
      borderColor: '#d8dbdb',
      bezelRadius: 44,
      bezelColor: '#acb3b3',
      indicatorStyle: { borderRadius: 1, height: 31, width: 6 },
      indicatorColor: '#14161b',
      squareHeight: 87,
      squareWidth: 30,
      rotateAngle: 0,
      squareBorderRadius: 39,
      squareBorderWidth: 0,
      valueExpr: 'return variables.HUD_AOA_INDEXER;'
    })
  }
]

// A cabin pressure altitude arc gauge — same Empty Wempty source as the
// Dial variants above, custom MS33558 label/tick fonts swapped to the
// built-in 'roboto' for the same portability reason.
const ARC_GAUGE_VARIANTS: WidgetVariant<ArcGaugeWidget>[] = [
  {
    name: 'Aircraft Pressure Gauge',
    build: (pos) => ({
      id: nextId(),
      type: 'gauge-arc',
      x: pos.x,
      y: pos.y,
      w: 96,
      h: 96,
      valueExpr: 'return 19;',
      min: 0,
      max: 50,
      fill: { color: '#5b8def', backgroundOpacity: 0 },
      track: { color: '#2a2e37', backgroundOpacity: 0 },
      labels: [
        { id: nextId(), text: 'CABIN', align: 'center', verticalAlign: 'top', fontSize: 4, padding: 38, fontFamily: 'roboto' },
        { id: nextId(), text: 'PRESS ALT␤x1000', align: 'center', verticalAlign: 'bottom', fontSize: 4, padding: 31, fontFamily: 'roboto' }
      ],
      tickSets: [
        {
          id: nextId(),
          count: 6,
          showLabels: true,
          borderWidth: 0,
          labelDecimals: 0,
          color: '#e8e8ea',
          labelDistance: -17,
          size: 9,
          distance: 35,
          thickness: 2,
          labelFontSize: 8,
          labelFontFamily: 'roboto'
        },
        { id: nextId(), count: 11, showLabels: false, color: '#e8e8ea', thickness: 2, distance: 35, size: 9 },
        { id: nextId(), count: 51, showLabels: false, color: '#e8e8ea', thickness: 1, size: 5, distance: 39 }
      ],
      showIndicator: true,
      indicatorColor: '#e8e8ea',
      startAngle: 180,
      endAngle: 486,
      indicatorStartDistance: 0,
      indicatorCenterColor: '#e8e8ea',
      indicatorCenterSize: 0,
      indicatorEndDistance: 42
    })
  }
]

// A 4-position (P/C/LD/RV) KY-58 mode-select rotary switch — same Empty
// Wempty source as the variants above, custom MS33558 fonts swapped to the
// built-in 'roboto' for the same portability reason.
const DIAL_SWITCH_VARIANTS: WidgetVariant<DialSwitchWidget>[] = [
  {
    name: 'Aircraft Dial 1',
    build: (pos) => ({
      id: nextId(),
      type: 'switch-dial',
      x: pos.x,
      y: pos.y,
      w: 50,
      h: 50,
      positions: [
        {
          id: nextId(),
          name: 'P',
          labels: [{ id: nextId(), text: 'P', fontFamily: 'roboto', align: 'center', verticalAlign: 'center', textColor: '#a5a5a5', fontSize: 5, labelDistance: 19 }],
          onSelect: [],
          color: '#a5a5a5',
          activeColor: '#a5a5a5'
        },
        {
          id: nextId(),
          name: 'C',
          labels: [{ id: nextId(), text: 'C', align: 'center', verticalAlign: 'center', fontSize: 5, textColor: '#a5a5a5', labelDistance: 16, fontFamily: 'roboto' }],
          onSelect: [],
          color: '#a5a5a5',
          activeColor: '#a5a5a5'
        },
        {
          id: nextId(),
          name: 'LD',
          labels: [{ id: nextId(), text: 'LD', align: 'center', verticalAlign: 'center', textColor: '#a5a5a5', fontSize: 5, labelDistance: 13, fontFamily: 'roboto' }],
          onSelect: [],
          color: '#a5a5a5',
          activeColor: '#a5a5a5'
        },
        {
          id: nextId(),
          name: 'RV',
          labels: [{ id: nextId(), text: 'RV', align: 'center', verticalAlign: 'center', fontSize: 5, textColor: '#a5a5a5', labelDistance: 26, fontFamily: 'roboto' }],
          onSelect: [],
          color: '#a5a5a5',
          activeColor: '#a5a5a5'
        }
      ],
      labels: [{ id: nextId(), text: 'MODE', align: 'center', verticalAlign: 'top', textColor: '#e8e8ea', padding: -20, fontSize: 8, fontFamily: 'roboto' }],
      track: { color: '#14161b' },
      fill: { color: '#5b8def' },
      startAngle: 270,
      endAngle: 405,
      detentShape: 'tick',
      detentStyle: { borderColor: '#a5a5a5', borderRadius: 0, borderWidth: 0, width: 1, height: 11 },
      detentRadius: 51,
      dialShape: 'square',
      circleColor: '#a7a9b3',
      circleSize: 64,
      indicatorShape: 'triangle',
      indicatorStyle: { borderColor: '#14161b', borderWidth: 0, width: 10, height: 21, borderRadius: 2 },
      circleBorderColor: '#5d5d5d',
      circleBorderWidth: 2,
      borderColor: '#2a2e37',
      indicatorDistance: 25,
      indicatorColor: '#e8e8ea',
      interactionMode: 'drag',
      squareColor: '#1f2229',
      squareBorderColor: '#7d8193',
      squareBorderWidth: 0,
      squareBorderRadius: 15,
      squareHeight: 97,
      squareWidth: 38,
      events: {
        press: [],
        release: [],
        positionChange: [
          {
            kind: 'action',
            id: nextId(),
            action: {
              kind: 'send-dcs-command',
              aircraft: 'FA-18C_hornet',
              identifier: 'KY58_MODE_SELECT',
              interface: 'set_state',
              argument: '0',
              argumentExpr:
                'const map = {\n  3: "RV",\n  2: "LD",\n  1: "C",\n  0: "P"\n};\n\nreturn Object.entries(map).find((r) => r[1] === variables.$value)[0]'
            }
          }
        ],
        increment: [],
        decrement: [],
        doublePress: [],
        triplePress: []
      },
      dialDistance: -5,
      rotateAngle: 0,
      fireWhileDragging: true,
      indicatorSquareBorder: {
        widthTop: 0,
        widthLeft: 4,
        widthBottom: 4,
        widthRight: 4,
        radiusTopLeft: 4,
        radiusBottomLeft: 4,
        radiusBottomRight: 4,
        radiusTopRight: 4
      },
      activePositionExpr: 'const map = {\n  3: "RV",\n  2: "LD",\n  1: "C",\n  0: "P"\n};\n\nreturn map[variables.KY58_MODE_SELECT];',
      waitForStateConfirm: true
    })
  },
  {
    // The F/A-18 wing-fold handle — FOLD/HOLD/SPREAD, pull-to-release (press/
    // release drive WING_FOLD_PULL, same "hold the collar out to turn"
    // physical behavior the real handle has). Same Empty Wempty source as
    // the variants above, custom MS33558 label font swapped to the built-in
    // 'roboto' for the same portability reason.
    name: 'Wing Position Handle',
    build: (pos) => ({
      id: nextId(),
      type: 'switch-dial',
      x: pos.x,
      y: pos.y,
      w: 120,
      h: 120,
      positions: [
        {
          id: nextId(),
          name: 'FOLD',
          labels: [{ id: nextId(), text: 'FOLD', fontFamily: 'roboto', align: 'center', verticalAlign: 'center', fontSize: 8, textColor: '#a5a5a5', labelDistance: 15 }],
          onSelect: [
            {
              kind: 'action',
              id: nextId(),
              action: { kind: 'send-dcs-command', aircraft: 'FA-18C_hornet', identifier: 'WING_FOLD_ROTATE', interface: 'fixed_step', argument: '0' }
            }
          ]
        },
        {
          id: nextId(),
          name: 'HOLD',
          labels: [{ id: nextId(), text: 'HOLD', fontFamily: 'roboto', align: 'center', verticalAlign: 'center', fontSize: 8, textColor: '#a5a5a5', labelDistance: 16 }],
          onSelect: [
            {
              kind: 'action',
              id: nextId(),
              action: { kind: 'send-dcs-command', aircraft: 'FA-18C_hornet', identifier: 'WING_FOLD_ROTATE', interface: 'set_state', argument: '1' }
            }
          ]
        },
        {
          id: nextId(),
          name: 'SPREAD',
          labels: [{ id: nextId(), text: 'SPREAD', align: 'center', verticalAlign: 'center', fontFamily: 'roboto', fontSize: 8, textColor: '#a5a5a5', labelDistance: 26 }],
          onSelect: [
            {
              kind: 'action',
              id: nextId(),
              action: { kind: 'send-dcs-command', aircraft: 'FA-18C_hornet', identifier: 'WING_FOLD_ROTATE', interface: 'fixed_step', argument: '2' }
            }
          ]
        }
      ],
      labels: [],
      track: { color: '#2a2e37', backgroundOpacity: 0 },
      fill: { color: '#e8e8ea' },
      events: {
        press: [
          {
            kind: 'action',
            id: nextId(),
            action: { kind: 'send-dcs-command', aircraft: 'FA-18C_hornet', identifier: 'WING_FOLD_PULL', interface: 'set_state', argument: '1' }
          }
        ],
        release: [
          {
            kind: 'action',
            id: nextId(),
            action: { kind: 'send-dcs-command', aircraft: 'FA-18C_hornet', identifier: 'WING_FOLD_PULL', interface: 'set_state', argument: '0' }
          }
        ],
        positionChange: [],
        increment: [],
        decrement: [],
        doublePress: [],
        triplePress: []
      },
      startAngle: 360,
      endAngle: 450,
      borderOpacity: 0,
      detentShape: 'tick',
      dialShape: 'square',
      squareColor: '#666666',
      squareWidth: 24,
      squareHeight: 71,
      dialDistance: 13,
      indicatorShape: 'triangle',
      indicatorColor: '#e8e8ea',
      indicatorStyle: { width: 8, height: 14 },
      indicatorDistance: 15,
      squareBorderRadius: 10,
      interactionMode: 'drag',
      detentRadius: 59,
      detentStyle: { borderColor: '#e8e8ea', borderWidth: 1, width: 1 },
      fireWhileDragging: true
    })
  }
]

// The main button (left) still adds the plain default on a direct click;
// the chevron (right) opens a dropdown of named variants instead. Closes on
// an outside pointerdown or Escape — same pattern as ContextMenu.tsx's own
// (capture-phase, so a widget's own stopPropagation-ing pointerdown handler
// elsewhere on the canvas still can't prevent this from seeing it). Generic
// over W since more than one widget type has variants now (Toggle Switch,
// Button) — each palette row instantiates this with its own widget type.
function PaletteVariantButton<W extends Widget>({
  label,
  onAddPlain,
  variants,
  onSelectVariant,
  onDeleteVariant
}: {
  label: string
  onAddPlain: () => void
  variants: WidgetVariant<W>[]
  onSelectVariant: (variant: WidgetVariant<W>) => void
  // Only ever called for a row whose variant.customVariantId is set (see
  // the row's own conditional render below) — a built-in variant has
  // nothing to delete.
  onDeleteVariant: (customVariantId: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const groupRef = useRef<HTMLDivElement>(null)
  const confirm = useConfirmStore((s) => s.confirm)

  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: PointerEvent): void {
      if (groupRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  async function handleDelete(variant: WidgetVariant<W>): Promise<void> {
    if (!variant.customVariantId) return
    const ok = await confirm(`Delete the "${variant.name}" variant? This cannot be undone.`, { confirmLabel: 'Delete' })
    if (ok) onDeleteVariant(variant.customVariantId)
  }

  return (
    <div className="palette__item-group" ref={groupRef}>
      <button className="palette__item" onClick={onAddPlain}>
        {label}
      </button>
      <button type="button" className="palette__item-variant-toggle" title="Add a variant…" onClick={() => setOpen((o) => !o)}>
        ▾
      </button>
      {open && (
        <div className="palette__item-variant-menu">
          {variants.map((variant) => (
            <div key={variant.customVariantId ?? variant.name} className="palette__item-variant-menu-row">
              <button
                type="button"
                className="palette__item-variant-menu-item"
                onClick={() => {
                  onSelectVariant(variant)
                  setOpen(false)
                }}
              >
                {variant.name}
              </button>
              {variant.customVariantId && (
                <button type="button" className="palette__item-variant-menu-delete" title="Delete this variant" onClick={() => handleDelete(variant)}>
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Standalone counterpart to PaletteVariantButton for a 2+-widget
// CustomVariant — no single widget type to be "the plain default" of, so
// unlike that one this is just a toggle that opens straight into the list,
// no separate main/chevron split. Only ever rendered when at least one
// group variant exists (see Palette's own groupCustomVariants.length > 0
// check) — nothing else to fall back to otherwise.
function CustomVariantsButton({
  variants,
  onSelect,
  onDelete
}: {
  variants: CustomVariant[]
  onSelect: (variant: CustomVariant) => void
  onDelete: (customVariantId: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const groupRef = useRef<HTMLDivElement>(null)
  const confirm = useConfirmStore((s) => s.confirm)

  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: PointerEvent): void {
      if (groupRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  async function handleDelete(variant: CustomVariant): Promise<void> {
    const ok = await confirm(`Delete the "${variant.name}" variant? This cannot be undone.`, { confirmLabel: 'Delete' })
    if (ok) onDelete(variant.id)
  }

  return (
    <div className="palette__item-group" ref={groupRef}>
      <button type="button" className="palette__item palette__item--custom-variants" onClick={() => setOpen((o) => !o)}>
        + Custom Variants ▾
      </button>
      {open && (
        <div className="palette__item-variant-menu palette__item-variant-menu--below">
          {variants.map((variant) => (
            <div key={variant.id} className="palette__item-variant-menu-row">
              <button
                type="button"
                className="palette__item-variant-menu-item"
                onClick={() => {
                  onSelect(variant)
                  setOpen(false)
                }}
              >
                {variant.name}
              </button>
              <button type="button" className="palette__item-variant-menu-delete" title="Delete this variant" onClick={() => handleDelete(variant)}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function Palette(): React.JSX.Element {
  const addWidget = useDashboardStore((s) => s.addWidget)
  const selectWidget = useDashboardStore((s) => s.selectWidget)
  const pasteWidgets = useDashboardStore((s) => s.pasteWidgets)
  const groupWidgets = useDashboardStore((s) => s.groupWidgets)
  const customVariants = useDashboardStore((s) => s.customVariants)
  const deleteCustomVariant = useDashboardStore((s) => s.deleteCustomVariant)
  const camera = useEditorSettings((s) => s.camera)
  // null (not yet arrived — see main/index.ts's sendInitialState) reads as
  // enabled, same "don't flash a wrong state before the real one lands"
  // convention as ScreenCaptureWidgetContent's own pluginEnabled.
  const enabledPlugins = useDashboardStore((s) => s.enabledPlugins)
  const screenCaptureAvailable = enabledPlugins === null || !isWidgetTypeGatedByDisabledPlugin('screen-capture', enabledPlugins)
  // No widgetTypes entry for 'dcsViewports' (see shared/plugins/dcsViewports.ts)
  // — its widget also needs the virtual display to be ready, not just the
  // plugin toggle, which isWidgetTypeGatedByDisabledPlugin can't express. The
  // add button only checks the toggle, same bar as screenCaptureAvailable;
  // "not ready yet" shows as the widget's own placeholder once added (see
  // DcsViewportWidgetContent), not as a hidden palette button.
  const dcsViewportsAvailable = enabledPlugins === null || enabledPlugins.includes('dcsViewports')

  // Where a newly-added widget lands: just inside the canvas corner that's
  // currently visible, rather than a fixed board-origin spot that could be
  // panned/zoomed far off-screen. -camera.x/y is the world coordinate under
  // the viewport's own top-left corner (inverse of the canvas-layer's
  // translate+scale — see Canvas.tsx's screenToWorld for the same math), and
  // the +40 keeps it off the very edge, matching the old fixed inset.
  function spawnPosition(): { x: number; y: number } {
    return { x: -camera.x / camera.zoom + 40, y: -camera.y / camera.zoom + 40 }
  }

  // User-saved single-widget CustomVariants (widgets.length === 1) whose
  // one widget matches `type` — merged into that type's own split-button
  // dropdown alongside any built-in WidgetVariant array (see
  // TOGGLE_SWITCH_VARIANTS etc. above). A 2+-widget CustomVariant never
  // shows up here — see groupCustomVariants below, offered instead from the
  // standalone "Custom Variants" button. cloneWidget (same regeneration
  // clipboardStore's own paste uses) gives every spawned copy fresh
  // ids/groupId, exactly like picking a built-in variant already does.
  function customVariantsFor<T extends Widget['type']>(type: T): WidgetVariant<Extract<Widget, { type: T }>>[] {
    return customVariants
      .filter((v) => v.widgets.length === 1 && v.widgets[0].type === type)
      .map((v) => ({
        name: v.name,
        customVariantId: v.id,
        build: (pos: { x: number; y: number }) => {
          const cloned = cloneWidget(v.widgets[0], 0) as Extract<Widget, { type: T }>
          return { ...cloned, x: pos.x, y: pos.y }
        }
      }))
  }

  // Single handler for every widget type's variant dropdown — a variant's
  // own build(pos) already fully describes the widget, so there's nothing
  // type-specific left to do once it's picked.
  function handleSelectVariant<W extends Widget>(variant: WidgetVariant<W>): void {
    const widget = variant.build(spawnPosition())
    addWidget(widget)
    selectWidget(widget.id)
  }

  // 2+-widget CustomVariants — offered from the standalone "Custom Variants"
  // palette button (no single type to hang off of). Spawned via
  // pasteWidgets/groupWidgets, the same two store primitives regular
  // multi-widget paste and right-click "Group" already use, rather than
  // duplicating either's own logic here.
  const groupCustomVariants = customVariants.filter((v) => v.widgets.length > 1)

  function handleAddGroupVariant(variant: CustomVariant): void {
    const pos = spawnPosition()
    const cloned = variant.widgets.map((w) => ({ ...cloneWidget(w, 0), x: pos.x + w.x, y: pos.y + w.y }))
    pasteWidgets(cloned)
    groupWidgets(cloned.map((w) => w.id))
  }

  function handleAddButton(): void {
    const pos = spawnPosition()
    const widget: ButtonWidget = {
      id: nextId(),
      type: 'button',
      x: pos.x,
      y: pos.y,
      w: 160,
      h: 80,
      events: { press: [], release: [], doublePress: [], triplePress: [] },
      statesEnabled: false,
      states: [
        {
          id: nextId(),
          name: 'Default',
          labels: [{ id: nextId(), text: 'New Button', fontFamily: DEFAULT_FONT_ID, align: 'center', verticalAlign: 'center' }]
        }
      ]
    }
    addWidget(widget)
    selectWidget(widget.id)
  }


  function handleAddMorph(): void {
    const pos = spawnPosition()
    const widget: MorphButtonWidget = {
      id: nextId(),
      type: 'morph',
      x: pos.x,
      y: pos.y,
      cellW: 40,
      cellH: 40,
      blocks: [
        { id: nextId(), col: 0, row: 0, perState: {} },
        { id: nextId(), col: 1, row: 0, perState: {} },
        { id: nextId(), col: 2, row: 0, perState: {} },
        { id: nextId(), col: 3, row: 0, perState: {} },
        { id: nextId(), col: 3, row: 1, perState: {} },
        { id: nextId(), col: 3, row: 2, perState: {} }
      ],
      events: { press: [], release: [] },
      statesEnabled: false,
      states: [
        {
          id: nextId(),
          name: 'Default',
          labels: [{ id: nextId(), text: 'New Morph', fontFamily: DEFAULT_FONT_ID, align: 'center', verticalAlign: 'center' }]
        }
      ]
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  function handleAddBarGauge(): void {
    const pos = spawnPosition()
    const widget: BarGaugeWidget = {
      id: nextId(),
      type: 'gauge-bar',
      x: pos.x,
      y: pos.y,
      w: 160,
      h: 40,
      valueExpr: 'const someValue = 34;\nreturn variables.my_variable || someValue;',
      min: 0,
      max: 100,
      orientation: 'horizontal',
      fill: { color: '#5b8def' },
      // Left unset, not DEFAULT_WIDGET_COLOR — GaugeWidgetContent's own
      // trackColor fallback already resolves to that same value (no visual
      // change here).
      track: {},
      labels: []
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  function handleAddArcGauge(): void {
    const pos = spawnPosition()
    const widget: ArcGaugeWidget = {
      id: nextId(),
      type: 'gauge-arc',
      x: pos.x,
      y: pos.y,
      w: 120,
      h: 120,
      valueExpr: 'const someValue = 34;\nreturn variables.my_variable || someValue;',
      min: 0,
      max: 100,
      fill: { color: '#5b8def' },
      track: { color: '#2a2e37' },
      labels: [],
      startAngle: 225,
      endAngle: 495,
      showIndicator: true
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  function handleAddSlider(): void {
    const pos = spawnPosition()
    const widget: AdjusterSliderWidget = {
      id: nextId(),
      type: 'adjuster-slider',
      x: pos.x,
      y: pos.y,
      w: 60,
      h: 160,
      orientation: 'vertical',
      min: 0,
      max: 100,
      events: { press: [], release: [], move: [], doublePress: [], triplePress: [] },
      fill: { color: '#5b8def' },
      track: { color: DEFAULT_WIDGET_COLOR },
      labels: [],
      valueExpr: 'const someValue = 34;\nreturn variables.my_variable || someValue;',
      handleShape: 'square',
      handleWidth: 32,
      handleHeight: 12,
      handleRadius: 3,
      handleColor: '#3a3f4a'
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  function handleAddKnob(): void {
    const pos = spawnPosition()
    const widget: AdjusterKnobWidget = {
      id: nextId(),
      type: 'adjuster-knob',
      x: pos.x,
      y: pos.y,
      w: 100,
      h: 100,
      min: 0,
      max: 100,
      events: { press: [], release: [], move: [], doublePress: [], triplePress: [] },
      fill: { color: '#5b8def' },
      track: { color: DEFAULT_WIDGET_COLOR },
      labels: [],
      valueExpr: 'const someValue = 34;\nreturn variables.my_variable || someValue;',
      dialShape: 'square',
      squareWidth: 22,
      squareHeight: 40,
      squareBorderRadius: 2,
      indicatorShape: 'triangle',
      indicatorStyle: { width: 22, height: 12, borderWidth: 0, borderRadius: 2 },
      indicatorDistance: 25,
      dialDistance: -3,
      startAngle: 225,
      endAngle: 495
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  function handleAddEncoder(): void {
    const pos = spawnPosition()
    const widget: EncoderWidget = {
      id: nextId(),
      type: 'encoder',
      x: pos.x,
      y: pos.y,
      w: 80,
      h: 80,
      stepDegrees: 15,
      events: { increment: [], decrement: [], press: [], release: [], doublePress: [], triplePress: [] },
      fill: { color: '#5b8def' },
      track: { color: DEFAULT_WIDGET_COLOR },
      labels: []
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  // Rocker-specific — Dial Switch and Dropdown each have their own dedicated
  // positions factory too (defaultDialSwitchPositions/defaultDropdownPositions),
  // not one shared function anymore. "On"/"Off" reads right for a rocker
  // specifically, and activeColor: '#5b8def' matches the same accent blue
  // every other widget's own default active/fill color already uses (Dial
  // Switch's fill, Gauge's fill, ...) instead of falling back to
  // pickAutoActiveColor's auto-lightened-gray.
  function defaultRockerPositions(): RockerSwitchWidget['positions'] {
    return [
      {
        id: nextId(),
        name: 'On',
        labels: [{ id: nextId(), text: 'On', fontFamily: DEFAULT_FONT_ID, align: 'center', verticalAlign: 'center' }],
        activeColor: '#5b8def',
        onSelect: []
      },
      {
        id: nextId(),
        name: 'Off',
        labels: [{ id: nextId(), text: 'Off', fontFamily: DEFAULT_FONT_ID, align: 'center', verticalAlign: 'center' }],
        activeColor: '#5b8def',
        onSelect: []
      }
    ]
  }

  function handleAddRockerSwitch(): void {
    const pos = spawnPosition()
    const widget: RockerSwitchWidget = {
      id: nextId(),
      type: 'switch-rocker',
      x: pos.x,
      y: pos.y,
      w: 60,
      h: 160,
      orientation: 'vertical',
      positions: defaultRockerPositions(),
      track: { color: DEFAULT_WIDGET_COLOR },
      labels: [],
      events: { press: [], release: [], positionChange: [] },
      onInactive: []
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  // Dial-Switch-specific (the only remaining caller of what used to be the
  // shared defaultPositions() — Rocker/Dropdown each got their own above).
  // Four positions with an explicit unselected color and the same accent
  // activeColor every other widget's own default now uses, plus
  // labelDistance so each detent's label sits a bit further out than the
  // fixed default offset.
  function defaultDialSwitchPositions(): DialSwitchWidget['positions'] {
    return ['1', '2', '3', '4'].map((text, i) => ({
      id: nextId(),
      name: `Position ${i + 1}`,
      labels: [{ id: nextId(), text, fontFamily: DEFAULT_FONT_ID, align: 'center', verticalAlign: 'center', labelDistance: 20 }],
      color: '#3a3f4a',
      activeColor: '#5b8def',
      onSelect: []
    }))
  }

  function handleAddDialSwitch(): void {
    const pos = spawnPosition()
    const widget: DialSwitchWidget = {
      id: nextId(),
      type: 'switch-dial',
      x: pos.x,
      y: pos.y,
      w: 100,
      h: 100,
      positions: defaultDialSwitchPositions(),
      labels: [],
      track: { color: DEFAULT_WIDGET_COLOR },
      fill: { color: '#5b8def' },
      events: { press: [], release: [], positionChange: [], increment: [], decrement: [], doublePress: [], triplePress: [] },
      fireWhileDragging: true,
      interactionMode: 'drag',
      startAngle: 270,
      endAngle: 450,
      dialShape: 'square',
      squareWidth: 22,
      squareHeight: 56,
      indicatorShape: 'triangle',
      indicatorStyle: { width: 22 },
      indicatorDistance: 33,
      detentShape: 'tick',
      detentStyle: { height: 9, width: 2 },
      detentRadius: 49
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  function defaultTogglePositions(): ToggleSwitchWidget['positions'] {
    return [
      {
        id: nextId(),
        name: 'Top',
        labels: [{ id: nextId(), text: 'Top', fontFamily: DEFAULT_FONT_ID, align: 'center', verticalAlign: 'center', padding: 8, labelDistance: 20 }],
        onSelect: []
      },
      {
        id: nextId(),
        name: 'Bottom',
        labels: [{ id: nextId(), text: 'Bottom', fontFamily: DEFAULT_FONT_ID, align: 'center', verticalAlign: 'center', labelDistance: 20 }],
        onSelect: []
      }
    ]
  }

  function handleAddToggleSwitch(): void {
    const pos = spawnPosition()
    const widget: ToggleSwitchWidget = {
      id: nextId(),
      type: 'switch-toggle',
      x: pos.x,
      y: pos.y,
      w: 70,
      h: 130,
      orientation: 'vertical',
      positions: defaultTogglePositions(),
      labels: [],
      track: { color: DEFAULT_WIDGET_COLOR },
      fill: { color: '#5b8def' },
      events: { press: [], release: [], positionChange: [], guardToggle: [] },
      fireWhileDragging: true,
      leverLength: 40,
      leverTipRadius: 12,
      leverBaseRadius: 7,
      bezelRadius: 42
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  // Dropdown-specific — same activeColor: '#5b8def' reasoning as
  // defaultRockerPositions() above.
  function defaultDropdownPositions(): DropdownWidget['positions'] {
    return [
      {
        id: nextId(),
        name: 'Position 1',
        labels: [{ id: nextId(), text: 'Position 1', fontFamily: DEFAULT_FONT_ID, align: 'center', verticalAlign: 'center' }],
        activeColor: '#5b8def',
        onSelect: []
      },
      {
        id: nextId(),
        name: 'Position 2',
        labels: [{ id: nextId(), text: 'Position 2', fontFamily: DEFAULT_FONT_ID, align: 'center', verticalAlign: 'center' }],
        activeColor: '#5b8def',
        onSelect: []
      },
      {
        id: nextId(),
        name: 'Position 3',
        labels: [{ id: nextId(), text: 'Position 3', fontFamily: DEFAULT_FONT_ID, align: 'center', verticalAlign: 'center' }],
        activeColor: '#5b8def',
        onSelect: []
      }
    ]
  }

  function handleAddDropdown(): void {
    const pos = spawnPosition()
    const widget: DropdownWidget = {
      id: nextId(),
      type: 'dropdown',
      x: pos.x,
      y: pos.y,
      w: 120,
      h: 36,
      orientation: 'top-to-bottom',
      positions: defaultDropdownPositions(),
      events: { press: [], release: [], positionChange: [] },
      track: { color: DEFAULT_WIDGET_COLOR }
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  function handleAddLabel(): void {
    const pos = spawnPosition()
    const widget: LabelWidget = {
      id: nextId(),
      type: 'label',
      x: pos.x,
      y: pos.y,
      w: 160,
      h: 40,
      label: { id: nextId(), text: 'Label', fontFamily: DEFAULT_FONT_ID, align: 'center', verticalAlign: 'center' }
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  function handleAddLine(): void {
    const pos = spawnPosition()
    const widget: LineWidget = {
      id: nextId(),
      type: 'line',
      x: pos.x,
      y: pos.y,
      w: 160,
      h: 4,
      lineWidth: 1,
      color: '#ffffff'
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  function handleAddScreenCapture(): void {
    const pos = spawnPosition()
    const widget: ScreenCaptureWidget = {
      id: nextId(),
      type: 'screen-capture',
      x: pos.x,
      y: pos.y,
      w: 240,
      h: 160,
      streamMode: 'poll',
      fps: 5,
      quality: 70
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  function handleAddDcsViewport(): void {
    const pos = spawnPosition()
    const widget: DcsViewportWidget = {
      id: nextId(),
      type: 'dcs-viewport',
      x: pos.x,
      y: pos.y,
      w: 240,
      h: 160,
      streamMode: 'poll',
      fps: 5,
      quality: 70
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  // Merges each type's own built-in WidgetVariant array (if any) with
  // whatever user-saved single-widget CustomVariants match it — see
  // customVariantsFor's own comment. A type with neither renders a plain
  // button below (no chevron at all) rather than an always-empty dropdown.
  const buttonVariants = [...BUTTON_VARIANTS, ...customVariantsFor('button')]
  const labelVariants = customVariantsFor('label')
  const lineVariants = customVariantsFor('line')
  const morphVariants = customVariantsFor('morph')
  const barGaugeVariants = customVariantsFor('gauge-bar')
  const arcGaugeVariants = [...ARC_GAUGE_VARIANTS, ...customVariantsFor('gauge-arc')]
  const sliderVariants = customVariantsFor('adjuster-slider')
  const knobVariants = [...ADJUSTER_KNOB_VARIANTS, ...customVariantsFor('adjuster-knob')]
  const encoderVariants = customVariantsFor('encoder')
  const rockerVariants = customVariantsFor('switch-rocker')
  const dialSwitchVariants = [...DIAL_SWITCH_VARIANTS, ...customVariantsFor('switch-dial')]
  const toggleSwitchVariants = [...TOGGLE_SWITCH_VARIANTS, ...customVariantsFor('switch-toggle')]
  const dropdownVariants = customVariantsFor('dropdown')
  const screenCaptureVariants = customVariantsFor('screen-capture')
  const dcsViewportVariants = customVariantsFor('dcs-viewport')

  return (
    <aside className="palette">
      <h2 className="palette__title">Widgets</h2>
      <PaletteVariantButton<ButtonWidget>
        label="+ Button"
        onAddPlain={handleAddButton}
        variants={buttonVariants}
        onSelectVariant={handleSelectVariant}
        onDeleteVariant={deleteCustomVariant}
      />
      {labelVariants.length > 0 ? (
        <PaletteVariantButton<LabelWidget>
          label="+ Label"
          onAddPlain={handleAddLabel}
          variants={labelVariants}
          onSelectVariant={handleSelectVariant}
          onDeleteVariant={deleteCustomVariant}
        />
      ) : (
        <button className="palette__item" onClick={handleAddLabel}>
          + Label
        </button>
      )}
      {lineVariants.length > 0 ? (
        <PaletteVariantButton<LineWidget>
          label="+ Line"
          onAddPlain={handleAddLine}
          variants={lineVariants}
          onSelectVariant={handleSelectVariant}
          onDeleteVariant={deleteCustomVariant}
        />
      ) : (
        <button className="palette__item" onClick={handleAddLine}>
          + Line
        </button>
      )}
      {morphVariants.length > 0 ? (
        <PaletteVariantButton<MorphButtonWidget>
          label="+ Morph button"
          onAddPlain={handleAddMorph}
          variants={morphVariants}
          onSelectVariant={handleSelectVariant}
          onDeleteVariant={deleteCustomVariant}
        />
      ) : (
        <button className="palette__item" onClick={handleAddMorph}>
          + Morph button
        </button>
      )}
      {barGaugeVariants.length > 0 ? (
        <PaletteVariantButton<BarGaugeWidget>
          label="+ Bar Gauge"
          onAddPlain={handleAddBarGauge}
          variants={barGaugeVariants}
          onSelectVariant={handleSelectVariant}
          onDeleteVariant={deleteCustomVariant}
        />
      ) : (
        <button className="palette__item" onClick={handleAddBarGauge}>
          + Bar Gauge
        </button>
      )}
      <PaletteVariantButton<ArcGaugeWidget>
        label="+ Arc Gauge"
        onAddPlain={handleAddArcGauge}
        variants={arcGaugeVariants}
        onSelectVariant={handleSelectVariant}
        onDeleteVariant={deleteCustomVariant}
      />
      {sliderVariants.length > 0 ? (
        <PaletteVariantButton<AdjusterSliderWidget>
          label="+ Slider"
          onAddPlain={handleAddSlider}
          variants={sliderVariants}
          onSelectVariant={handleSelectVariant}
          onDeleteVariant={deleteCustomVariant}
        />
      ) : (
        <button className="palette__item" onClick={handleAddSlider}>
          + Slider
        </button>
      )}
      <PaletteVariantButton<AdjusterKnobWidget>
        label="+ Knob"
        onAddPlain={handleAddKnob}
        variants={knobVariants}
        onSelectVariant={handleSelectVariant}
        onDeleteVariant={deleteCustomVariant}
      />
      {encoderVariants.length > 0 ? (
        <PaletteVariantButton<EncoderWidget>
          label="+ Encoder"
          onAddPlain={handleAddEncoder}
          variants={encoderVariants}
          onSelectVariant={handleSelectVariant}
          onDeleteVariant={deleteCustomVariant}
        />
      ) : (
        <button className="palette__item" onClick={handleAddEncoder}>
          + Encoder
        </button>
      )}
      {rockerVariants.length > 0 ? (
        <PaletteVariantButton<RockerSwitchWidget>
          label="+ Rocker switch"
          onAddPlain={handleAddRockerSwitch}
          variants={rockerVariants}
          onSelectVariant={handleSelectVariant}
          onDeleteVariant={deleteCustomVariant}
        />
      ) : (
        <button className="palette__item" onClick={handleAddRockerSwitch}>
          + Rocker switch
        </button>
      )}
      <PaletteVariantButton<DialSwitchWidget>
        label="+ Dial switch"
        onAddPlain={handleAddDialSwitch}
        variants={dialSwitchVariants}
        onSelectVariant={handleSelectVariant}
        onDeleteVariant={deleteCustomVariant}
      />
      <PaletteVariantButton<ToggleSwitchWidget>
        label="+ Toggle switch"
        onAddPlain={handleAddToggleSwitch}
        variants={toggleSwitchVariants}
        onSelectVariant={handleSelectVariant}
        onDeleteVariant={deleteCustomVariant}
      />
      {dropdownVariants.length > 0 ? (
        <PaletteVariantButton<DropdownWidget>
          label="+ Dropdown"
          onAddPlain={handleAddDropdown}
          variants={dropdownVariants}
          onSelectVariant={handleSelectVariant}
          onDeleteVariant={deleteCustomVariant}
        />
      ) : (
        <button className="palette__item" onClick={handleAddDropdown}>
          + Dropdown
        </button>
      )}
      {screenCaptureAvailable &&
        (screenCaptureVariants.length > 0 ? (
          <PaletteVariantButton<ScreenCaptureWidget>
            label="+ Screen capture"
            onAddPlain={handleAddScreenCapture}
            variants={screenCaptureVariants}
            onSelectVariant={handleSelectVariant}
            onDeleteVariant={deleteCustomVariant}
          />
        ) : (
          <button className="palette__item" onClick={handleAddScreenCapture}>
            + Screen capture
          </button>
        ))}
      {dcsViewportsAvailable &&
        (dcsViewportVariants.length > 0 ? (
          <PaletteVariantButton<DcsViewportWidget>
            label="+ DCS viewport"
            onAddPlain={handleAddDcsViewport}
            variants={dcsViewportVariants}
            onSelectVariant={handleSelectVariant}
            onDeleteVariant={deleteCustomVariant}
          />
        ) : (
          <button className="palette__item" onClick={handleAddDcsViewport}>
            + DCS viewport
          </button>
        ))}
      {groupCustomVariants.length > 0 && (
        <CustomVariantsButton variants={groupCustomVariants} onSelect={handleAddGroupVariant} onDelete={deleteCustomVariant} />
      )}
      <p className="palette__hint">Click a widget on the canvas to edit its label, keybind, and position in the properties panel.</p>
      <p className="palette__hint">
        Morph buttons: select one, then use the + handles on its edges to extend it into other base blocks — connected blocks act as
        one button. Hold Ctrl to remove instead.
      </p>
      <p className="palette__hint">
        Lines are a plain decorative bar — drag the handle to resize length (thickness is set in Properties), and use Rotation to angle
        it away from horizontal.
      </p>
      <p className="palette__hint">
        Gauges display a variable; Adjusters (slider/knob) drag to set one — see its Actions section in Properties for Press/Release/Move.
      </p>
      <p className="palette__hint">
        Encoders spin (drag in a circle) to fire Turn CW/CCW steps — good for DCS-BIOS INC/DEC knobs with no fixed range. Rocker/Dial
        switches have 2+ tappable positions, each with its own action — good for DCS-BIOS set-position controls (gear, mode
        selectors, ...). Which position looks active is local to each device unless you wire an "Active position" expression to a
        shared variable.
      </p>
      <p className="palette__hint">
        Toggle switches are Rocker's physical-lever cousin — always 2 (Top/Bottom) or 3 (Top/Middle/Bottom) positions, names fixed.
        Top/Bottom can be set Momentary (springs back to Middle on release on a 3-position switch, or to the other position on a
        2-position switch — only one of the two can be momentary there). Interaction mode picks Tap (tap a position directly) or Drag
        (press and drag toward a position, like Dial) — Momentary fires live in either mode, not just on release.
      </p>
      <p className="palette__hint">
        Dropdowns show only the active position until pressed and held, then fan the rest out above/below (or left/right) it — drag to
        the one you want and release to select it. Has its own Press/Release (fires on every hold) alongside each position's own action
        (fires only if you release on it).
      </p>
    </aside>
  )
}
