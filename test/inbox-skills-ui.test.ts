// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatComposer } from '../src/renderer/components/inbox/ChatComposer'
import type { ChatDraft, ChatDraftRequest, ChatSkill } from '../src/shared/types'

let dispose: (() => void) | undefined
afterEach(async () => { await act(async () => dispose?.()); vi.unstubAllGlobals(); document.body.innerHTML = '' })

const skills: ChatSkill[] = [
  { id: 'code-review', name: 'Code Review', description: 'Review a diff' },
  { id: 'demo', name: 'demo', description: 'A demo skill' },
  { id: 'deploy', name: 'Deploy', description: 'Ship it' },
]

async function setup({ initial = '', list = skills, disabled = false }: { initial?: string; list?: ChatSkill[]; disabled?: boolean } = {}) {
  let draft: ChatDraft = { text: initial, revision: 0, attachments: [] }
  const request = vi.fn(async (input: ChatDraftRequest) => {
    if (input.action === 'text') draft = { ...draft, text: input.text, revision: draft.revision + 1 }
    return draft
  })
  Object.defineProperty(window, 'api', { configurable: true, value: { chat: { draft: request } } })
  const send = vi.fn(async () => {})
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  dispose = () => root.unmount()
  await act(async () => root.render(createElement(ChatComposer, {
    draftKey: 'thread:ses_one', agent: 'build', model: { id: 'm', providerId: 'p' }, disabled,
    options: { status: 'ready', value: { agents: [], models: [], defaultModel: null, defaultAgent: null, skills: list } },
    onAgentChange: () => {}, onModelChange: () => {}, onSend: send,
  })))
  const box = container.querySelector('textarea')!
  return { container, box, request, send }
}

/** Types the way a person does: the box takes the new text with the caret at `caret`. */
async function type(box: HTMLTextAreaElement, value: string, caret = value.length) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, value)
    box.setSelectionRange(caret, caret)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
/** Clicks into the box at `caret`. React reports a moved caret on the key or mouse release of the focused box. */
async function moveCaret(box: HTMLTextAreaElement, caret: number) {
  await act(async () => { box.focus() })
  await act(async () => {
    box.setSelectionRange(caret, caret)
    box.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
}
async function press(box: HTMLTextAreaElement, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  await act(async () => { box.dispatchEvent(event) })
  return event
}
const list = (container: HTMLElement) => container.querySelector('[data-testid="skill-picker"]')
const options = (container: HTMLElement) => Array.from(container.querySelectorAll('[role="option"]')).map((option) => option.getAttribute('data-testid')?.replace('skill-option-', ''))

describe('the $ skill picker in the message box', () => {
  it('stays closed until a word starts with $', async () => {
    const { container, box } = await setup()
    await type(box, 'review the diff')
    expect(list(container)).toBeNull()
    await type(box, 'cost$5')
    expect(list(container)).toBeNull()
  })

  it('offers the skills that fit what follows the $, best match first', async () => {
    const { container, box } = await setup()
    await type(box, 'please use $de')
    expect(list(container)?.getAttribute('role')).toBe('listbox')
    expect(options(container)).toEqual(['demo', 'deploy', 'code-review'])
    expect(container.querySelector('[role="option"]')?.textContent).toContain('A demo skill')
    expect(box.getAttribute('aria-controls')).toBe(list(container)?.id)
    expect(box.getAttribute('aria-activedescendant')).toBe(container.querySelector('[role="option"][aria-selected="true"]')?.id)
    await type(box, 'please use $')
    expect(options(container)).toEqual(['code-review', 'demo', 'deploy'])
    await type(box, 'please use $zzz')
    expect(list(container)).toBeNull()
  })

  it('moves with the arrow keys, wrapping around, and inserts the skill with Enter instead of sending', async () => {
    const { container, box, send, request } = await setup()
    await type(box, 'use $de')
    expect(container.querySelector('[aria-selected="true"]')?.getAttribute('data-testid')).toBe('skill-option-demo')
    const down = await press(box, 'ArrowDown')
    expect(down.defaultPrevented).toBe(true)
    expect(container.querySelector('[aria-selected="true"]')?.getAttribute('data-testid')).toBe('skill-option-deploy')
    await press(box, 'ArrowDown')
    await press(box, 'ArrowDown')
    expect(container.querySelector('[aria-selected="true"]')?.getAttribute('data-testid')).toBe('skill-option-demo')
    await press(box, 'ArrowUp')
    expect(container.querySelector('[aria-selected="true"]')?.getAttribute('data-testid')).toBe('skill-option-code-review')
    await press(box, 'ArrowDown')
    const enter = await press(box, 'Enter')
    expect(enter.defaultPrevented).toBe(true)
    expect(box.value).toBe('use $demo ')
    expect(box.selectionStart).toBe(10)
    expect(list(container)).toBeNull()
    expect(send).not.toHaveBeenCalled()
    expect(request).toHaveBeenLastCalledWith({ key: 'thread:ses_one', action: 'text', text: 'use $demo ' })
  })

  it('inserts with Tab too, but leaves Shift+Tab and Shift+Enter to the page', async () => {
    const { container, box } = await setup()
    await type(box, '$dep')
    expect((await press(box, 'Tab', { shiftKey: true })).defaultPrevented).toBe(false)
    expect((await press(box, 'Enter', { shiftKey: true })).defaultPrevented).toBe(false)
    expect(list(container)).not.toBeNull()
    await press(box, 'Tab')
    expect(box.value).toBe('$deploy ')
  })

  it('inserts the skill that is clicked, without taking the caret out of the box', async () => {
    const { container, box, send } = await setup()
    await type(box, '$de')
    const option = container.querySelector<HTMLElement>('[data-testid="skill-option-deploy"]')!
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    await act(async () => { option.dispatchEvent(down) })
    expect(down.defaultPrevented).toBe(true)
    await act(async () => option.click())
    expect(box.value).toBe('$deploy ')
    expect(send).not.toHaveBeenCalled()
  })

  it('follows the mouse', async () => {
    const { container, box } = await setup()
    await type(box, '$')
    await act(async () => { container.querySelector('[data-testid="skill-option-deploy"]')!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })) })
    expect(container.querySelector('[aria-selected="true"]')?.getAttribute('data-testid')).toBe('skill-option-deploy')
  })

  it('closes on Escape without anything else hearing it, and stays closed until the word is gone', async () => {
    const { container, box } = await setup()
    const heard = vi.fn()
    document.body.addEventListener('keydown', heard)
    await type(box, 'use $de')
    const escape = await press(box, 'Escape')
    expect(escape.defaultPrevented).toBe(true)
    expect(heard).not.toHaveBeenCalled()
    expect(list(container)).toBeNull()
    expect(box.value).toBe('use $de')
    await type(box, 'use $dem')
    expect(list(container)).toBeNull()
    await type(box, 'use ')
    await type(box, 'use $d')
    expect(list(container)).not.toBeNull()
    // With the list closed, Escape is not the box's to keep.
    await type(box, 'use ')
    await press(box, 'Escape')
    expect(heard).toHaveBeenCalledTimes(1)
    document.body.removeEventListener('keydown', heard)
  })

  it('does not get in the way of ordinary $ text: with no match Enter sends', async () => {
    const { container, box, send } = await setup()
    await type(box, 'echo $HOME')
    expect(list(container)).toBeNull()
    await press(box, 'Enter')
    expect(send).toHaveBeenCalledWith('echo $HOME', { attachmentIds: [], draftRevision: expect.any(Number) })
  })

  it('sends a message that names a skill as typed, once the word is finished', async () => {
    const { container, box, send } = await setup()
    await type(box, 'run $demo now')
    expect(list(container)).toBeNull()
    await press(box, 'Enter')
    expect(send).toHaveBeenCalledWith('run $demo now', expect.anything())
  })

  it('leaves keys alone while an input method is composing', async () => {
    const { container, box, send } = await setup()
    await type(box, '$de')
    const enter = await press(box, 'Enter', { isComposing: true })
    expect(enter.defaultPrevented).toBe(false)
    expect(box.value).toBe('$de')
    expect(send).not.toHaveBeenCalled()
    expect(list(container)).not.toBeNull()
  })

  it('follows the caret between words', async () => {
    const { container, box } = await setup()
    await type(box, 'use $de and more')
    expect(list(container)).toBeNull()
    await moveCaret(box, 7)
    expect(options(container)).toEqual(['demo', 'deploy', 'code-review'])
    await moveCaret(box, 16)
    expect(list(container)).toBeNull()
  })

  it('does not open for a draft that was only loaded', async () => {
    const { container, box } = await setup({ initial: 'old draft $de' })
    expect(box.value).toBe('old draft $de')
    expect(list(container)).toBeNull()
    await moveCaret(box, 13)
    expect(options(container)).toEqual(['demo', 'deploy', 'code-review'])
  })

  it('has nothing to offer when OpenCode has no skills, or while the box is off', async () => {
    const none = await setup({ list: [] })
    await type(none.box, '$de')
    expect(list(none.container)).toBeNull()
    await act(async () => dispose?.())
    document.body.innerHTML = ''
    const off = await setup({ disabled: true })
    await type(off.box, '$de')
    expect(list(off.container)).toBeNull()
  })
})
