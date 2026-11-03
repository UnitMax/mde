// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatComposer } from '../src/renderer/components/inbox/ChatComposer'
import type { ChatDraft, ChatDraftRequest } from '../src/shared/types'

let dispose: (() => void) | undefined
afterEach(async () => { await act(async () => dispose?.()); vi.unstubAllGlobals(); document.body.innerHTML = '' })
async function setup(fail = false) {
  let draft: ChatDraft = { text: '', revision: 0, attachments: [] }
  const request = vi.fn(async (input: ChatDraftRequest) => {
    if (input.action === 'text') draft = { ...draft, text: input.text, revision: draft.revision + 1 }
    if (input.action === 'add' || input.action === 'tree') draft = { ...draft, revision: draft.revision + 1, attachments: [...draft.attachments, { id: 'file-one', name: input.action === 'add' ? input.name : 'source.ts', mime: 'image/png', size: 3, thumbnail: 'data:image/png;base64,eA==' }] }
    if (input.action === 'remove') draft = { ...draft, revision: draft.revision + 1, attachments: [] }
    return draft
  })
  Object.defineProperty(window, 'api', { configurable: true, value: { chat: { draft: request } } })
  const send = vi.fn(async () => { if (fail) throw new Error('Service unavailable') })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  dispose = () => root.unmount()
  await act(async () => root.render(createElement(ChatComposer, {
    draftKey: 'thread:ses_one', agent: 'build', model: { id: 'm', providerId: 'p' },
    options: { status: 'ready', value: { agents: [], models: [], defaultModel: null, defaultAgent: null, skills: [] } },
    onAgentChange: () => {}, onModelChange: () => {}, onSend: send,
  })))
  return { container, request, send }
}
function image() { return new File([new Uint8Array([1, 2, 3])], 'screen.png', { type: 'image/png' }) }
async function paste(container: HTMLElement) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { files: [image()] } })
  await act(async () => container.querySelector('textarea')!.dispatchEvent(event))
}
describe('Inbox attachment inputs', () => {
  it('opens the chooser and stages selected files with removable thumbnails', async () => {
    const { container, request } = await setup()
    const input = container.querySelector<HTMLInputElement>('input[type=file]')!
    const click = vi.spyOn(input, 'click')
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Attach files"]')!.click())
    expect(click).toHaveBeenCalled()
    Object.defineProperty(input, 'files', { configurable: true, value: [image()] })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ action: 'add', name: 'screen.png', data: new Uint8Array([1, 2, 3]) }))
    expect(container.querySelector('img')?.alt).toBe('screen.png')
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Remove screen.png"]')!.click())
    expect(container.querySelector('img')).toBeNull()
  })
  it('sends pasted images without text and retains them after failure', async () => {
    const { container, send } = await setup(true)
    await paste(container)
    const button = container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!
    expect(button.disabled).toBe(false)
    await act(async () => button.click())
    expect(send).toHaveBeenCalledWith('', { attachmentIds: ['file-one'], draftRevision: 2 })
    expect(container.querySelector('img')).not.toBeNull()
    expect(container.textContent).toContain('Service unavailable')
  })
  it('accepts external file-manager drops', async () => {
    const { container, request } = await setup()
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], items: [], files: [image()], getData: () => '' } })
    await act(async () => container.querySelector('[data-testid="chat-composer"]')!.dispatchEvent(drop))
    expect(drop.defaultPrevented).toBe(true)
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ action: 'add', name: 'screen.png' }))
  })
  it('accepts MDE sidebar drops through the typed source reference', async () => {
    const { container, request } = await setup()
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: { types: ['application/x-mde-file-tree-entry'], items: [], getData: () => JSON.stringify({ sessionId: 'fld_app', path: 'src/source.ts' }) } })
    await act(async () => container.querySelector('[data-testid="chat-composer"]')!.dispatchEvent(drop))
    expect(request).toHaveBeenCalledWith({ key: 'thread:ses_one', action: 'tree', sessionId: 'fld_app', path: 'src/source.ts' })
    expect(container.textContent).toContain('source.ts')
  })
})
