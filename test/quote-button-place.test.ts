import { describe, expect, it } from 'vitest'
import { QUOTE_BUTTON_HEIGHT, QUOTE_BUTTON_WIDTH, quoteButtonPlace, type Box } from '../src/renderer/lib/quote-button-place'

/** A conversation view 800 wide and 400 high, whose top is 100 from the top of the window. */
const view: Box = { left: 0, right: 800, top: 100, bottom: 500 }
const line = (left: number, right: number, top: number): Box => ({ left, right, top, bottom: top + 18 })

describe('quoteButtonPlace', () => {
  it('puts the button below the end of a selection made downward, centered on where it ends', () => {
    const place = quoteButtonPlace(line(100, 452, 200), view, false)
    expect(place).toEqual({ left: 452 - QUOTE_BUTTON_WIDTH / 2, top: 218 + 8 })
  })

  it('puts it above the start of a selection made upward, centered on where it starts', () => {
    const place = quoteButtonPlace(line(193, 600, 200), view, true)
    expect(place).toEqual({ left: 193 - QUOTE_BUTTON_WIDTH / 2, top: 200 - 8 - QUOTE_BUTTON_HEIGHT })
  })

  it('goes above a selection that ends too near the bottom for it to fit below', () => {
    const place = quoteButtonPlace(line(100, 300, 470), view, false)
    expect(place!.top).toBe(470 - 8 - QUOTE_BUTTON_HEIGHT)
  })

  it('goes below a selection made upward that starts too near the top for it to fit above', () => {
    const place = quoteButtonPlace(line(100, 300, 105), view, true)
    expect(place!.top).toBe(123 + 8)
  })

  it('stays inside the view when there is no room on either side', () => {
    const small: Box = { left: 0, right: 800, top: 100, bottom: 150 }
    const place = quoteButtonPlace(line(100, 300, 110), small, false)
    expect(place!.top).toBeGreaterThanOrEqual(small.top + 8)
    expect(place!.top + QUOTE_BUTTON_HEIGHT).toBeLessThanOrEqual(small.bottom - 8 + 1e-9)
  })

  it('keeps clear of the left and right edges', () => {
    expect(quoteButtonPlace(line(0, 10, 200), view, false)!.left).toBe(8)
    expect(quoteButtonPlace(line(700, 799, 200), view, false)!.left).toBe(800 - QUOTE_BUTTON_WIDTH - 8)
  })

  it('has no place for a selection that is scrolled out of view', () => {
    expect(quoteButtonPlace(line(100, 300, 50), view, false)).toBeNull()
    expect(quoteButtonPlace(line(100, 300, 520), view, false)).toBeNull()
  })

  it('has a place for a line only partly in view', () => {
    expect(quoteButtonPlace(line(100, 300, 90), view, false)).not.toBeNull()
    expect(quoteButtonPlace(line(100, 300, 495), view, false)).not.toBeNull()
  })
})
