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

## Performance

- [ ] Investigate responsiveness slowdown when there are a lot of items —
      reported generally, not yet scoped to which "items" (widgets on
      canvas? variables? tick marks? event sources?) or where the slowdown
      shows up (editor only, or deployed view too). Needs reproduction with
      a large dashboard before diagnosing.

## Bugs

- [ ] Android: switching decks via the 5-finger gesture modal
      (`MobileAppModal.tsx`, opened from `ViewCanvas.tsx` — see its 5-finger
      touch handling) doesn't show the deck list. Needs reproduction on an
      actual Android device to narrow down (state not loading? list
      rendering empty? gesture opening the wrong view?).
- [ ] Properties panel's drag-to-resize handle only grabs while the panel is
      scrolled to the top. Root cause: `.properties__resize-handle`
      (styles.css) is `position: absolute; top: 0; height: 100%` inside
      `.properties` itself, which is also the scrolling element
      (`overflow-y: auto`) — so the handle scrolls away with the content
      instead of staying pinned to the visible edge. Fix likely means
      splitting `.properties` into a fixed-position outer wrapper (holding
      `resizeHandle`) and an inner scrollable content div, which every widget
      type's own render branch in `PropertiesPanel.tsx` would need updating
      for (currently ~14 duplicated `<aside className="properties">
      {resizeHandle}...` call sites).

## Features to investigate

- [ ] Design a deck at one resolution and have it scale down cleanly for
      other screen resolutions. `LetterboxedCanvas.tsx` already does uniform
      scale-to-fit for the deployed view, so this may partly already work —
      needs checking what actually breaks at other aspect ratios/DPIs (crisp
      lines/thin widgets are a known trouble spot at non-native scale, see
      the letterbox-thin-widgets note) and whether per-widget or
      per-resolution overrides are needed on top of straight scaling.
