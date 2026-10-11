import { describe, expect, it, vi } from 'vitest'
import {
  getMiniWindowAction,
  MINI_WINDOW_MARGIN,
  MINI_WINDOW_MIN_SIZE,
  MINI_WINDOW_SIZE,
  MiniWindowController,
  miniWindowBounds,
  type MiniWindowTarget,
  type Rect
} from '../src/main/mini-window'

const key = {
  type: 'keyDown',
  key: 'F12',
  control: false,
  meta: false,
  alt: false,
  shift: false
}

const workArea: Rect = { x: 0, y: 0, width: 1920, height: 1040 }

describe('getMiniWindowAction', () => {
  it('toggles on a fresh F12 press', () => {
    expect(getMiniWindowAction(key)).toBe('toggle')
    expect(getMiniWindowAction({ ...key, key: 'Unidentified', code: 'F12' })).toBe('toggle')
  })

  it('swallows auto-repeat so a held key neither toggles nor reaches the terminal', () => {
    expect(getMiniWindowAction({ ...key, isAutoRepeat: true })).toBe('ignore')
  })

  it.each([
    ['key release', { type: 'keyUp' }],
    ['Ctrl', { control: true }],
    ['Shift', { shift: true }],
    ['Alt', { alt: true }],
    ['Meta', { meta: true }],
    ['another function key', { key: 'F11' }],
    ['a letter', { key: 'f' }]
  ])('ignores %s', (_name, change) => {
    expect(getMiniWindowAction({ ...key, ...change })).toBeNull()
  })
})

describe('miniWindowBounds', () => {
  it('defaults to the top-right corner of the work area', () => {
    expect(miniWindowBounds(null, workArea)).toEqual({
      x: 1920 - MINI_WINDOW_SIZE.width - MINI_WINDOW_MARGIN,
      y: MINI_WINDOW_MARGIN,
      ...MINI_WINDOW_SIZE
    })
  })

  it('anchors to a work area that does not start at the origin', () => {
    const second: Rect = { x: 1920, y: 40, width: 1280, height: 720 }
    const bounds = miniWindowBounds(null, second)
    expect(bounds.x).toBe(1920 + 1280 - MINI_WINDOW_SIZE.width - MINI_WINDOW_MARGIN)
    expect(bounds.y).toBe(40 + MINI_WINDOW_MARGIN)
  })

  it('keeps a remembered position and size that still fit', () => {
    const saved = { x: 100, y: 200, width: 400, height: 500 }
    expect(miniWindowBounds(saved, workArea)).toEqual(saved)
  })

  it('pulls a remembered window back on screen after a display change', () => {
    const offscreen = { x: 5000, y: -300, width: 400, height: 500 }
    expect(miniWindowBounds(offscreen, workArea)).toEqual({
      x: 1920 - 400,
      y: 0,
      width: 400,
      height: 500
    })
  })

  it('never goes below the minimum size or above the work area', () => {
    const tiny = miniWindowBounds({ x: 0, y: 0, width: 10, height: 10 }, workArea)
    expect(tiny).toMatchObject(MINI_WINDOW_MIN_SIZE)

    const small: Rect = { x: 0, y: 0, width: 300, height: 300 }
    expect(miniWindowBounds(null, small)).toMatchObject({ width: 300, height: 300 })
  })
})

interface FakeState {
  destroyed: boolean
  minimized: boolean
  maximized: boolean
  fullScreen: boolean
  bounds: Rect
  normalBounds: Rect
  minimumSize: number[]
}

function fakeWindow(initial: Partial<FakeState> = {}) {
  const bounds: Rect = { x: 100, y: 80, width: 1280, height: 820 }
  const state: FakeState = {
    destroyed: false,
    minimized: false,
    maximized: false,
    fullScreen: false,
    bounds,
    normalBounds: bounds,
    minimumSize: [720, 480],
    ...initial
  }
  const leaveFullScreen: Array<() => void> = []
  const target = {
    isDestroyed: () => state.destroyed,
    isMinimized: () => state.minimized,
    restore: vi.fn(() => { state.minimized = false }),
    isMaximized: () => state.maximized,
    maximize: vi.fn(() => { state.maximized = true }),
    unmaximize: vi.fn(() => { state.maximized = false }),
    isFullScreen: () => state.fullScreen,
    setFullScreen: vi.fn((flag: boolean) => { state.fullScreen = flag }),
    getBounds: () => state.bounds,
    getNormalBounds: () => state.normalBounds,
    setBounds: vi.fn((next: Rect) => {
      state.bounds = next
      state.normalBounds = next
    }),
    getMinimumSize: () => state.minimumSize,
    setMinimumSize: vi.fn((width: number, height: number) => { state.minimumSize = [width, height] }),
    setAlwaysOnTop: vi.fn(),
    focus: vi.fn(),
    once: vi.fn((_event: 'leave-full-screen', listener: () => void) => { leaveFullScreen.push(listener) })
  } satisfies MiniWindowTarget
  return {
    state,
    target,
    /** Emulates Electron emitting 'leave-full-screen' after the transition finishes. */
    finishLeavingFullScreen: () => leaveFullScreen.splice(0).forEach((listener) => listener())
  }
}

function controllerFor(window: MiniWindowTarget | null) {
  const onChange = vi.fn()
  const workAreaFor = vi.fn(() => workArea)
  const controller = new MiniWindowController({ getWindow: () => window, workAreaFor, onChange })
  return { controller, onChange, workAreaFor }
}

describe('MiniWindowController', () => {
  it('shrinks to a floating always-on-top window at the top-right', () => {
    const fake = fakeWindow()
    const { controller, onChange, workAreaFor } = controllerFor(fake.target)

    controller.enter()

    expect(controller.mode).toBe('mini')
    expect(workAreaFor).toHaveBeenCalledWith({ x: 100, y: 80, width: 1280, height: 820 })
    expect(fake.target.setMinimumSize).toHaveBeenCalledWith(MINI_WINDOW_MIN_SIZE.width, MINI_WINDOW_MIN_SIZE.height)
    expect(fake.target.setBounds).toHaveBeenCalledWith(miniWindowBounds(null, workArea))
    expect(fake.target.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating')
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith('mini')
  })

  it('lowers the minimum size before resizing so the shrink is not clamped', () => {
    const fake = fakeWindow()
    controllerFor(fake.target).controller.enter()

    const [minOrder] = fake.target.setMinimumSize.mock.invocationCallOrder
    const [boundsOrder] = fake.target.setBounds.mock.invocationCallOrder
    expect(minOrder).toBeLessThan(boundsOrder!)
  })

  it('restores the previous geometry and drops always-on-top on exit', () => {
    const fake = fakeWindow()
    const { controller, onChange } = controllerFor(fake.target)
    const before = { ...fake.state.bounds }

    controller.enter()
    controller.exit()

    expect(controller.mode).toBe('normal')
    expect(fake.target.setAlwaysOnTop).toHaveBeenLastCalledWith(false)
    expect(fake.state.minimumSize).toEqual([720, 480])
    expect(fake.state.bounds).toEqual(before)
    expect(fake.target.focus).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenLastCalledWith('normal')
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('raises the minimum size before restoring the bounds', () => {
    const fake = fakeWindow()
    const { controller } = controllerFor(fake.target)
    controller.enter()
    controller.exit()

    const min = fake.target.setMinimumSize.mock.invocationCallOrder
    const bounds = fake.target.setBounds.mock.invocationCallOrder
    expect(min[1]).toBeLessThan(bounds[1]!)
  })

  it('brings a minimized window back before shrinking it', () => {
    const fake = fakeWindow({ minimized: true })
    controllerFor(fake.target).controller.enter()

    expect(fake.target.restore).toHaveBeenCalledOnce()
    expect(fake.target.restore.mock.invocationCallOrder[0])
      .toBeLessThan(fake.target.setBounds.mock.invocationCallOrder[0]!)
  })

  it('remembers a maximized window and maximizes it again after restoring bounds', () => {
    const normal = { x: 100, y: 80, width: 1280, height: 820 }
    const fake = fakeWindow({
      maximized: true,
      bounds: { x: 0, y: 0, width: 1920, height: 1040 },
      normalBounds: normal
    })
    const { controller } = controllerFor(fake.target)

    controller.enter()
    expect(fake.target.unmaximize).toHaveBeenCalledOnce()
    expect(fake.state.maximized).toBe(false)

    controller.exit()
    expect(fake.state.maximized).toBe(true)
    expect(fake.target.setBounds).toHaveBeenLastCalledWith(normal)
    expect(fake.target.maximize.mock.invocationCallOrder[0])
      .toBeGreaterThan(fake.target.setBounds.mock.invocationCallOrder[1]!)
  })

  it('waits for fullscreen to end before shrinking, then restores fullscreen', () => {
    const fake = fakeWindow({ fullScreen: true })
    const { controller, onChange } = controllerFor(fake.target)

    controller.enter()
    expect(fake.target.setFullScreen).toHaveBeenCalledWith(false)
    expect(fake.target.setBounds).not.toHaveBeenCalled()
    expect(controller.mode).toBe('normal')
    expect(onChange).not.toHaveBeenCalled()

    controller.enter()
    expect(fake.target.setFullScreen).toHaveBeenCalledOnce()

    fake.finishLeavingFullScreen()
    expect(controller.mode).toBe('mini')
    expect(fake.target.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating')
    expect(onChange).toHaveBeenCalledWith('mini')

    controller.exit()
    expect(fake.target.setFullScreen).toHaveBeenLastCalledWith(true)
  })

  it('stays normal if the window disappears while leaving fullscreen', () => {
    const fake = fakeWindow({ fullScreen: true })
    const { controller, onChange } = controllerFor(fake.target)

    controller.enter()
    fake.state.destroyed = true
    fake.finishLeavingFullScreen()

    expect(controller.mode).toBe('normal')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('reopens where the user left the mini window', () => {
    const fake = fakeWindow()
    const { controller, workAreaFor } = controllerFor(fake.target)

    controller.enter()
    const moved = { x: 40, y: 400, width: 360, height: 500 }
    fake.state.bounds = moved
    controller.exit()
    controller.enter()

    expect(workAreaFor).toHaveBeenLastCalledWith(moved)
    expect(fake.target.setBounds).toHaveBeenLastCalledWith(moved)
  })

  it('is idempotent and toggles between the two modes', () => {
    const fake = fakeWindow()
    const { controller, onChange } = controllerFor(fake.target)

    controller.exit()
    expect(onChange).not.toHaveBeenCalled()

    controller.enter()
    controller.enter()
    expect(onChange).toHaveBeenCalledTimes(1)

    controller.toggle()
    expect(controller.mode).toBe('normal')
    controller.toggle()
    expect(controller.mode).toBe('mini')
    controller.set('normal')
    expect(controller.mode).toBe('normal')
    controller.set('mini')
    expect(controller.mode).toBe('mini')
  })

  it('does nothing without a live window', () => {
    const missing = controllerFor(null)
    missing.controller.enter()
    expect(missing.controller.mode).toBe('normal')
    expect(missing.onChange).not.toHaveBeenCalled()

    const fake = fakeWindow({ destroyed: true })
    const destroyed = controllerFor(fake.target)
    destroyed.controller.toggle()
    expect(destroyed.controller.mode).toBe('normal')
    expect(fake.target.setBounds).not.toHaveBeenCalled()
  })

  it('forgets stale geometry when the window is gone', () => {
    const fake = fakeWindow()
    const { controller, onChange } = controllerFor(fake.target)
    controller.enter()

    fake.state.destroyed = true
    controller.exit()

    expect(controller.mode).toBe('normal')
    expect(onChange).toHaveBeenCalledTimes(1)

    fake.state.destroyed = false
    controller.exit()
    expect(fake.target.setBounds).toHaveBeenCalledTimes(1)
  })

  it('drops saved state on reset so the next window starts clean', () => {
    const fake = fakeWindow()
    const { controller } = controllerFor(fake.target)
    controller.enter()

    controller.reset()

    expect(controller.mode).toBe('normal')
    controller.exit()
    expect(fake.target.setAlwaysOnTop).toHaveBeenCalledTimes(1)
  })
})
