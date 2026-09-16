# Boarderoni User Manual

This is the end-user guide — how to build and use dashboards. If you're
looking for the codebase layout or how to write a plugin, see
[CONTRIBUTING.md](CONTRIBUTING.md) instead. For a field-by-field reference
of every widget's properties panel, see
[PROPERTIES_PANEL.md](PROPERTIES_PANEL.md).

Screenshots below are placeholders (temporary stock images) until real ones
are captured from the app.

## Table of contents

1. [Getting started](#1-getting-started)
2. [Viewing a dashboard on another device](#2-viewing-a-dashboard-on-another-device)
3. [Decks](#3-decks)
4. [The editor](#4-the-editor)
5. [Widgets](#5-widgets)
6. [Styling](#6-styling)
7. [Actions & event sequences](#7-actions--event-sequences)
8. [Variables](#8-variables)
9. [Plugins & event sources](#9-plugins--event-sources)
10. [Devices & approval](#10-devices--approval)
11. [Settings](#11-settings)
12. [REST webhook targets (optional/advanced)](#12-rest-webhook-targets-optionaladvanced)
13. [DCS-BIOS setup (optional/advanced)](#13-dcs-bios-setup-optionaladvanced)
14. [Troubleshooting / FAQ](#14-troubleshooting--faq)

---

## 1. Getting started

Boarderoni is a desktop app (Windows only for now) with two roles:

- The **desktop app** is where you design dashboards — the editor.
- Any other device (a phone, tablet, or second PC) can **connect to a
  desktop deck** and use it as a physical control panel.

![Main editor window](images/getting-started-main-window.jpg)

When you launch Boarderoni for the first time, you'll land on the **deck
picker** (see [Decks](#3-decks)) since there's nothing to open yet. Create a
deck, and it opens straight into the editor.

### Device settings & the 5-finger gesture

Every connected device — including the desktop's own **deployed view**
(the live, full-screen, pressable rendering of a deck, as opposed to the
editor you design it in), and any phone/tablet — has its own small
settings panel: rename the device, toggle
"prevent screen timeout" on Android, force a refresh, or change which deck
it's showing.

To reach it:

- **Touchscreen**: press down with **5 fingers at once**, anywhere on the
  screen.
- **Desktop browser** (no touchscreen): press **Ctrl+I** (or **Cmd+I** on
  Mac).

![Device settings modal](https://placedog.net/700/400?id=2)

This works both while a deck is open and from the deck-list screen itself.

## 2. Viewing a dashboard on another device

You don't need the Android app to use Boarderoni from a phone or tablet —
**any device with a modern browser on the same local network** can open a
deck. The desktop app shows you a URL (and, for the deployed view, a QR
code) to open on the other device.

![Phone browser showing a deck](https://placedog.net/700/400?id=3)

The **Android app** exists to make this more convenient, not because it's
required:

- It auto-discovers the desktop on your network (no typing an IP address).
- It reconnects automatically and remembers the last deck you had open.
- It's a paid download, which is one way to support ongoing development if
  you find Boarderoni useful.

If you'd rather not use it, a kiosk-style browser app (for example, **Fully
Kiosk Browser** on Android) pointed at the same URL works just as well —
you'll just need to type in the address yourself and set up your own
full-screen/keep-awake preferences, which the dedicated app otherwise
handles for you.

## 3. Decks

A **deck** is one dashboard — its own set of widgets, variables, and
plugins. You can have as many as you like.

![Deck picker](https://placedog.net/700/400?id=4)

From the deck picker you can:

- **Create** a new, empty deck.
- **Rename** an existing deck.
- **Export** a deck to a `.boarderoni` file (includes its background
  image, if any) and **import** one back — handy for backups or moving a
  deck to another machine. Importing warns you about anything that won't
  carry over cleanly (e.g. a REST webhook target or screen-capture region
  that only existed on the original machine).
- **Delete** a deck (this cannot be undone).

## 4. The editor

![Editor layout](https://placedog.net/700/400?id=5)

The editor has three main areas:

- **Palette** (left) — every widget type, plus any custom variants and
  built-in aircraft-panel presets you've saved. Click a widget to add it to
  the canvas.
- **Canvas** (center) — drag, resize, and rotate widgets. Multi-select with
  a marquee drag or Shift-click; right-click for a context menu (duplicate,
  group, save as variant, bring to front/back, ...). Snap-to-grid and grid
  size are both configurable.
- **Properties panel** (right) — every field for whatever's currently
  selected. Nothing is selected shows the deck's own background/canvas
  settings instead.

Undo/redo (Ctrl+Z / Ctrl+Y) covers essentially every edit. A debug console
along the bottom shows live output from any expression's `console.log`
calls, grouped so a fast-repeating one doesn't flood the panel.

## 5. Widgets

Boarderoni ships 15 widget types:

- **Button** / **Morph Button** — press/release actions, with independent
  Default/Clicked visual states.
- **Bar Gauge** / **Arc Gauge** — read-only value display.
- **Adjuster Slider** / **Adjuster Knob** — draggable value control.
- **Encoder** — an infinite-turn knob (turn CW/turn CCW actions instead of
  a fixed range).
- **Rocker Switch** / **Dial Switch** / **Toggle Switch** — multi-position
  switches, each position independently colored/labeled/actioned.
- **Dropdown** — a switch's positions, shown as a picker instead of laid
  out physically.
- **Screen Capture** — streams or polls a region of the desktop's own
  screen.
- **DCS Viewport** — routes a DCS World cockpit display (an MFCD, for
  example) to this widget.
- **Label** — static or expression-driven text.
- **Line** — a plain divider/decoration.

Every widget's full field list is documented in
[PROPERTIES_PANEL.md](PROPERTIES_PANEL.md).

## 6. Styling

- **Colors** — every color field can be a flat value or a small expression
  (click the **ƒx** button next to it) that reads live [variables](#8-variables)
  and returns a color.
- **Fonts** — a set of built-in fonts, plus your own uploaded custom fonts
  (Settings → Custom fonts).
- **Copy style** — right-click a widget → **Copy style**, then right-click
  another widget of the **same type** → **Paste style**. This carries
  colors, borders, fonts, and (for switches) per-position/per-state
  styling — matched by each state/position's **name**, not its position in
  the list, so renaming or reordering states doesn't scramble which style
  lands where. It never copies position/size, wiring, or variable bindings.
- **Custom variants** — right-click a widget (or a multi-selection) →
  **Save as variant** to add it to the palette as a reusable preset,
  alongside the built-in aircraft-panel-style presets.

![Copy style menu](https://placedog.net/700/400?id=6)

## 7. Actions & event sequences

Every button, switch position, and dropdown option can run a **sequence**
of steps when triggered (press, release, double-press, triple-press, or a
position/value change, depending on the widget).

![Event sequence editor](https://placedog.net/700/400?id=7)

A step is one of:

- **Action** — the actual thing that happens. Kinds include: Keypress,
  Update state (run a small script that sets one or more variables),
  Navigate to screen / Open overlay / Close overlay (see sub-decks below),
  and whatever plugin-specific actions you have enabled (Send DCS command,
  Set Windows Audio, Call REST — see [Plugins](#9-plugins--event-sources)).
- **Delay** — pause for a fixed number of milliseconds before the next
  step.
- **Condition** — an expression; branches into its own "if true"/"if
  false" sub-sequences.

Steps can be reordered by drag, and a whole sequence can be recorded live
(press a key, and Boarderoni turns it into the right Keypress step) instead
of built by hand.

## 8. Variables

**Variables** are Boarderoni's live shared state — a named value any
widget's expressions, or any action, can read or write. They're created
automatically the first time something writes to them (a plugin's mapping,
an Update State action, an incoming REST field) — there's no separate
"declare a variable" step.

Anywhere you see an **ƒx** button, you're writing a small JavaScript
function body with every current variable available as `variables.NAME`.
For example:

```js
return variables.THROTTLE > 0.9 ? '#e05252' : '#3a3f4a';
```

The Variables panel (Toolbar) lists every variable currently in the deck
and its live value — useful for checking what a plugin or action is
actually producing.

## 9. Plugins & event sources

A **plugin** is a data source (and sometimes an action) you add to a deck.
Each kind is toggled on/off app-wide in [Settings](#11-settings); once
enabled, add an instance of it from the deck's **Event Sources** panel.

![Event sources modal](https://placedog.net/700/400?id=8)

- **Date & Time** — clock/calendar fields for labels and expressions.
- **Random** — a random-number generator, mainly useful as a template for
  writing your own plugin.
- **REST Data Sources** — Boarderoni runs a small HTTP listener; anything
  POSTed to it (with the right bearer token) maps into this deck's
  variables. Good for pulling data in from an external script, tool, or
  webhook.
- **DCS-BIOS** — reads (and, via a button's Send DCS command action,
  writes) live DCS World cockpit state. See [DCS-BIOS setup](#13-dcs-bios-setup-optionaladvanced).
- **Windows Audio** — read and control system/per-application volume and
  mute.
- **Screen Capture (+ OCR)** — stream or poll a screen region, optionally
  reading text/numbers out of it.
- **DCS Viewports** — exports DCS cockpit displays (MFCDs, etc.) to their
  own monitor/window, for a Boarderoni DCS Viewport widget to show.

Each plugin instance's own field(s) get mapped into named variables from
its Event Sources entry — the same "field → variable" mapping shape every
plugin kind shares, with an optional expression to transform the raw value
first.

## 10. Devices & approval

Any device that connects to a deck (other than the desktop editor itself,
which is always trusted) needs to be **approved** the first time, so a
random device on your network can't just watch or control your dashboard.

![Approval banner](https://placedog.net/700/400?id=9)

- A pending device shows a banner in the editor — **Approve** or **Deny**
  it there.
- Approved devices can be renamed (or from the device's own [5-finger
  settings](#1-getting-started)) and revoked later from the same list.

## 11. Settings

![Settings modal](https://placedog.net/700/400?id=10)

- **Plugins** — enable/disable each plugin kind app-wide. Disabling one
  stops its data/actions everywhere, including any widget already using it
  (it just goes inert rather than breaking).
- **Custom fonts** — upload your own fonts for use anywhere a font picker
  appears.
- Kind-specific settings live here too where they apply (DCS-BIOS's docs
  folder and multicast address, DCS Viewports' install paths, REST Data
  Sources' and REST Webhook Targets' own lists).

## 12. REST webhook targets (optional/advanced)

*Skip this section unless you specifically want a button to call an
external HTTP API.*

A **REST webhook target** (Settings → REST Webhook Targets) is a named,
reusable outgoing HTTP request: a method (GET/POST/PUT/PATCH/DELETE), a
URL, optional headers, and — for anything but GET — a payload template.
A button's **Call REST** action picks one by name and fills in a value (or
expression) for each `{{placeholder}}` token found in the template or
headers.

Templates are a **plain text substitution** — write the exact text you
want sent, `{{name}}` and all, quotes included:

```
{"speed": {{speed}}, "label": "{{label}}"}
```

If `speed` resolves to `250` and `label` to `Cruise`, the request body
becomes `{"speed": 250, "label": "Cruise"}`. There's no validation beyond
that — a malformed result is sent exactly as constructed, so double-check
your quoting.

## 13. DCS-BIOS setup (optional/advanced)

*Skip this section unless you're building a DCS World cockpit panel.*

DCS-BIOS reads and writes DCS World's own cockpit state over UDP. To use
it:

1. Install the [DCS-BIOS](https://github.com/DCS-Skunkworks/dcs-bios) Lua
   export scripts into your DCS `Scripts\Export.lua`, if you haven't
   already (DCS-BIOS's own installer/docs cover this).
2. In Boarderoni's Settings, point DCS-BIOS at that installation's `doc`
   folder (used to build the per-aircraft command/field catalog) and set
   the multicast address/port to match your `Export.lua` config.
3. Add a **DCS-BIOS** event source to a deck to map cockpit fields into
   variables, or use a button's **Send DCS command** action to write to
   one (flip a switch, push a button, etc.) — both pick from the same
   per-aircraft catalog, searchable by name.

## 14. Troubleshooting / FAQ

- **A device won't connect** — check it's on the same local network as the
  desktop, and that it's been approved (see [Devices & approval](#10-devices--approval)).
- **An action silently does nothing** — check the debug console at the
  bottom of the editor; most action failures (a disabled plugin, a deleted
  REST target, a bad expression) show up there as a toast and a logged
  error.
- **A plugin's fields aren't available** — confirm that plugin kind is
  enabled in Settings.
- **I changed something and it's not showing up on a connected device** —
  changes normally sync live over the network; a stuck device usually just
  needs the app restarted or the deck reopened.
