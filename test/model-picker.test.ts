// @vitest-environment happy-dom

import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelPicker } from '../src/renderer/components/inbox/ModelPicker'
import type { ChatModel, OpenCodeModelRef } from '../src/shared/types'

const reasoner: ChatModel = { id: 'reasoner', providerId: 'p', providerName: 'Provider', name: 'Reasoner', variants: ['low', 'high', 'deep-review', 'none'] }
const fixed: ChatModel = { id: 'fixed-high', providerId: 'local', providerName: 'Local', name: 'Fixed high' }
const other: ChatModel = { id: 'other', providerId: 'p', providerName: 'Provider', name: 'Other', variants: ['max'] }
let root: Root
let container: HTMLDivElement
const changed = vi.fn()

async function render(models: ChatModel[] = [reasoner, fixed, other], initial: OpenCodeModelRef | null = { id: reasoner.id, providerId: reasoner.providerId }): Promise<void> {
  function Harness(): JSX.Element {
    const [value, setValue] = useState(initial)
    return createElement(ModelPicker, { models, value, onChange: (next) => { changed(next); setValue(next) } })
  }
  await act(async () => root.render(createElement(Harness)))
}

const trigger = (): HTMLButtonElement => container.querySelector('[data-testid="chat-model-picker"]')!
async function open(): Promise<void> {
  await act(async () => trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
}
const menu = (): HTMLElement | null => document.querySelector('[data-testid="chat-model-menu"]')
function item(label: string, role = 'menuitemradio'): HTMLElement {
  const found = Array.from(document.querySelectorAll<HTMLElement>(`[role="${role}"]`))
    .find((item) => item.textContent?.trim() === label || item.textContent?.trim() === `${label}Use model settings`)
  if (!found) throw new Error(`No ${role}: ${label}`)
  return found
}
async function click(label: string, role?: string): Promise<void> {
  await act(async () => item(label, role).click())
}
async function browse(label: string): Promise<void> {
  await act(async () => item(label, 'menuitem').focus())
}

describe('model and reasoning menu', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    changed.mockClear()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.replaceChildren()
    vi.unstubAllGlobals()
  })

  it('offers only reported variants, shows the chosen effort, and restores it on reopen', async () => {
    await render()
    await open()
    expect(Array.from(document.querySelectorAll('[role="menuitemradio"]')).map((item) => item.textContent))
      .toEqual(['DefaultUse model settings', 'Low', 'High', 'Deep review', 'None'])
    expect(item('Default').getAttribute('aria-checked')).toBe('true')
    await click('Deep review')
    expect(changed).toHaveBeenLastCalledWith({ id: reasoner.id, providerId: reasoner.providerId, variant: 'deep-review' })
    expect(menu()).toBeNull()
    expect(trigger().textContent).toContain('ReasonerDeep review')
    await open()
    expect(item('Deep review').getAttribute('aria-checked')).toBe('true')
  })

  it('distinguishes Default (no override) from the None variant', async () => {
    await render()
    await open()
    await click('None')
    expect(changed).toHaveBeenLastCalledWith({ id: reasoner.id, providerId: reasoner.providerId, variant: 'none' })
    await open()
    await click('Default')
    expect(changed).toHaveBeenLastCalledWith({ id: reasoner.id, providerId: reasoner.providerId })
    expect(container.querySelector('[data-testid="chat-model-effort"]')).toBeNull()
  })

  it('browses without committing and can select another model and its effort in one choice', async () => {
    await render([reasoner, fixed, other], { id: reasoner.id, providerId: reasoner.providerId, variant: 'high' })
    await open()
    await browse('Other')
    expect(changed).not.toHaveBeenCalled()
    expect(item('Max')).toBeTruthy()
    expect(document.querySelector('[role="menuitemradio"][title="high"]')).toBeNull()
    await click('Max')
    expect(changed).toHaveBeenCalledExactlyOnceWith({ id: other.id, providerId: other.providerId, variant: 'max' })
  })

  it('selects a model with defaults and keeps its menu open to choose effort', async () => {
    await render()
    await open()
    await browse('Other')
    await click('Other', 'menuitem')
    expect(changed).toHaveBeenLastCalledWith({ id: other.id, providerId: other.providerId })
    expect(menu()).not.toBeNull()
    await click('Max')
    expect(changed).toHaveBeenLastCalledWith({ id: other.id, providerId: other.providerId, variant: 'max' })
  })

  it('keeps the effort when reselecting the current model and clears it when switching to a fixed preset', async () => {
    await render([reasoner, fixed], { id: reasoner.id, providerId: reasoner.providerId, variant: 'high' })
    await open()
    await click('Reasoner', 'menuitem')
    expect(changed).toHaveBeenLastCalledWith({ id: reasoner.id, providerId: reasoner.providerId, variant: 'high' })
    await browse('Fixed high')
    expect(document.querySelector('[role="menuitemradio"]')).toBeNull()
    await click('Fixed high', 'menuitem')
    expect(changed).toHaveBeenLastCalledWith({ id: fixed.id, providerId: fixed.providerId })
    expect(menu()).toBeNull()
  })

  it('has no effort pane for a list of fixed presets', async () => {
    await render([fixed], null)
    await open()
    expect(document.querySelector('[data-testid="chat-model-reasoning"]')).toBeNull()
    await click('Fixed high', 'menuitem')
    expect(changed).toHaveBeenCalledExactlyOnceWith({ id: fixed.id, providerId: fixed.providerId })
  })

  it('searches and resets the query on dismissal without changing the selection', async () => {
    await render()
    await open()
    const input = document.querySelector<HTMLInputElement>('[aria-label="Search models"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Fixed')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(document.querySelector('[data-testid="chat-model-list"]')?.textContent).not.toContain('Reasoner')
    expect(document.querySelector('[role="menuitemradio"]')).toBeNull()
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(changed).not.toHaveBeenCalled()
    await open()
    expect(document.querySelector<HTMLInputElement>('[aria-label="Search models"]')?.value).toBe('')
  })

  it('moves between models and effort with the arrow keys and selects with Enter', async () => {
    await render()
    await open()
    await browse('Reasoner')
    await act(async () => item('Reasoner', 'menuitem').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(document.activeElement).toBe(item('Default'))
    await act(async () => item('Default').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })))
    expect(document.activeElement).toBe(item('Reasoner', 'menuitem'))
    await act(async () => {
      item('High').focus()
      item('High').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(changed).toHaveBeenLastCalledWith({ id: reasoner.id, providerId: reasoner.providerId, variant: 'high' })
  })
})
