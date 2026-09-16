# CLAUDE.md

Guidance for Claude when working in this repo. See docs/CONTRIBUTING.md for
the plugin-authoring walkthrough.

## Adding a widget type

When adding a new widget type (a new `Widget` union member in
`shared/types.ts`, its own palette button, etc.), remember custom variants
(right-click a widget → "Save as variant", see `Palette.tsx`) don't wire
themselves up automatically for it:

- The **save** side is generic and needs no changes — `ContextMenu.tsx`'s
  "Save as variant" and the `CustomVariant` persistence/sync (shared
  `custom-variants:*` messages, `main/customVariants.ts`) work for any
  widget type already.
- The **palette display** side is NOT generic. Each type's own row in
  `Palette.tsx` is a hardcoded `const xVariants = customVariantsFor('x')`
  plus a `{xVariants.length > 0 ? <PaletteVariantButton .../> : <button
  .../>}` block. A new type needs that same pair added by hand, mirroring
  whichever existing type is closest, or it'll only ever get a plain `+ X`
  button with no way to offer (or delete) a saved variant for it.
