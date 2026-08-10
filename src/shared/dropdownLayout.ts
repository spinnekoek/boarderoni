import type { DropdownWidget } from './types'

// Which physical axis the stack runs along, and which direction increasing
// slot numbers move in — shared between DropdownWidget.tsx (rendering the
// layout) and useDropdownDrag.ts (resolving a drag back to a slot), which
// must stay exact inverses of each other. A "slot" is always a signed count
// of item-sizes away from wherever slot 0 sits (see DropdownWidget's own
// anchored/unanchored comment) — these two functions turn that abstract
// count into "which screen axis" and "which way is positive" for a given
// orientation.
export function dropdownAxis(orientation: NonNullable<DropdownWidget['orientation']>): 'horizontal' | 'vertical' {
  return orientation === 'left-to-right' || orientation === 'right-to-left' ? 'horizontal' : 'vertical'
}

export function dropdownSign(orientation: NonNullable<DropdownWidget['orientation']>): 1 | -1 {
  return orientation === 'right-to-left' || orientation === 'bottom-to-top' ? -1 : 1
}

export function dropdownItemSize(widget: DropdownWidget): number {
  return dropdownAxis(widget.orientation ?? 'top-to-bottom') === 'horizontal' ? widget.w : widget.h
}
