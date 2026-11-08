import { describe, expect, it, vi } from 'vitest'
import {
  CONTINUOUS_FLASH_MS,
  indicatorDescription,
  TaskbarAttention,
  type AttentionWindow
} from '../src/main/taskbar-attention'
import { BADGE_SIZE, badgeBitmap } from '../src/main/taskbar-badge'

function setup(platform = 'win32') {
  const window = {
    destroyed: false,
    focused: false,
    isDestroyed() { return this.destroyed },
    isFocused() { return this.focused },
    flashFrame: vi.fn(),
    setProgressBar: vi.fn(),
    setOverlayIcon: vi.fn()
  }
  const timers = new Map<number, () => void>()
  let next = 1
  const clearInterval = vi.fn((timer: unknown) => { timers.delete(timer as number) })
  const controller = new TaskbarAttention({
    platform,
    getWindow: () => window as AttentionWindow,
    badge: (tone, count) => `${tone}:${count}`,
    setInterval: (callback) => { timers.set(next, callback); return next++ },
    clearInterval
  })
  const tick = (): void => timers.forEach((callback) => callback())
  return { window, controller, timers, tick, clearInterval }
}

describe('TaskbarAttention flashing', () => {
  it('flashes once for a brief flash and starts no timer', () => {
    const { window, controller, timers } = setup()
    controller.update({ indicator: null, flash: 'brief' })
    expect(window.flashFrame).toHaveBeenCalledExactlyOnceWith(true)
    expect(timers.size).toBe(0)
  })

  it('does not flash the window in use', () => {
    const { window, controller } = setup()
    window.focused = true
    controller.update({ indicator: null, flash: 'brief' })
    controller.update({ indicator: null, flash: 'continuous' })
    expect(window.flashFrame).not.toHaveBeenCalled()
  })

  it('starts the flash again on a timer for a continuous flash, until the window is focused', () => {
    const { window, controller, timers, tick } = setup()
    controller.update({ indicator: null, flash: 'continuous' })
    expect(window.flashFrame).toHaveBeenCalledTimes(1)
    expect(timers.size).toBe(1)
    expect(CONTINUOUS_FLASH_MS).toBeGreaterThan(2000)
    tick()
    tick()
    expect(window.flashFrame).toHaveBeenCalledTimes(3)
    window.focused = true
    tick()
    expect(window.flashFrame).toHaveBeenCalledTimes(3)
    expect(timers.size).toBe(0)
  })

  it('never has two timers: a new flash replaces the running one', () => {
    const { controller, timers } = setup()
    controller.update({ indicator: null, flash: 'continuous' })
    controller.update({ indicator: null, flash: 'continuous' })
    expect(timers.size).toBe(1)
    controller.update({ indicator: null, flash: 'brief' })
    expect(timers.size).toBe(0)
  })

  it('stops flashing when asked and when the window is used', () => {
    const { window, controller, timers } = setup()
    controller.update({ indicator: null, flash: 'continuous' })
    controller.update({ indicator: null, flash: 'none' })
    expect(window.flashFrame).toHaveBeenLastCalledWith(false)
    expect(timers.size).toBe(0)
    controller.update({ indicator: null, flash: 'continuous' })
    controller.windowFocused()
    expect(window.flashFrame).toHaveBeenLastCalledWith(false)
    expect(timers.size).toBe(0)
  })

  it('leaves a running flash alone when a request names none', () => {
    const { window, controller, timers } = setup()
    controller.update({ indicator: null, flash: 'continuous' })
    controller.update({ indicator: { tone: 'done', count: 1 } })
    expect(timers.size).toBe(1)
    expect(window.flashFrame).toHaveBeenCalledTimes(1)
  })

  it('does nothing without a window, and clears its timer on dispose', () => {
    const { window, controller, timers } = setup()
    controller.update({ indicator: null, flash: 'continuous' })
    controller.dispose()
    expect(timers.size).toBe(0)
    window.destroyed = true
    expect(() => controller.update({ indicator: { tone: 'failed', count: 1 }, flash: 'brief' })).not.toThrow()
    expect(() => controller.windowFocused()).not.toThrow()
    expect(window.setProgressBar).not.toHaveBeenCalled()
  })
})

describe('TaskbarAttention indicator', () => {
  it.each([
    ['failed', 'error'],
    ['input', 'paused'],
    ['done', 'normal']
  ] as const)('shows %s as a full %s progress bar with a badge', (tone, mode) => {
    const { window, controller } = setup()
    controller.update({ indicator: { tone, count: 3 } })
    expect(window.setProgressBar).toHaveBeenCalledExactlyOnceWith(1, { mode })
    expect(window.setOverlayIcon).toHaveBeenCalledExactlyOnceWith(`${tone}:3`, indicatorDescription({ tone, count: 3 }))
  })

  it('only applies a change, and clears both when there is no indicator', () => {
    const { window, controller } = setup()
    controller.update({ indicator: { tone: 'failed', count: 1 } })
    controller.update({ indicator: { tone: 'failed', count: 1 } })
    expect(window.setProgressBar).toHaveBeenCalledTimes(1)
    controller.update({ indicator: { tone: 'failed', count: 2 } })
    expect(window.setProgressBar).toHaveBeenCalledTimes(2)
    controller.update({ indicator: null })
    expect(window.setProgressBar).toHaveBeenLastCalledWith(-1)
    expect(window.setOverlayIcon).toHaveBeenLastCalledWith(null, '')
    controller.update({ indicator: null })
    expect(window.setProgressBar).toHaveBeenCalledTimes(3)
  })

  it('leaves the colour and badge to Windows, which is the only place with them', () => {
    const { window, controller } = setup('linux')
    controller.update({ indicator: { tone: 'input', count: 1 }, flash: 'brief' })
    expect(window.setProgressBar).not.toHaveBeenCalled()
    expect(window.setOverlayIcon).not.toHaveBeenCalled()
    expect(window.flashFrame).toHaveBeenCalledWith(true)
  })

  it('describes the badge for screen readers', () => {
    expect(indicatorDescription({ tone: 'failed', count: 1 })).toBe('1 thread failed')
    expect(indicatorDescription({ tone: 'input', count: 2 })).toBe('2 threads waiting for you')
    expect(indicatorDescription({ tone: 'done', count: 12 })).toBe('12 threads done')
  })
})

describe('badgeBitmap', () => {
  const pixel = (bitmap: Buffer, x: number, y: number): [number, number, number, number] => {
    const offset = (y * BADGE_SIZE + x) * 4
    // Stored blue, green, red, alpha.
    return [bitmap[offset + 2]!, bitmap[offset + 1]!, bitmap[offset]!, bitmap[offset + 3]!]
  }

  it('is a 16 x 16 BGRA image with transparent corners and an opaque disc', () => {
    const bitmap = badgeBitmap('failed', 1)
    expect(bitmap.length).toBe(16 * 16 * 4)
    expect(pixel(bitmap, 0, 0)[3]).toBe(0)
    expect(pixel(bitmap, 15, 15)[3]).toBe(0)
    expect(pixel(bitmap, 2, 8)).toEqual([220, 38, 38, 255])
  })

  it('uses a colour for each tone', () => {
    expect(pixel(badgeBitmap('input', 1), 2, 8).slice(0, 3)).toEqual([245, 184, 0])
    expect(pixel(badgeBitmap('done', 1), 2, 8).slice(0, 3)).toEqual([22, 150, 70])
  })

  it('draws the number in a different colour from the disc, and different numbers differently', () => {
    const ink = (bitmap: Buffer): number => {
      let pixels = 0
      for (let y = 0; y < BADGE_SIZE; y += 1) {
        for (let x = 0; x < BADGE_SIZE; x += 1) {
          if (pixel(bitmap, x, y).join() === '255,255,255,255') pixels += 1
        }
      }
      return pixels
    }
    expect(ink(badgeBitmap('failed', 1))).toBeGreaterThan(0)
    expect(ink(badgeBitmap('failed', 8))).toBeGreaterThan(ink(badgeBitmap('failed', 1)))
    expect(badgeBitmap('failed', 2).equals(badgeBitmap('failed', 3))).toBe(false)
    expect(badgeBitmap('failed', 12).equals(badgeBitmap('failed', 21))).toBe(false)
  })

  it('keeps a two-digit number inside the disc, and caps the number at 99', () => {
    const bitmap = badgeBitmap('done', 88)
    for (let y = 0; y < BADGE_SIZE; y += 1) {
      for (let x = 0; x < BADGE_SIZE; x += 1) {
        const [, , , alpha] = pixel(bitmap, x, y)
        if (pixel(bitmap, x, y).join() === '255,255,255,255') {
          const dx = x + 0.5 - BADGE_SIZE / 2
          const dy = y + 0.5 - BADGE_SIZE / 2
          expect(dx * dx + dy * dy).toBeLessThan(7.5 * 7.5)
          expect(alpha).toBe(255)
        }
      }
    }
    expect(badgeBitmap('done', 250).equals(badgeBitmap('done', 99))).toBe(true)
  })
})
