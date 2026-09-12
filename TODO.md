# TODO / known follow-ups

Running list of things we've spotted but deliberately deferred. Check items
off as they're fixed; add new ones as they come up.

## Editor UX

- [ ] Make the "Edit expression" modal (`ExpressionEditorModal.tsx`,
      `.expr-modal`) resizable — currently a fixed-size overlay, which gets
      cramped for a longer expression. Properties panel's own drag-to-resize
      handle (`.properties__scroll` split, see the resize-handle bug fixed
      2026-09-10) is the closest existing precedent for a resize
      interaction in this codebase, though this is a centered modal rather
      than a docked panel so the handle placement/logic won't carry over
      directly.
- [ ] Bug: a rotated widget's selection box (the `.canvas-widget--selected`
      glint ring) doesn't rotate along with it. `CanvasWidget.tsx`'s own
      outer wrapper only applies a rotation transform for `LineWidget`
      (`lineRotateAngle`, line 208) — every other rotate-capable widget
      (Button, ToggleSwitch, DialSwitch, AdjusterKnob, ...) applies its own
      `rotateAngle`/`rotateAngleExpr` transform somewhere inside its own
      content renderer, deeper than the outer wrapper the selection ring is
      drawn on — so the visible widget spins but the selection box drawn
      around it stays axis-aligned. Fix likely means hoisting the rotation
      transform (or at least mirroring its value) up to the same outer
      `.canvas-widget` wrapper for every rotatable type, not just lines.
- [ ] Collapsible event sources. `EventSourcesModal.tsx` currently shows one
      source at a time via tabs (`activeSourceId`/`events-modal__tab`), which
      already avoids a long flat list — but wasn't scoped further than that
      when this was noted, so it's not clear yet whether "collapsible" means
      the tab strip itself (once there are many sources), the field-mapping
      list within one source's own panel, or both. Needs an actual look at
      what's getting unwieldy before picking an approach.
- [ ] On deck import, check whether every custom font id (`fontFamily:
      "custom:<id>"`, see `isCustomFontId`/`CUSTOM_FONT_PREFIX` in
      `shared/fonts.ts`) referenced by the imported deck's widgets/labels is
      actually present in this install's custom font list (see
      `main/customFonts.ts`, `FontsModal.tsx`) — warn if any aren't, and say
      what happens if the warning's ignored (label falls back to the
      browser's default font instead of the intended one, so text may look
      wrong/mismatched-size until the missing font is uploaded via Settings
      > Custom fonts). Relevant since the widget-variant presets in
      `Palette.tsx` (added 2026-09-10/11) were deliberately built from
      custom-font source examples but ship with built-in fonts instead,
      specifically to dodge this same problem for those — a real imported
      deck can still hit it.
- [x] Let users create their own custom widget variants to appear in the
      split-button dropdowns — implemented (2026-09-11): right-click a
      widget (or multi-selection) on the canvas → "Save as variant" →
      name it (new `promptStore.ts`/`PromptModal.tsx`, mirroring
      `confirmStore`'s own imperative-await shape) → persisted app-wide via
      a new `CustomVariant` (`shared/types.ts`) round-tripped over
      `custom-variants:get/save/delete` (`ClientToServer`) and
      `custom-variants:list` (`ServerToClient`), stored server-side in
      `main/customVariants.ts` (one JSON manifest in userData, mirroring
      `customFonts.ts`'s own pattern) and pushed unasked as part of
      `sendInitialState`, edit-role only (a deployed view client has no
      palette to use one from). A single-widget variant merges into that
      widget type's own `PaletteVariantButton` dropdown (every type now
      conditionally becomes a split button once it has any custom variant,
      not just the 5 that already had built-in ones); a 2+-widget one (same
      permissive multi-select threshold "Group" already uses) shows up
      instead from a new standalone "Custom Variants" palette button
      (`CustomVariantsButton` in `Palette.tsx`), spawned back via the same
      `pasteWidgets`/`groupWidgets` primitives regular paste/Group already
      use. Every dropdown row for a custom (never built-in) variant gets a
      delete (×) button, gated by the same `useConfirmStore` confirmation
      dialog every other destructive action in the editor uses, before
      calling `custom-variants:delete`.
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
- [ ] The random-number example plugin (`shared/plugins/random.ts` +
      `main/plugins/random.ts`, referenced from CONTRIBUTING.md's "Adding a
      plugin" walkthrough as the copy-this-file template) only demonstrates
      output fields (`fields: [{ key: 'value', ... }]`) — it should also grow
      a "max"/"min" per-instance CONFIG field (via `PluginInstance.config` —
      see its own comment in `shared/types.ts`) so the template actually
      shows contributors how to add a configurable field too, not just an
      output one. Needs a renderer-side config panel (same pattern as
      `renderer/src/plugins/ScreenCaptureConfigPanel.tsx`) plus the producer
      reading `instance.config` instead of hardcoding `Math.random()`'s 0–1
      range.

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
- [ ] Main process has no `process.on('unhandledRejection', ...)` handler —
      a rejected promise anywhere that isn't already inside a try/catch
      (e.g. a bug in a plugin producer's async tick, or in a WS message
      handler's own async work) surfaces only as a raw
      `UnhandledPromiseRejectionWarning` in the terminal, easy to miss and
      not visible anywhere in-app (debug console, toasts, etc.) — this is
      exactly what happened investigating the windowsAudio worker crash on
      2026-09-11, where the warning was the only clue something was wrong
      before the real segfault. Should at least log it clearly (maybe
      through the same sink `pushRemoteDebugLog`/`action:log` already use)
      instead of relying on whoever's watching the raw terminal to notice.
      Separately, unrelated noise seen in the same terminal output: a
      `(node:PID) [DEP0040] DeprecationWarning: The 'punycode' module is
      deprecated` line on every startup — comes from some dependency still
      using Node's built-in `punycode` internally (not our own code; not
      yet tracked down which one — `bonjour-service` and/or `ws` are the
      likely suspects given mDNS/WebSocket both have historically pulled it
      in), worth a `npm ls punycode`-style hunt to find and update/replace
      whichever dependency triggers it once there's time to chase it.
- [ ] Bug: an Adjuster (slider/knob) widget's own rendered handle position
      can get stuck ignoring a live variable change that isn't an echo of
      its own last drag. `useAdjusterDrag.ts`'s reconciliation effect
      (~line 232) deliberately keeps rendering from the local `dragFraction`
      after a drag ends — rather than snapping straight to whatever
      `valueExpr` currently resolves to — until the variable comes back
      within `RECONCILE_EPSILON` (0.01) of that drag's own final value, so
      there's no visible jump while waiting for the server's own confirming
      broadcast of THIS drag to arrive. The gap: it can't tell "this is my
      own drag settling" apart from "something unrelated changed this
      variable" — found via the `windowsAudio` plugin (drag the Adjuster on
      one device, then change the same volume from Windows' own slider —
      the widget stays pinned at the old dragged position until the new
      value happens to sweep back near it, reading as stuck/sluggish rather
      than live). The widget's own comment already anticipated a related
      case (another device dragging the same on-screen widget) but the fix
      there has the same gap — it only reconciles by coincidentally passing
      near the old value, not by recognizing a genuinely new external
      value. Needs an actual design decision (e.g. some way to tell an echo
      of this drag apart from an unrelated external change) before
      touching it — this hook is shared by every Adjuster in the app, not
      windowsAudio-specific.
- [x] Bug: clicking a label's fx (ƒx) toggle off (the × button) permanently
      discarded the whole expression, with no confirmation and no way back
      short of Ctrl+Z — fixed (2026-09-12). `LabelFields` in
      `PropertiesPanel.tsx` now keeps a `textExprDraftRef` (same shape
      `SendDcsCommandActionEditor`'s own Value field already used) that
      remembers the last non-empty `textExpr` across a toggle-off-then-
      back-on, so clicking ƒx again restores what was there instead of
      starting from a blank string. Still worth checking every OTHER fx/×
      toggle in this file for the same gap — this was only the one
      actually reported (label text specifically), not a full audit.
- [ ] Placing a variant whose widget(s) use an action tied to a currently-
      disabled plugin (e.g. the built-in Volume Mute Button/Volume Slider
      variants' `set-windows-audio` action, if the Windows Audio plugin is
      off in Settings) should raise a warning the same way the missing-
      variables toast does (`findMissingVariantVariables` in `Palette.tsx`,
      `variantWarningStore.ts`/`VariantWarningToasts.tsx`) — right now it
      silently places a widget whose action will just throw
      `"<Plugin> is disabled in Settings"` (see `runSetWindowsAudioAction`
      in `main/index.ts`) the first time it fires, with no indication at
      placement time that anything's wrong. Needs a scan similar to the
      variable one — walk the variant's widget(s) for action kinds gated by
      `isWidgetTypeGatedByDisabledPlugin`-style plugin checks (or whatever
      each plugin's action kind is) and cross-reference against
      `enabledPlugins` — probably reusing the same toast UI/store, just a
      second warning source feeding into it.

## Packaging (not yet started)

- [ ] When we eventually package boarderoni (electron-builder/forge, currently
      not set up at all — only `electron-vite` dev commands exist), set the
      Windows execution level to `requireAdministrator` in the packager
      config (e.g. electron-builder's `win.requestedExecutionLevel`). Reason:
      games like DCS that run elevated silently swallow synthetic keystrokes
      (`nut-js`/`SendInput` in `src/main/index.ts`) sent from a
      non-elevated boarderoni due to Windows UIPI — both processes need to be
      at the same integrity level for macros to reach the game.
- [ ] Auto-update, once there's an actual second machine that needs to stay
      in sync — pair electron-builder with the `electron-updater` runtime
      package (`autoUpdater.checkForUpdatesAndNotify()` or manual
      check/download/`quitAndInstall()` calls in the main process).
      electron-builder emits a `latest.yml` alongside the Windows installer;
      `electron-updater` polls a feed URL (simplest: GitHub Releases,
      electron-builder can auto-publish there via `GH_TOKEN` and
      `electron-updater` reads the repo's releases directly with no extra
      infra) and stages the new installer for the next restart. Windows NSIS
      updates work unsigned (just a SmartScreen warning without a cert); a
      mac build would need a real code-signing cert for auto-update to work
      at all (Gatekeeper blocks unsigned auto-updates) — not a concern yet
      since there's no mac build. Deliberately skipped for the first
      packaging pass (see this section's own items above) since it's a
      clean add-on later.

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
- [x] Windows audio devices as a data source + action — implemented
      (2026-09-11) as the `windowsAudio` plugin, on `native-sound-mixer`
      (real N-API addon, ships prebuilt `.node` binaries, confirmed
      worker_threads-safe via a throwaway spike before committing to it —
      see `main/windowsAudio/`). Entirely off the main thread, mirroring
      `dcsBios/worker.ts`'s own isolation: `main/windowsAudio/worker.ts`
      owns every WASAPI/COM call (device enumeration, volume/mute get/set,
      native `Device.on('volume'|'mute', ...)` push events, plus a 2s
      rescan for the one thing with no push event — the default device
      changing, or a hot-plugged device appearing), bridged to the plugin
      framework through `connectionManager.ts` (`WorkerHost`-based, same
      shared-worker/ref-counted shape as `dcsBios/connectionManager.ts`).
      Event source fields: `volume` (0-100), `muted`, `deviceName` — picked
      per-instance via `WindowsAudioConfigPanel.tsx`'s device dropdown
      (`''` tracks whichever device is currently default, following it
      across a switch; anything else is an exact device name — the library
      exposes no stable device id, so name is the only handle there is,
      with the obvious fragility if a device gets renamed/replaced).
      Action: `SetWindowsAudioAction` (`shared/types.ts`) — volume (plain
      value or expression, same `$value`-shorthand precedence
      `SendDcsCommandAction` uses) and an independent mute/unmute/toggle,
      edited via `SetWindowsAudioActionEditor` in PropertiesPanel.tsx. Explicitly NOT in this pass: peak/meter level
      reporting (native-sound-mixer has no such API — would need a small
      custom N-API binding wrapping `IAudioMeterInformation`, scoped
      separately) and per-application (session) volume, which the library
      DOES support but wasn't wired up.
- [ ] Big one: investigate macOS support viability. Boarderoni is currently
      Windows-only in practice even though it's plain Electron/React —
      known Windows-specific pieces that'd need a cross-platform story (or
      an explicit "unsupported on Mac" carve-out) before this is real:
      `nut-js`/`SendInput` keystroke injection in `src/main/index.ts` (the
      packaging TODO above already flags this as Windows-UIPI-specific),
      the DCS Viewports plugin's virtual-display-driver + MonitorSetup.lua
      export flow (see `main/dcsViewports/`), and the new Windows-audio
      plugin being investigated just above. Not scoped beyond that yet —
      needs an actual audit of what else assumes Windows (file paths,
      registry reads, etc.) before estimating how big a lift this is.
