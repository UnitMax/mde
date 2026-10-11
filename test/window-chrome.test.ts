import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_TITLE_BAR_COLORS,
  TITLE_BAR_HEIGHT,
  TitleBarController,
  titleBarOverlayHeight,
  windowChromeOptions,
  type TitleBarTarget
} from '../src/main/window-chrome'

const colors = { color: '#211614', symbolColor: '#bca58f' }

function fakeWindow(destroyed = false) {
  const state = { destroyed }
  const target = {
    isDestroyed: () => state.destroyed,
    setTitleBarOverlay: vi.fn()
  } satisfies TitleBarTarget
  return { state, target }
}

function controllerFor(platform: string, window: TitleBarTarget | null) {
  return new TitleBarController({ platform, getWindow: () => window })
}

describe('windowChromeOptions', () => {
  it.each(['win32', 'linux'])('hides the title bar and themes the native buttons on %s', (platform) => {
    expect(windowChromeOptions(platform, colors)).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: { ...colors, height: TITLE_BAR_HEIGHT }
    })
  })

  it('keeps the traffic lights on macOS, inset into the bar', () => {
    const options = windowChromeOptions('darwin', colors)
    expect(options.titleBarStyle).toBe('hidden')
    expect(options.titleBarOverlay).toBeUndefined()
    expect(options.trafficLightPosition).toEqual({ x: 12, y: 10 })
  })

  it('leaves unknown platforms with the normal frame', () => {
    expect(windowChromeOptions('freebsd', colors)).toEqual({})
  })

  it('defaults to the Slate palette', () => {
    expect(windowChromeOptions('win32').titleBarOverlay).toMatchObject(DEFAULT_TITLE_BAR_COLORS)
  })
})

describe('titleBarOverlayHeight', () => {
  it.each([
    [1, 32],
    [1.5, 48],
    [0.5, 16],
    [1.1, 35],
    [0.9, 29],
    [0, 1]
  ])('scales the native buttons with zoom %s', (zoom, expected) => {
    expect(titleBarOverlayHeight(zoom)).toBe(expected)
  })
})

describe('TitleBarController', () => {
  it('re-themes the native buttons, always sending every field', () => {
    const fake = fakeWindow()
    controllerFor('win32', fake.target).setColors(colors)

    expect(fake.target.setTitleBarOverlay).toHaveBeenCalledOnce()
    expect(fake.target.setTitleBarOverlay).toHaveBeenCalledWith({ ...colors, height: 32 })
  })

  it('rescales the buttons with zoom without losing the chosen colors', () => {
    const fake = fakeWindow()
    const controller = controllerFor('linux', fake.target)

    controller.setColors(colors)
    controller.setZoom(1.2)

    expect(fake.target.setTitleBarOverlay).toHaveBeenLastCalledWith({ ...colors, height: 38 })
  })

  it('keeps the latest colors for windows created later', () => {
    const controller = controllerFor('win32', null)

    controller.setColors(colors)

    expect(controller.windowOptions().titleBarOverlay).toEqual({ ...colors, height: 32 })
  })

  it('copies the colors it is given', () => {
    const fake = fakeWindow()
    const controller = controllerFor('win32', fake.target)
    const mutable = { ...colors }

    controller.setColors(mutable)
    mutable.color = '#000000'
    controller.setZoom(1)

    expect(fake.target.setTitleBarOverlay).toHaveBeenLastCalledWith({ ...colors, height: 32 })
  })

  it('does nothing on macOS, where there is no overlay', () => {
    const fake = fakeWindow()
    const controller = controllerFor('darwin', fake.target)

    controller.setColors(colors)
    controller.setZoom(1.5)

    expect(fake.target.setTitleBarOverlay).not.toHaveBeenCalled()
  })

  it('does nothing without a live window', () => {
    const missing = controllerFor('win32', null)
    expect(() => missing.setColors(colors)).not.toThrow()

    const fake = fakeWindow(true)
    controllerFor('win32', fake.target).setZoom(1.2)
    expect(fake.target.setTitleBarOverlay).not.toHaveBeenCalled()
  })
})
