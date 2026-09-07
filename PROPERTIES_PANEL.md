# Properties Panel — Full Field Structure

Source: `src/renderer/src/components/PropertiesPanel.tsx`

## Canonical section order

Every widget branch uses this same top-level section order, skipping
sections that don't apply — never reordered, never renamed per-widget:

1. **Setup** — the widget's core identity/value fields.
2. **Shape** — visual construction beyond color: Dial shape, Detents,
   Handle, Base circle, Inner circle, Lever, Safety guard, Momentary, Crop.
3. **Colors** — color fields only.
4. **Border shape** — radius/thickness grids, always separate from Colors.
5. **Ticks**
6. **Rotation** — always its own section (including Button/Morph).
7. **Positions** — switch-type widgets only: position list/names/colors,
   no actions mixed in.
8. **Labels** — widget-level labels. Per-position labels are titled
   **"Position labels"** so the word "Labels" never means two different
   things on one panel.
9. **Actions** — always its own top-level section on every widget that has
   one, including switch widgets (previously buried inside "Switch
   positions editor"). The badge shows two separate numbers (events vs.
   positions) instead of one combined total.
10. **Layout** — X, Y, W/H (or Cell W/H), Z-index, Visible. No Rotate angle
    here (see #6).

Screen Capture's "Region" and DCS Viewport's "Component" are both
**"Source"**; DCS Viewport's Crop fields are a sub-group inside Source
rather than their own top-level section. Adjuster's Setup-section Style
field (Slider/Knob) is visible near the top of the panel since Setup is
section 1.

**Deviation note:** the spec called for Button/Morph's folded-in "Rotate
angle" to split into its own Rotation section "for those two widgets" —
implemented for Button, but MorphWidget has no `rotateAngle`/
`rotateAngleExpr` fields in `shared/types.ts` at all (Morph's own
"Position & Size" doc entry below never listed one either), so there was
nothing to move for Morph. No Rotation section is rendered for Morph.

## Note on shared structures

A few field groups are rendered by the exact same helper component at many
different call sites, with identical field names every time (only the
surrounding title/hint text differs). They're spelled out once below and
referenced by name (`→ Label fields`, `→ Action step`, `→ Tick set fields`)
everywhere they're used.

## Appendix: shared field groups

### → Label fields (`LabelFields`)
- Text
- Font
- Font size
- Padding
- Offset X
- Offset Y
- Rotation
- Text color
- Background color
- Align
- Text align
- Label anchor *(dial switch positions only)*
- Label distance *(dial switch positions only)*

### → Action step (one entry in any reorderable action-sequence list — `EventSequenceEditor` / `SequenceStepFields` / `ActionFields`)
Each sequence (Press, Release, Position Change, Turn CW, Move, etc.) is an ordered list of steps. Each step is one of:
- **Action step**
  - Action *(kind selector: No action / Keypress / Update state / Send DCS command / Navigate to screen / Open overlay / Close overlay / Call ‹REST data source name›, one option per enabled source)*
    - *Keypress:* Keys, Mode
    - *Update state:* Code
    - *Send DCS command:* Aircraft, Command, Value, Expression
    - *Navigate to screen:* Target screen
    - *Open overlay:* Target screen, Anchor edge, Size
    - *Close overlay:* (no further fields)
    - *Call ‹REST source›:* one row per template placeholder, each row labeled with that placeholder's own name
- **Delay step**
  - Delay (ms)
- **Condition step**
  - Condition
  - If true → nested list of steps (same three kinds, recursively)
  - If false → nested list of steps (same three kinds, recursively)

### → Tick set fields (one entry under a "Ticks" section — Gauge/arc, Adjuster/knob, Encoder)
- Count
- Distance from center
- Size
- Thickness
- Color
- Border color
- Border width
- Show value labels *(checkbox — Encoder's tick sets omit this and everything below it)*
  - Label font
  - Label font size
  - Label decimals
  - Label start
  - Label end
  - Label color
  - Label distance
  - Label expression (optional)

### → Detent shape editor (`DetentShapeEditor`)
- Shape
- *(if Shape ≠ None):*
  - Width
  - Height
  - *(square shape with per-side border grid available — only the Indicator sub-use below):*
    - Border width *(Top / Right / Bottom / Left grid)*
    - Border radius *(Top left / Top right / Bottom left / Bottom right grid)*
    - Border color
  - *(otherwise):*
    - Border width
    - Border radius *(hidden when Shape = Circle)*
    - Border color

### → Dial shape fields (`DialShapeFields` — used by Encoder, Dial switch, Adjuster/knob)
Rendered as its own "Dial shape" (+ "Indicator") section(s), un-wrapped —
called directly at the Shape slot in each widget's render order rather
than nested inside another titled section.
- **Dial shape**
  - Shape
  - Distance from center *(Square/Circle shape only)*
  - Needle color *(Needle shape only)*
  - Square width, Square height, Square border width, Square border radius, Square color, Square border color *(Square shape only)*
  - Circle size, Circle border width, Circle color, Circle border color, Indent count, Indent size, Indent distance, Indent shape, Indent color *(Circle shape only)*
- **Indicator** *(only shown when Dial shape = Square or Circle)*
  - → Detent shape editor
  - Indicator color
  - Indicator distance

### → Switch positions editor (`SwitchPositionsEditor` + `SwitchActionsSection` — used by Rocker switch, Toggle switch, Dial switch, Dropdown)
Split into two components so each call site can place Positions at slot 7
and Actions at slot 9 in the canonical order, instead of both living
together inside one "Switch positions editor" wrapper.

- **Positions** (`SwitchPositionsEditor`)
  - Positions *(reorderable tabs list, plus an active-position expression toggle)*
    - Expression *(when the active-position expression toggle is on)*
  - Position name *(Rocker switch / Dial switch / Dropdown only — Toggle switch's position names are fixed and this field is hidden)*
  - Color
    - Unselected color
    - Selected color
  - Position labels
    - one entry per position label → Label fields
- **Actions** (`SwitchActionsSection`, badge is `"N events · M positions"` — two legible numbers instead of one summed total)
  - one entry per widget-level root event (name/count varies per widget — see that widget's own Actions list below)
  - one entry per position, named after the position → Action step list

## Label

- **Label**
  - → Label fields *(no Remove control — a Label widget's single label can't be removed independently of the widget)*
- **Layout**
  - Position & Size
    - X, Y, W, H
  - Z-index
  - Visible

## Line

- **Appearance** *(Setup + Colors combined — Line has no separately named Setup/Colors split; not called out as a restructuring target)*
  - Color
  - Line width
- **Rotation**
  - Rotate angle
  - Expression *(when Rotate angle's ƒx toggle is on)*
- **Layout**
  - Position & Size
    - X, Y, Length (W), Box height (H)
  - Z-index
  - Visible

## Gauge

- **Setup**
  - Style
  - Orientation *(Bar style only)*
  - Start angle, End angle *(Arc style only)*
  - Min, Max
  - Value
- **Colors**
  - Background color
  - Fill color
  - Track color
  - Border color *(Bar style only)*
- **Border shape**
  - *(Bar style only)*
    - Border radius *(Top left / Top right / Bottom left / Bottom right grid)*
    - Border thickness *(Top / Right / Bottom / Left grid)*
- **Ticks** *(Arc style only)*
  - one entry per tick set → Tick set fields
- **Indicator** *(Arc style only — not part of the canonical list; left in its existing position between Ticks and Labels)*
  - Show needle indicator *(checkbox, with an expression toggle)*
  - Expression *(when the expression toggle is on)*
  - *(when the indicator is shown, fixed or via expression):*
    - Shape
    - Indicator color
    - Starts at, Ends at
    - Width
    - Center circle
      - Size, Border width
      - Color, Border color
- **Labels**
  - one entry per label → Label fields
- **Layout**
  - X, Y, W, H
  - Z-index
  - Visible

## Adjuster

- **Setup**
  - Style
  - Orientation *(Slider style only)*
  - Start angle, End angle *(Knob style only)*
  - Min, Max
  - Rest value (optional)
- **Handle** *(Slider style only)*
  - Shape
  - *(when Shape ≠ None):*
    - Size
    - Color
    - Border width
    - Border color
- **Base circle** *(Knob style only)*
  - Base circle size
  - Base circle color
  - Base circle border width
- **Inner circle** *(Knob style only)*
  - Inner circle size
  - Inner circle color
  - Inner circle border width
  - Inner circle border color
- *(Knob style only)* → Dial shape fields
- **Colors**
  - Fill color
  - Track color
  - Border color
- **Border shape**
  - *(Slider style only):*
    - Border radius *(Top left / Top right / Bottom left / Bottom right grid)*
    - Border thickness *(Top / Right / Bottom / Left grid)*
- **Ticks** *(Knob style only)*
  - one entry per tick set → Tick set fields
- **Rotation**
  - Rotate angle
  - Expression *(when the ƒx toggle is on)*
- **Labels**
  - one entry per label → Label fields
- **Actions** *(badge 5)*
  - Press → Action step list
  - Release → Action step list
  - Double press → Action step list
  - Triple press → Action step list
  - Move (while dragging) → Action step list
- **Layout**
  - X, Y, W, H
  - Z-index
  - Visible

## Encoder

- **Setup**
  - Degrees per step
  - Rest value (optional)
- → Dial shape fields
- **Colors**
  - Dial face color
  - Border color
- **Ticks**
  - one entry per tick set → Tick set fields *(Show value labels and its sub-fields never appear for Encoder tick sets)*
- **Labels**
  - one entry per label → Label fields
- **Actions** *(badge 6)*
  - Press → Action step list
  - Release → Action step list
  - Double press → Action step list
  - Triple press → Action step list
  - Turn CW (increment) → Action step list
  - Turn CCW (decrement) → Action step list
- **Layout**
  - X, Y, W, H
  - Z-index
  - Visible

## Rocker Switch

- **Setup**
  - Orientation
  - Settle to inactive *(checkbox)*
- **Colors**
  - Base color
  - Border color
- **Border shape**
  - Border radius *(Top left / Top right / Bottom left / Bottom right grid)*
  - Border thickness *(Top / Right / Bottom / Left grid)*
- **Rotation**
  - Rotate angle
  - Expression *(when the ƒx toggle is on)*
- → Switch positions editor's Positions
- **Labels** *(widget-level, separate from each position's own labels)*
  - one entry per label → Label fields
- → Switch positions editor's Actions
  - root events for this widget: Press, Release, Position Change, and (only when Settle to inactive is on) Inactive
- **Layout**
  - X, Y, W, H
  - Z-index
  - Visible

## Toggle Switch

- **Setup**
  - Interaction
  - *(Drag interaction only):*
    - Fire while dragging *(checkbox)*
- **Shape**
  - Orientation
  - Base shape
  - Base circle size
  - Base rotation *(Hexagon base shape only)*
- **Momentary** *(only shown for a 2- or 3-position switch)*
  - one checkbox per non-middle position, labeled with that position's own name
- **Inner circle**
  - Inner circle size
  - Inner circle color
  - Inner circle border width
  - Inner circle border color
- **Lever**
  - Lever shape
  - Lever length
  - Lever tip size
  - Circle top style
  - Lever base size
  - Lever border width
  - Lever border color
  - *(Bar lever shape only):*
    - Bar
      - Width, Height
      - Color
      - Border width, Border radius
      - Border color
- **Circle (middle position)** *(only shown for a 3-position switch)*
  - Circle size
  - Circle color
  - Circle border width
  - Circle border color
- **Safety guard**
  - Enabled *(checkbox)*
  - *(when enabled):*
    - Cover color
    - Border color
    - Border width
    - Corner radius
    - Size
      - W, H
    - Position from top
    - Open tab
      - Height
      - Position from top
    - Open when *(local-tap / expression toggle)*
    - Expression *(when the expression toggle is on)*
- **Colors**
  - Base color
  - Lever color
  - Border color
  - Border width
- **Rotation**
  - Rotate angle
  - Expression *(when the ƒx toggle is on)*
- → Switch positions editor's Positions *(Position name hidden; per-position labels shown with Label anchor/Label distance)*
- **Labels** *(widget-level, separate from each position's own labels)*
  - one entry per label → Label fields
- → Switch positions editor's Actions
  - root events for this widget: Press, Release, Position Change, and (only when the guard is enabled) Guard Press
- **Layout**
  - X, Y, W, H
  - Z-index
  - Visible

## Dial Switch

- **Setup**
  - Start angle, End angle
  - Interaction
  - *(Drag interaction only):*
    - Fire while dragging *(checkbox)*
    - Wait for state to confirm *(checkbox)*
- **Detents**
  - → Detent shape editor
  - Detent distance
- → Dial shape fields
- **Colors**
  - Dial face color
  - Border color
- **Rotation**
  - Rotate angle
  - Expression *(when the ƒx toggle is on)*
- → Switch positions editor's Positions *(per-position labels shown with Label anchor/Label distance)*
- **Labels** *(widget-level, separate from each position's own labels)*
  - one entry per label → Label fields
- → Switch positions editor's Actions
  - root events for this widget: Press, Release, Position Change, Turn CW (increment), Turn CCW (decrement), Double press, Triple press
- **Layout**
  - X, Y, W, H
  - Z-index
  - Visible

## Dropdown

- **Setup**
  - Expand mode
  - Orientation
- **Colors**
  - Base color
  - Border color
- **Border shape**
  - Border radius *(Top left / Top right / Bottom left / Bottom right grid)*
  - Border thickness *(Top / Right / Bottom / Left grid)*
- → Switch positions editor's Positions
- → Switch positions editor's Actions *(no separate widget-level Labels section exists for this widget)*
  - root events for this widget: Press, Release, Position Change
- **Layout**
  - X, Y, W, H
  - Z-index
  - Visible

## Screen Capture

- **Source**
  - Monitor
- **Stream**
  - Mode
  - FPS
  - Quality
- **Fit**
  - Fit
- **Adjustments**
  - Brightness
  - Contrast
  - Saturation
  - Sharpen *(checkbox)*
- **Border**
  - Border color
- **Layout**
  - X, Y, W, H
  - Z-index
  - Visible

## DCS Viewport

- **Source**
  - Aircraft
  - Component
  - Crop *(sub-group, was its own top-level "Crop" section)*
    - Top, Right, Bottom, Left
- **Stream**
  - Mode
  - FPS
  - Quality
  - Tap to start streaming *(checkbox)*
- **Fit**
  - Fit
- **Adjustments**
  - Brightness
  - Contrast
  - Saturation
  - Sharpen *(checkbox)*
- **Border**
  - Border color
  - Border width
- **Layout**
  - X, Y, W, H
  - Z-index
  - Visible

## Button

- **States**
  - Enable states *(checkbox)*
  - *(when enabled):*
    - States *(reorderable tabs list, plus an active-state expression toggle)*
    - Expression *(when the active-state expression toggle is on)*
    - State name
- **Labels**
  - one entry per label → Label fields
- **Color**
  - Color
  - Border color
  - Glow color
- **Appearance**
  - Spacing *(Top / Right / Bottom / Left grid)*
  - Border radius *(Top left / Top right / Bottom left / Bottom right grid)*
  - Border thickness *(Top / Right / Bottom / Left grid)*
- **Rotation**
  - Rotate angle
  - Expression *(when the ƒx toggle is on)*
- **Actions** *(badge 2)*
  - Press → Action step list
  - Release → Action step list
  - Double press → Action step list
  - Triple press → Action step list
- **Layout**
  - X, Y, W, H
  - Z-index *(Auto / manual toggle)*
  - Visible

## Morph Button

- **States**
  - Enable states *(checkbox)*
  - *(when enabled):*
    - States *(reorderable tabs list, plus an active-state expression toggle)*
    - Expression *(when the active-state expression toggle is on)*
    - State name
- **Labels**
  - one entry per label → Label fields
- **Color**
  - *(when no base block is selected on the canvas — same fields as Button, applied as the widget-wide default every block inherits):*
    - Color
    - Border color
    - Glow color
  - *(when a base block is selected, this section shows no fields of its own — editing moves to Appearance below)*
- **Appearance**
  - *(when a base block is selected):*
    - Auto fit *(checkbox)*
    - Color
      - Color
      - Border color
    - Spacing *(Top / Right / Bottom / Left grid)*
    - Border radius *(Top left / Top right / Bottom left / Bottom right grid)*
    - Border thickness *(Top / Right / Bottom / Left grid)*
  - *(when no block is selected, this section shows no fields)*
- **Slider**
  - Enable slider *(checkbox)*
  - Rest value (optional) *(only shown once the slider is enabled)*
- *(no Rotation section — MorphWidget has no rotateAngle/rotateAngleExpr fields at all; nothing to move out of Layout)*
- **Actions** *(badge 2, or 3 once the slider is enabled and active)*
  - Press → Action step list
  - Release → Action step list
  - Move (while dragging) → Action step list *(only once the slider is enabled and active)*
- **Layout**
  - X, Y
  - Cell W, Cell H
  - Z-index *(Auto / manual toggle)*
  - Visible
