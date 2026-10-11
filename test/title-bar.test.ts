// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TitleBar, TitleBarButton } from '../src/renderer/components/TitleBar'
import { useWorkspace } from '../src/renderer/store/workspace'

const roots: Root[] = []
const containers: HTMLDivElement[] = []

function renderBar(onAction = vi.fn()): HTMLElement {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)

  act(() => {
    root.render(createElement(
      TitleBar,
      { icon: createElement('svg', { 'data-testid': 'bar-icon' }), title: 'mde' },
      createElement(TitleBarButton, { 'aria-label': 'Act', onClick: onAction }, 'Act')
    ))
  })

  return container
}

describe('TitleBar', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    useWorkspace.setState({ platform: null })
  })

  afterEach(() => {
    act(() => {
      roots.splice(0).forEach((root) => root.unmount())
    })
    containers.splice(0).forEach((container) => container.remove())
    document.body.replaceChildren()
    useWorkspace.setState({ platform: null })
    vi.unstubAllGlobals()
  })

  it('is a draggable bar exactly as tall as the native window buttons', () => {
    const bar = renderBar().querySelector<HTMLElement>('[data-testid="title-bar"]')

    expect(bar?.tagName).toBe('HEADER')
    expect(bar?.className).toContain('app-drag')
    // Its height comes from env(titlebar-area-height) in index.css under this class, so it
    // matches the native buttons at any zoom. A fixed height class would drift from them.
    expect(bar?.className).toContain('title-bar')
    expect(bar?.className).not.toMatch(/(^|\s)h-\d+/)
    expect(bar?.className).toContain('bg-panel')
  })

  it('shows the icon and title', () => {
    const container = renderBar()

    expect(container.querySelector('[data-testid="bar-icon"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="title-bar"]')?.textContent).toContain('mde')
  })

  it('keeps its content out from under the native window buttons', () => {
    const content = renderBar().querySelector<HTMLElement>('[data-testid="title-bar-content"]')

    // The env(titlebar-area-*) rules live in index.css under this class.
    expect(content?.className).toContain('title-bar-content')
  })

  it('lets actions receive clicks despite the drag region', () => {
    const onAction = vi.fn()
    const action = renderBar(onAction).querySelector<HTMLElement>('[aria-label="Act"]')

    expect(action?.className).toContain('app-no-drag')
    expect(action?.getAttribute('type')).toBe('button')
    act(() => action?.click())

    expect(onAction).toHaveBeenCalledOnce()
  })

  it('leaves room for the macOS traffic lights only on macOS', () => {
    const insetOf = (): string =>
      renderBar().querySelector<HTMLElement>('[data-testid="title-bar-content"]')?.style.paddingLeft ?? ''

    expect(insetOf()).toBe('')

    useWorkspace.setState({ platform: { platform: 'darwin', isWindows: false } })
    act(() => roots.splice(0).forEach((root) => root.unmount()))
    containers.splice(0).forEach((container) => container.remove())
    expect(insetOf()).toBe('78px')
  })
})
