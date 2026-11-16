// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WslResourceSample } from '../src/shared/ipc'
import { WslResourceMeter } from '../src/renderer/components/WslResourceMeter'

const GB = 1024 ** 3
const running: WslResourceSample = {
  state: 'running',
  distro: 'Ubuntu',
  cpu: 0.42,
  cores: [0.8, 0.04],
  coreCount: 2,
  memoryTotal: 16 * GB,
  memoryUsed: 4 * GB,
  swapTotal: 0,
  swapUsed: 0,
}

describe('WslResourceMeter', () => {
  let root: Root
  let container: HTMLDivElement
  let send: (sample: WslResourceSample) => void
  const watchResources = vi.fn(async () => undefined)
  const unsubscribe = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    watchResources.mockClear()
    unsubscribe.mockClear()
    vi.stubGlobal('api', {
      wsl: {
        watchResources,
        onResources: (listener: (sample: WslResourceSample) => void) => {
          send = listener
          return unsubscribe
        },
      },
    })
    Object.assign(window, { api: (globalThis as unknown as { api: unknown }).api })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root.render(createElement(WslResourceMeter)))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  const meter = (): HTMLElement | null => container.querySelector('[data-testid="wsl-resource-meter"]')

  it('asks for readings while it is shown and stops them when it goes', () => {
    expect(watchResources).toHaveBeenCalledWith(true)
    act(() => root.unmount())
    expect(watchResources).toHaveBeenLastCalledWith(false)
    expect(unsubscribe).toHaveBeenCalled()
    root = createRoot(container)
  })

  it('shows the processor load and the memory in use', () => {
    act(() => send(running))
    expect(meter()?.tagName).toBe('BUTTON')
    expect(container.querySelector('[data-testid="wsl-resource-cpu"]')?.textContent).toBe('42%')
    expect(container.querySelector('[data-testid="wsl-resource-memory"]')?.textContent).toBe('4.0 GB')
    expect(meter()?.getAttribute('aria-label')).toBe('WSL: CPU 42%, memory 4.0 GB of 16.0 GB')
  })

  it('waits for the second reading before it names a load', () => {
    act(() => send({ ...running, cpu: null, cores: [] }))
    expect(container.querySelector('[data-testid="wsl-resource-cpu"]')?.textContent).toBe('…')
    expect(container.querySelector('[data-testid="wsl-resource-memory"]')?.textContent).toBe('4.0 GB')
  })

  it('says so when no distro is running, and is not a button then', () => {
    act(() => send({ state: 'stopped' }))
    expect(meter()?.tagName).toBe('SPAN')
    expect(meter()?.textContent).toBe('WSL idle')
  })

  it('shows nothing where there is no WSL', () => {
    act(() => send({ state: 'unavailable' }))
    expect(meter()).toBeNull()
  })
})
