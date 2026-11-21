// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fancyPaletteForTheme } from '../src/renderer/fancy/color'
import { DEFAULT_FANCY_SETTINGS } from '../src/renderer/fancy/settings'
import { useFancyMode } from '../src/renderer/store/fancy-mode'
import { noteTerminalInput, onTerminalCommand } from '../src/renderer/terminal/command-events'

const play = vi.hoisted(() => vi.fn((..._args: unknown[]) => vi.fn()))
vi.mock('../src/renderer/fancy/terminal-strike', async (original) => ({
  ...(await original<typeof import('../src/renderer/fancy/terminal-strike')>()),
  playTerminalStrike: play
}))

const { createTerminalStrike } = await import('../src/renderer/fancy/terminal-strike')
const { TerminalStrike } = await import('../src/renderer/components/TerminalStrike')

/** A 2D context that only counts what is drawn, enough for the effect's drawing code. */
function recordingContext(): { context: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = []
  const gradient = { addColorStop: () => undefined }
  const context = new Proxy({} as Record<string, unknown>, {
    get: (target, key: string) => {
      if (key in target) return target[key]
      if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => gradient
      return (..._args: unknown[]) => { calls.push(key) }
    },
    set: (target, key: string, value) => {
      target[key] = value
      return true
    }
  })
  return { context: context as unknown as CanvasRenderingContext2D, calls }
}

describe('commands entered in a terminal', () => {
  it('are Enter on its own at the shell, told to that terminal only, until unsubscribed', () => {
    const one = vi.fn()
    const other = vi.fn()
    const stop = onTerminalCommand('t1', one)
    onTerminalCommand('t2', other)
    noteTerminalInput('t1', '\r', false)
    expect(one).toHaveBeenCalledTimes(1)
    expect(other).not.toHaveBeenCalled()

    // Typing, a paste that ends in a newline and Enter in a full-screen program are not commands.
    noteTerminalInput('t1', 'l', false)
    noteTerminalInput('t1', 'ls -la\r', false)
    noteTerminalInput('t1', '\r', true)
    expect(one).toHaveBeenCalledTimes(1)

    stop()
    noteTerminalInput('t1', '\r', false)
    expect(one).toHaveBeenCalledTimes(1)
  })
})

describe('the terminal strike', () => {
  const palette = fancyPaletteForTheme('slate')

  it('is over in under a second and draws only while it lasts', () => {
    const strike = createTerminalStrike(palette, 'a', 800, 400)
    expect(strike.duration).toBeGreaterThan(0.5)
    expect(strike.duration).toBeLessThan(1)

    const during = recordingContext()
    strike.draw(during.context, 0.08)
    expect(during.calls.filter((call) => call === 'stroke').length).toBeGreaterThan(10)

    const after = recordingContext()
    strike.draw(after.context, strike.duration)
    expect(after.calls).toEqual(['clearRect'])
  })

  it('strikes the same way for the same seed, and differently for another', () => {
    const draw = (seed: string): string[] => {
      const { context, calls } = recordingContext()
      createTerminalStrike(palette, seed, 600, 300).draw(context, 0.2)
      return calls
    }
    expect(draw('a')).toEqual(draw('a'))
    const paths = (seed: string): unknown => {
      const points: number[] = []
      const { context } = recordingContext()
      const recording = new Proxy(context, {
        get: (target, key: string) => key === 'lineTo' ? (x: number, y: number) => points.push(x, y) : Reflect.get(target, key)
      })
      createTerminalStrike(palette, seed, 600, 300).draw(recording, 0.05)
      return points
    }
    expect(paths('a')).not.toEqual(paths('b'))
  })
})

describe('the lightning over a terminal pane', () => {
  const roots: Root[] = []
  const render = async (): Promise<void> => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => root.render(createElement(TerminalStrike, { terminalId: 't1' })))
  }
  const canvas = (): HTMLElement | null => document.body.querySelector('[data-testid="fancy-terminal-strike"]')

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    play.mockClear()
    useFancyMode.setState({ settings: DEFAULT_FANCY_SETTINGS })
  })
  afterEach(async () => {
    await act(async () => roots.splice(0).forEach((root) => root.unmount()))
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('is there only while fancy mode and its terminal lightning are both on', async () => {
    await render()
    expect(canvas()).toBeNull()
    await act(async () => useFancyMode.getState().update({ enabled: true }))
    expect(canvas()!.className).toContain('pointer-events-none')
    expect(canvas()!.getAttribute('aria-hidden')).toBe('true')
    await act(async () => useFancyMode.getState().update({ terminalStrikes: false }))
    expect(canvas()).toBeNull()
  })

  it('strikes when a command is entered in its terminal, cutting the last strike short', async () => {
    useFancyMode.setState({ settings: { ...DEFAULT_FANCY_SETTINGS, enabled: true } })
    await render()
    noteTerminalInput('t2', '\r', false)
    expect(play).not.toHaveBeenCalled()
    noteTerminalInput('t1', '\r', false)
    expect(play).toHaveBeenCalledTimes(1)
    expect(play.mock.calls[0]![0]).toBe(canvas())
    const first = play.mock.results[0]!.value as ReturnType<typeof vi.fn>
    noteTerminalInput('t1', '\r', false)
    expect(first).toHaveBeenCalled()
    expect(play).toHaveBeenCalledTimes(2)

    // Turned off, it stops listening.
    await act(async () => useFancyMode.getState().update({ enabled: false }))
    noteTerminalInput('t1', '\r', false)
    expect(play).toHaveBeenCalledTimes(2)
  })
})
