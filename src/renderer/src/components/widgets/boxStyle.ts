import type { BoxAppearance } from '@shared/types'

// Shared box-model style for anything rendered as an inset, rounded,
// bordered rectangle within its own absolutely-positioned parent (see
// .deck-button/.deck-morph-cell, both `position: absolute`) — a plain
// button's state, or a morph block's effective (auto-fit-resolved)
// appearance. Unset fields fall back to the same defaults a fresh widget
// would show: no inset, 4px corners, 1px border.
export function boxStyle(box: BoxAppearance): React.CSSProperties {
  return {
    top: box.spacingTop ?? 0,
    right: box.spacingRight ?? 0,
    bottom: box.spacingBottom ?? 0,
    left: box.spacingLeft ?? 0,
    borderRadius: `${box.radiusTopLeft ?? 4}px ${box.radiusTopRight ?? 4}px ${box.radiusBottomRight ?? 4}px ${box.radiusBottomLeft ?? 4}px`,
    borderStyle: 'solid',
    borderTopWidth: box.borderWidthTop ?? 1,
    borderRightWidth: box.borderWidthRight ?? 1,
    borderBottomWidth: box.borderWidthBottom ?? 1,
    borderLeftWidth: box.borderWidthLeft ?? 1
  }
}
