// @vitest-environment happy-dom
import { act, createElement, Profiler } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScrollStrip } from '../src/renderer/components/ui/scroll-strip'

let root: Root
let container: HTMLDivElement
let layout: { clientWidth: number; scrollWidth: number }
const list = (): HTMLDivElement => container.querySelector<HTMLDivElement>('[role="tablist"]')!
const button = (side: 'start' | 'end'): HTMLButtonElement | null => container.querySelector(`[data-testid="scroll-strip-${side}"]`)
const render = (selected = 'a'): Promise<void> => act(async () => root.render(
  createElement(ScrollStrip, { role: 'tablist', 'aria-label': 'Tabs', revealKey: selected },
    ...['a', 'b', 'c', 'd'].map((id) => createElement('button', { key: id, role: 'tab', 'aria-selected': id === selected, 'data-id': id }, id)))
))
const scroll = (left: number): Promise<void> => act(async () => {
  list().scrollLeft = left
  list().dispatchEvent(new Event('scroll'))
})

beforeEach(async () => {
  layout = { clientWidth: 200, scrollWidth: 200 }
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return this.getAttribute('role') === 'tablist' ? layout.clientWidth : 0 } })
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get() { return this.getAttribute('role') === 'tablist' ? layout.scrollWidth : 0 } })
  Object.defineProperty(HTMLElement.prototype, 'offsetLeft', { configurable: true, get() { return (Number(this.getAttribute('data-id')?.charCodeAt(0)) - 97) * 100 } })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return this.hasAttribute('data-id') ? 90 : 0 } })
  HTMLElement.prototype.scrollTo = function (this: HTMLElement, options?: ScrollToOptions | number) {
    this.scrollLeft = typeof options === 'object' ? options.left ?? 0 : 0
    this.dispatchEvent(new Event('scroll'))
  } as typeof HTMLElement.prototype.scrollTo
  HTMLElement.prototype.scrollBy = function (this: HTMLElement, options?: ScrollToOptions | number) {
    this.scrollLeft += typeof options === 'object' ? options.left ?? 0 : 0
    this.dispatchEvent(new Event('scroll'))
  } as typeof HTMLElement.prototype.scrollBy
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  ;['clientWidth', 'scrollWidth', 'offsetLeft', 'offsetWidth', 'scrollTo', 'scrollBy'].forEach((name) => Reflect.deleteProperty(HTMLElement.prototype, name))
  vi.unstubAllGlobals()
})

describe('ScrollStrip', () => {
  it('is one plain row with no arrows or fade while everything fits', async () => {
    await render()
    expect(list().getAttribute('data-overflow')).toBe('none')
    expect(button('start')).toBeNull()
    expect(button('end')).toBeNull()
    expect(list().style.maskImage).toBe('')
    expect(list().className).not.toContain('flex-wrap')
  })

  it('keeps the role and label it is given on the list', async () => {
    await render()
    expect(list().getAttribute('aria-label')).toBe('Tabs')
  })

  it('shows both arrows when it overflows, the one on the scrolled-away side disabled at an end, and fades that end', async () => {
    layout.scrollWidth = 400
    await render()
    expect(list().getAttribute('data-overflow')).toBe('end')
    expect(button('start')!.disabled).toBe(true)
    expect(button('end')!.disabled).toBe(false)
    expect(list().style.maskImage).toContain('transparent')
    await scroll(100)
    expect(list().getAttribute('data-overflow')).toBe('both')
    expect(button('start')!.disabled).toBe(false)
    await scroll(200)
    expect(list().getAttribute('data-overflow')).toBe('start')
    expect(button('end')!.disabled).toBe(true)
  })

  it('settles when a neighbour takes room and the arrows appear, instead of updating without end', async () => {
    // A browser reports an element to every new observer, once, whatever has changed; the strip makes a new
    // one after every render. A button next to the strip takes room, and then its own arrows take more.
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: () => void) {}
      observe(): void { setTimeout(() => this.callback(), 0) }
      disconnect(): void {}
      unobserve(): void {}
    })
    let commits = 0
    const tree = (): ReturnType<typeof createElement> => createElement(Profiler, { id: 'strip', onRender: () => { commits += 1 } },
      createElement(ScrollStrip, { role: 'tablist', 'aria-label': 'Tabs', revealKey: 'd' },
        ...['a', 'b', 'c', 'd'].map((id) => createElement('button', { key: id, role: 'tab', 'aria-selected': id === 'd', 'data-id': id }, id))))
    layout = { clientWidth: 207, scrollWidth: 205 }
    await act(async () => root.render(tree()))
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() {
      return this.getAttribute('role') === 'tablist' ? (button('start') ? 135 : 179) : 0
    } })
    commits = 0
    await act(async () => root.render(tree()))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)) })
    expect(button('start')).not.toBeNull()
    expect(commits).toBeLessThan(8)
  })

  it('scrolls by most of its width with the arrows', async () => {
    layout.scrollWidth = 600
    await render()
    await act(async () => button('end')!.click())
    expect(list().scrollLeft).toBe(160)
    await act(async () => button('start')!.click())
    expect(list().scrollLeft).toBe(0)
  })

  it('turns the mouse wheel sideways, and leaves a sideways swipe to the browser', async () => {
    layout.scrollWidth = 400
    await render()
    await act(async () => { list().dispatchEvent(new WheelEvent('wheel', { deltaY: 60, bubbles: true, cancelable: true })) })
    expect(list().scrollLeft).toBe(60)
    await act(async () => { list().dispatchEvent(new WheelEvent('wheel', { deltaX: 80, deltaY: 10, bubbles: true, cancelable: true })) })
    expect(list().scrollLeft).toBe(60)
  })

  it('scrolls the selected item into view when the selection changes', async () => {
    layout.scrollWidth = 400
    await render('a')
    expect(list().scrollLeft).toBe(0)
    await render('d')
    // d spans 300..390; it ends 20 px of fade past the right edge.
    expect(list().scrollLeft).toBe(390 + 20 - 200)
    await render('a')
    expect(list().scrollLeft).toBe(0)
  })
})

describe('ScrollStrip arrows taking room', () => {
  it('brings the selected item back into view when the arrows appear and narrow the list', async () => {
    layout.clientWidth = 500
    layout.scrollWidth = 500
    await render('d')
    expect(list().scrollLeft).toBe(0)
    layout.scrollWidth = 600
    layout.clientWidth = 160
    await scroll(0)
    expect(list().scrollLeft).toBe(390 + 20 - 160)
  })
})
