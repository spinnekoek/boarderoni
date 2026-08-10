import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { fas } from '@fortawesome/free-solid-svg-icons'
import { far } from '@fortawesome/free-regular-svg-icons'
import { fab } from '@fortawesome/free-brands-svg-icons'

// Keyed by the same `fa-<name>` form shown under each icon at
// fontawesome.com/search — e.g. "image" -> "fa-image". Packs are merged in
// solid/regular/brands order, first match wins, so a name that exists in
// more than one style (rare, but e.g. some brand names) resolves to the
// style most `{{icon:...}}` authors would expect.
const ICONS_BY_NAME = new Map<string, IconDefinition>()
for (const pack of [fas, far, fab] as Record<string, IconDefinition>[]) {
  for (const icon of Object.values(pack)) {
    const key = `fa-${icon.iconName}`
    if (!ICONS_BY_NAME.has(key)) ICONS_BY_NAME.set(key, icon)
  }
}

// Accepts the token's name with or without the leading "fa-" so both
// `{{icon:fa-image}}` (matching the site's className) and `{{icon:image}}`
// resolve.
export function findIcon(name: string): IconDefinition | undefined {
  return ICONS_BY_NAME.get(name.startsWith('fa-') ? name : `fa-${name}`)
}
