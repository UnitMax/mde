/*
 * The Inbox sidebar can float as a card over the conversation's top right corner. Where there is room, the
 * conversation makes way for it instead of running under it: it takes just enough padding on its right that its
 * column ends short of the card, and none where the column, centred, already does.
 */

/** The card's distance from the right edge of the window (`right-3`). */
export const FLOATING_CARD_INSET_PX = 12
/** The clear space kept between the conversation and the card. */
export const FLOATING_CARD_GAP_PX = 16
/** The conversation column's widest (`max-w-3xl`). */
export const CHAT_COLUMN_MAX_PX = 768
/** Narrower than this beside the card, the conversation keeps its width and the card floats over it again. */
export const CHAT_COLUMN_MIN_PX = 520

/**
 * The right padding the conversation takes for a card `card` pixels wide in an area `width` pixels wide. `column`
 * is a centred column of at most `CHAT_COLUMN_MAX_PX` (a chat, the new-thread page), which only moves as far as it
 * must; `fill` is content that takes the whole width (a terminal), which makes way for all of the card.
 */
export function floatingReserve(width: number, card: number, layout: 'column' | 'fill'): number {
  if (!(card > 0) || !(width > 0)) return 0
  const reserve = card + FLOATING_CARD_INSET_PX + FLOATING_CARD_GAP_PX
  if (width - reserve < CHAT_COLUMN_MIN_PX) return 0
  if (layout === 'fill') return reserve
  // Centred in what is left of the width, the column's right edge is clear of the card once
  // (width - padding - column) / 2 + padding >= reserve.
  const needed = 2 * reserve - width + CHAT_COLUMN_MAX_PX
  return Math.min(reserve, Math.max(0, Math.ceil(needed)))
}
