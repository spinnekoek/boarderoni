# TODO / known follow-ups

Running list of things we've spotted but deliberately deferred. Check items
off as they're fixed; add new ones as they come up.

## Editor UX

- [ ] Migrate the remaining plain `properties__code` textareas in
      `PropertiesPanel.tsx` to the CodeMirror-backed `CodeEditor` component
      (syntax highlighting, matches the update-state action code fix from
      2026-08-30). Remaining spots: gauge `valueExpr`, `rotateAngleExpr`
      (box + adjuster), tick set `labelTextExpr` (gauge + adjuster), and a
      few others — search for `className="properties__code"` in
      PropertiesPanel.tsx to find them all.
- [ ] Re-categorise the `PropertiesSection` breakdown across all widget
      types in `PropertiesPanel.tsx` — section names, grouping, and order
      are inconsistent per widget (e.g. "Style", "Style & Value", and
      "Appearance" all used for similar content; "Colors"/"Advanced"/
      "Rotation" show up in different orders/spots depending on widget
      type). Needs an actual pass to settle on a consistent set of section
      names and ordering, then apply it everywhere.
- [ ] Audit *every* fx/expression field app-wide (not just PropertiesPanel —
      also check any modal/settings panel) to confirm it uses `CodeEditor`,
      and extend the `action:log` console.log forwarding (added
      2026-08-30 for update-state/send-dcs-command/call-rest) to any other
      main-process-evaluated expression where it'd make sense. Two spots
      already identified that currently have no console.log path at all:
      the per-tick plugin field mapping expr in main/index.ts's plugin
      producer tick handler (~line 1767) and the REST incoming mapping expr
      in `applyRestIncoming` (~line 1630). Both fire continuously per tick,
      not per user action, so weigh whether logging there is actually
      useful (debug panel's groupSimilar dedup helps) vs. just noise.
      Same audit should confirm every renderer-evaluated fx field (colorExpr/
      borderColorExpr/textExpr/activeStateExpr/etc. — anything going through
      `tryEvaluateExpression` in a renderer, not main) reaches the debug
      panel's console.log sink too, unless it only ever runs server-side
      (main process, no debug panel to show it in).
- [ ] Number inputs with a `min` clamp fight typing a value that starts
      below the min — e.g. a width field with `min={minSize}` (10): typing
      "5" as the first digit of "50" gets clamped to 10 immediately (the
      field is controlled and clamps on every `onChange`), so the displayed
      value jumps to "10" and the next keystroke appends onto THAT instead
      of finishing "50". Root cause: `onChange={(e) => patch({ w:
      Math.max(minSize, Number(e.target.value)) })}`-style clamping in
      `PropertiesPanel.tsx` (56 occurrences of `Math.max(minSize, ...)` /
      `Math.max(1, ...)` in onChange handlers — not just w/h, also
      squareWidth/circleSize/action size/etc.). Fix likely means clamping
      on blur (or on the eventual patch commit) instead of on every
      keystroke, while still allowing an in-progress edit to hold an
      intermediate below-min value in the input's own local state.

## Event sources

- [x] Let a variable-mapping `expr` set other variables too, not just its own
      `mapping.variableName` — implemented (2026-09-07) in both
      `applyRestIncoming` and the plugin producer tick handler
      (`main/index.ts`): an expr returning a plain object now merges wholesale
      into the update batch (same convention as `runUpdateState`'s Update
      state action), while a scalar return still targets just
      `mapping.variableName` as before. `mapping.variableName` is now
      optional when the expr returns an object.

## Performance

- [ ] Investigate responsiveness slowdown when there are a lot of items —
      reported generally, not yet scoped to which "items" (widgets on
      canvas? variables? tick marks? event sources?) or where the slowdown
      shows up (editor only, or deployed view too). Needs reproduction with
      a large dashboard before diagnosing.

## Bugs

- [x] Android: switching decks via the 5-finger gesture modal doesn't show
      the deck list — fixed (2026-09-10). Root cause: the gesture actually
      opens `DeviceSettingsModal.tsx` (not `MobileAppModal.tsx`, which is
      just the editor's APK-install QR modal), whose "Change deck" button
      calls `disconnect()` in `store.ts`. `disconnect()` reset to the picker
      but never called `connectLobby()`, so if the app launched straight
      into a remembered deck (the common case), no lobby connection ever
      existed to deliver a `decks:list` message — same failure mode the
      `DECK_CLOSE_CODE_UNKNOWN` close handler already worked around.
      `disconnect()` now calls `get().connectLobby()` when `mode === 'view'`,
      matching that handler.
- [x] Properties panel's drag-to-resize handle only grabbed while the panel
      was scrolled to the top — fixed (2026-09-10). Split `.properties` into
      a non-scrolling outer `<aside>` (holds `resizeHandle`, pinned to the
      edge) and a new `.properties__scroll` inner div (holds everything
      else, scrolls independently) in `PropertiesPanel.tsx`/`styles.css`,
      applied across all 16 call sites.
- [ ] Device approval/remembering is flaky — sometimes an already-approved
      device isn't remembered and has to be re-approved. Not yet reproduced
      or scoped; likely area is `src/main/deviceApproval.ts` (device
      persistence) and how `approvedDevices`/`devices` get read back on
      reconnect (`store.ts`).

## Packaging (not yet started)

- [ ] When we eventually package boarderoni (electron-builder/forge, currently
      not set up at all — only `electron-vite` dev commands exist), set the
      Windows execution level to `requireAdministrator` in the packager
      config (e.g. electron-builder's `win.requestedExecutionLevel`). Reason:
      games like DCS that run elevated silently swallow synthetic keystrokes
      (`nut-js`/`SendInput` in `src/main/index.ts`) sent from a
      non-elevated boarderoni due to Windows UIPI — both processes need to be
      at the same integrity level for macros to reach the game.

## Data model

- [x] Split `GaugeWidget` into two separate widget types — implemented
      (2026-09-07): `BarGaugeWidget` (`type: 'gauge-bar'`)/`ArcGaugeWidget`
      (`type: 'gauge-arc'`) in `shared/types.ts`, each carrying only its own
      fields (no more shared `style: 'bar' | 'arc'` toggle). Migration in
      `main/index.ts` (`migrateGaugeWidget`) converts an old saved `type:
      'gauge'` + `style` into the right new type. Palette/PropertiesPanel/
      rendering/clipboard/style-copy all updated; `PROPERTIES_PANEL.md` has
      separate Bar Gauge/Arc Gauge entries.
- [x] Same split for `AdjusterWidget` — implemented (2026-09-07):
      `AdjusterSliderWidget` (`type: 'adjuster-slider'`)/`AdjusterKnobWidget`
      (`type: 'adjuster-knob'`, still `extends DialShapeStyle`) in
      `shared/types.ts`, no more shared `style: 'slider' | 'knob'` toggle.
      Migration in `main/index.ts` (`migrateAdjusterWidget`). Same touch
      points as the Gauge split above; `PROPERTIES_PANEL.md` has separate
      Slider/Knob entries.

## Features to investigate

- [ ] Design a deck at one resolution and have it scale down cleanly for
      other screen resolutions. `LetterboxedCanvas.tsx` already does uniform
      scale-to-fit for the deployed view, so this may partly already work —
      needs checking what actually breaks at other aspect ratios/DPIs (crisp
      lines/thin widgets are a known trouble spot at non-native scale, see
      the letterbox-thin-widgets note) and whether per-widget or
      per-resolution overrides are needed on top of straight scaling.
- [x] Widget grouping — implemented (2026-09-07): move-only groups via
      `groupId` on `WidgetVisibility`, group/ungroup from the canvas
      right-click menu, click-to-select-whole-group with re-click-to-drill-in.
      No group resize/bounding-box UI, per the original scope.
