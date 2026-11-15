import type { PointerEvent } from 'react'

/**
 * Spread on a scroller that also has the `hover-scrollbar` class: its scrollbar shows only while the pointer is over
 * it. Chromium does not repaint a scrollbar thumb for a plain `:hover` rule, so the pointer sets an attribute instead.
 */
export const hoverScrollbar = {
  onPointerEnter: (event: PointerEvent<HTMLElement>): void => event.currentTarget.setAttribute('data-scrollbar-shown', ''),
  onPointerLeave: (event: PointerEvent<HTMLElement>): void => event.currentTarget.removeAttribute('data-scrollbar-shown'),
}
