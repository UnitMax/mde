import { describe, expect, it } from 'vitest'
import { CHAT_COLUMN_MAX_PX, CHAT_COLUMN_MIN_PX, floatingReserve } from '../src/renderer/lib/floating-reserve'

const CARD = 272
const RESERVE = CARD + 12 + 16

/** Where a centred column of at most 768 px ends, in an area of `width` with `padding` on its right. */
function columnRight(width: number, padding: number): number {
  const column = Math.min(CHAT_COLUMN_MAX_PX, width - padding)
  return (width - padding - column) / 2 + column
}

describe('floatingReserve', () => {
  it('takes nothing without a card', () => {
    expect(floatingReserve(1200, 0, 'column')).toBe(0)
    expect(floatingReserve(0, CARD, 'column')).toBe(0)
  })

  it('leaves a wide conversation alone: its centred column already ends short of the card', () => {
    const width = CHAT_COLUMN_MAX_PX + 2 * RESERVE
    expect(floatingReserve(width, CARD, 'column')).toBe(0)
    expect(floatingReserve(width + 300, CARD, 'column')).toBe(0)
  })

  it('moves the column only as far as it must, until it ends where the card begins', () => {
    for (const width of [1300, 1200, 1100, 1000, 900, 850]) {
      const padding = floatingReserve(width, CARD, 'column')
      expect(padding).toBeGreaterThan(0)
      expect(padding).toBeLessThanOrEqual(RESERVE)
      expect(columnRight(width, padding)).toBeLessThanOrEqual(width - RESERVE + 0.5)
    }
    // Narrower than the column and the card side by side, the column gives up width instead.
    expect(floatingReserve(900, CARD, 'column')).toBe(RESERVE)
  })

  it('lets the card float over the conversation again when beside it the conversation would be too narrow', () => {
    expect(floatingReserve(CHAT_COLUMN_MIN_PX + RESERVE, CARD, 'column')).toBe(RESERVE)
    expect(floatingReserve(CHAT_COLUMN_MIN_PX + RESERVE - 1, CARD, 'column')).toBe(0)
    expect(floatingReserve(600, CARD, 'fill')).toBe(0)
  })

  it('makes way for all of the card for content that fills the width', () => {
    expect(floatingReserve(1600, CARD, 'fill')).toBe(RESERVE)
  })
})
