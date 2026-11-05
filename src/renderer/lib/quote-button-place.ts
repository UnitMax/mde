/** The size of the Quote button, which the place for it is worked out from. */
export const QUOTE_BUTTON_WIDTH = 84
export const QUOTE_BUTTON_HEIGHT = 28

/** Between the selection and the button. */
const GAP = 8
/** The least left between the button and the edge of the conversation. */
const EDGE = 8

export interface Box {
  left: number
  right: number
  top: number
  bottom: number
}

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(value, high))

/**
 * Where the Quote button goes, as the top left corner, in the same coordinates as the boxes. `end` is the
 * line the selection ended on, where the pointer was let go: the last line for a selection made downward,
 * the first for one made upward. The button sits below that line, or above it for a selection made upward
 * and when there is no room below; it stays inside `view`, the visible part of the conversation. Null when
 * that line is out of sight.
 */
export function quoteButtonPlace(end: Box, view: Box, backward: boolean): { left: number; top: number } | null {
  if (end.bottom < view.top || end.top > view.bottom) return null
  const belowTop = end.bottom + GAP
  const aboveTop = end.top - GAP - QUOTE_BUTTON_HEIGHT
  const fitsBelow = belowTop + QUOTE_BUTTON_HEIGHT <= view.bottom - EDGE
  const fitsAbove = aboveTop >= view.top + EDGE
  const above = backward ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove
  return {
    top: clamp(above ? aboveTop : belowTop, view.top + EDGE, view.bottom - QUOTE_BUTTON_HEIGHT - EDGE),
    // Centered on the end of the line the selection ends on.
    left: clamp((backward ? end.left : end.right) - QUOTE_BUTTON_WIDTH / 2, view.left + EDGE, view.right - QUOTE_BUTTON_WIDTH - EDGE),
  }
}
