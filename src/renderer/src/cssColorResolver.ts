import { setExtendedColorResolver } from '@shared/color'

// Installs the DOM-dependent half of hexToRgb's color resolution (see
// shared/color.ts) — imported once, for its side effect, from main.tsx.
// Resolves any valid CSS color (named colors, rgb(), hsl(), ...) by letting
// the browser normalize it: assigning it to a detached element's
// style.color preserves whatever form was authored ("red" stays "red"), but
// the resolved *computed* style is always rgb()/rgba() — which requires the
// element to actually be attached to the document.
setExtendedColorResolver((color) => {
  const probe = document.createElement('div')
  probe.style.color = color
  if (!probe.style.color) return null // invalid CSS color — the assignment above silently no-ops

  document.body.appendChild(probe)
  const computed = getComputedStyle(probe).color
  document.body.removeChild(probe)

  const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(computed)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
})
