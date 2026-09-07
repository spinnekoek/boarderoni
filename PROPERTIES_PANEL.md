# Properties Panel — Full Field Structure

Source: `src/renderer/src/components/PropertiesPanel.tsx`

Names only — no values, placeholders, or descriptions. Every top-level bullet is one widget type; nested bullets mirror the actual rendered JSX nesting (PropertiesSection → field/group → sub-field).

**Note on shared structures.** A few field groups are rendered by the exact same helper component at many different call sites, with identical field names every time (only the surrounding title/hint text differs, which is excluded per the "names only" scope). Rather than re-print an identical multi-level tree dozens of times, they're spelled out once below and referenced by name (`→ Label fields`, `→ Action step`, `→ Tick set fields`) everywhere they're used. This is the one place I collapsed literal repetition — flagged here for visibility.

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

### → Switch positions editor (`SwitchPositionsEditor` — used by Rocker switch, Toggle switch, Dial switch, Dropdown)
- **Positions**
  - Positions *(reorderable tabs list, plus an active-position expression toggle)*
    - Expression *(when the active-position expression toggle is on)*
  - Position name *(Rocker switch / Dial switch / Dropdown only — Toggle switch's position names are fixed and this field is hidden)*
  - Color
    - Unselected color
    - Selected color
  - Labels
    - one entry per position label → Label fields
- **Actions**
  - one entry per widget-level root event (name/count varies per widget — see that widget's own Actions list below)
  - one entry per position, named after the position → Action step list

## Label

- **Label**
  - → Label fields *(no Remove control — a Label widget's single label can't be removed independently of the widget)*
- **Advanced**
  - Position & Size
    - X, Y, W, H
  - Z-index
  - Visible

## Line

- **Appearance**
  - Color
  - Line width
- **Rotation**
  - Rotate angle
  - Expression *(when Rotate angle's ƒx toggle is on)*
- **Advanced**
  - Position & Size
    - X, Y, Length (W), Box height (H)
  - Z-index
  - Visible

## Gauge

- **Style & Value**
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
- **Indicator** *(Arc style only)*
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
- **Position & Size**
  - X, Y, W, H
  - Z-index
  - Visible

## Adjuster

- **Style & Value**
  - Style
  - Orientation *(Slider style only)*
  - Start angle, End angle *(Knob style only)*
  - Min, Max
  - Rest value (optional)
- **Rotation**
  - Rotate angle
  - Expression *(when the ƒx toggle is on)*
- **Colors**
  - Fill color
  - Track color
  - Border color
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
- **Border shape**
  - *(Slider style only):*
    - Border radius *(Top left / Top right / Bottom left / Bottom right grid)*
    - Border thickness *(Top / Right / Bottom / Left grid)*
- **Ticks** *(Knob style only)*
  - one entry per tick set → Tick set fields
- **Actions** *(badge 5)*
  - Press → Action step list
  - Release → Action step list
  - Double press → Action step list
  - Triple press → Action step list
  - Move (while dragging) → Action step list
- **Labels**
  - one entry per label → Label fields
- **Position & Size**
  - X, Y, W, H
  - Z-index
  - Visible

## Encoder

- **Step**
  - Degrees per step
  - Rest value (optional)
- → Dial shape fields
- **Colors**
  - Dial face color
  - Border color
- **Ticks**
  - one entry per tick set → Tick set fields *(Show value labels and its sub-fields never appear for Encoder tick sets)*
- **Actions** *(badge 6)*
  - Press → Action step list
  - Release → Action step list
  - Double press → Action step list
  - Triple press → Action step list
  - Turn CW (increment) → Action step list
  - Turn CCW (decrement) → Action step list
- **Labels**
  - one entry per label → Label fields
- **Position & Size**
  - X, Y, W, H
  - Z-index
  - Visible

## Rocker Switch

- **Style**
  - Orientation
  - Rotate angle
  - Expression *(when the ƒx toggle is on)*
  - Settle to inactive *(checkbox)*
- **Colors**
  - Base color
  - Border color
  - Border radius *(Top left / Top right / Bottom left / Bottom right grid)*
  - Border thickness *(Top / Right / Bottom / Left grid)*
- → Switch positions editor
  - Actions' root events for this widget: Press, Release, Position Change, and (only when Settle to inactive is on) Inactive
- **Labels** *(widget-level, separate from each position's own labels)*
  - one entry per label → Label fields
- **Advanced**
  - Position & Size
    - X, Y, W, H
  - Z-index
  - Visible

## Toggle Switch

- **Style**
  - Orientation
  - Base shape
  - Base circle size
  - Base rotation *(Hexagon base shape only)*
  - Interaction
  - *(Drag interaction only):*
    - Fire while dragging *(checkbox)*
- **Rotation**
  - Rotate angle
  - Expression *(when the ƒx toggle is on)*
- **Momentary** *(only shown for a 2- or 3-position switch)*
  - one checkbox per non-middle position, labeled with that position's own name
- **Colors**
  - Base color
  - Lever color
  - Border color
  - Border width
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
- → Switch positions editor *(Position name hidden; per-position labels shown with Label anchor/Label distance)*
  - Actions' root events for this widget: Press, Release, Position Change, and (only when the guard is enabled) Guard Press
- **Labels** *(widget-level, separate from each position's own labels)*
  - one entry per label → Label fields
- **Advanced**
  - Position & Size
    - X, Y, W, H
  - Z-index
  - Visible

## Dial Switch

- **Style**
  - Start angle, End angle
  - Interaction
  - *(Drag interaction only):*
    - Fire while dragging *(checkbox)*
    - Wait for state to confirm *(checkbox)*
  - Detents
    - → Detent shape editor
    - Detent distance
  - → Dial shape fields
- **Rotation**
  - Rotate angle
  - Expression *(when the ƒx toggle is on)*
- **Colors**
  - Dial face color
  - Border color
- → Switch positions editor *(per-position labels shown with Label anchor/Label distance)*
  - Actions' root events for this widget: Press, Release, Position Change, Turn CW (increment), Turn CCW (decrement), Double press, Triple press
- **Labels** *(widget-level, separate from each position's own labels)*
  - one entry per label → Label fields
- **Advanced**
  - Position & Size
    - X, Y, W, H
  - Z-index
  - Visible

## Dropdown

- **Style**
  - Expand mode
  - Orientation
- **Colors**
  - Base color
  - Border color
  - Border radius *(Top left / Top right / Bottom left / Bottom right grid)*
  - Border thickness *(Top / Right / Bottom / Left grid)*
- → Switch positions editor *(no separate widget-level Labels section exists for this widget)*
  - Actions' root events for this widget: Press, Release, Position Change
- **Advanced**
  - Position & Size
    - X, Y, W, H
  - Z-index
  - Visible

## Screen Capture

- **Region**
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
- **Advanced**
  - Position & Size
    - X, Y, W, H
  - Z-index
  - Visible

## DCS Viewport

- **Component**
  - Aircraft
  - Component
- **Crop**
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
- **Advanced**
  - Position & Size
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
- **Actions** *(badge 2)*
  - Press → Action step list
  - Release → Action step list
  - Double press → Action step list
  - Triple press → Action step list
- **Position & Size**
  - X, Y, W, H
  - Rotate angle
  - Expression *(when the ƒx toggle is on)*
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
- **Actions** *(badge 2, or 3 once the slider is enabled and active)*
  - Press → Action step list
  - Release → Action step list
  - Move (while dragging) → Action step list *(only once the slider is enabled and active)*
- **Position & Size**
  - X, Y
  - Cell W, Cell H
  - Z-index *(Auto / manual toggle)*
  - Visible
