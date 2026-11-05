// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxFolder } from '../src/shared/types'
import { AddInboxFolderDialog } from '../src/renderer/components/inbox/AddInboxFolderDialog'
import { useInboxChat } from '../src/renderer/store/inbox-chat'
import { useWorkspace } from '../src/renderer/store/workspace'

const roots: Root[] = []
const nativeBrowse = vi.fn()
const resolve = vi.fn()
const validate = vi.fn()
const listWslDirectories = vi.fn()
const addFolder = vi.fn()
const onOpenChange = vi.fn()
const onAdded = vi.fn()

const ubuntu = { name: 'Ubuntu-24.04', state: 'Running', version: 2, isDefault: true }
const debian = { name: 'Debian', state: 'Stopped', version: 2, isDefault: false }

function folder(overrides: Partial<InboxFolder> = {}): InboxFolder {
  return { id: 'fld_1', name: 'app', directory: '/home/me/app', target: { kind: 'wsl', distro: 'Ubuntu-24.04' }, ...overrides } as InboxFolder
}

async function mount(element: ReturnType<typeof createElement>): Promise<Root> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(element))
  return root
}

function button(label: string, scope: ParentNode = document): HTMLButtonElement {
  const found = Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find(
    (item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label,
  )
  if (!found) throw new Error(`Missing button ${label}`)
  return found
}

async function click(target: Element): Promise<void> {
  await act(async () => (target as HTMLElement).click())
}

function browser(): Element | null {
  return document.querySelector('[data-testid="wsl-folder-browser"]')
}

function folderRows(): string[] {
  return Array.from(document.querySelectorAll('[data-testid="wsl-folder-row"]')).map((item) => item.textContent ?? '')
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  nativeBrowse.mockReset().mockResolvedValue(null)
  resolve.mockReset().mockImplementation(async (request: { rawPath: string }) => ({ path: request.rawPath }))
  validate.mockReset().mockResolvedValue({ exists: true })
  listWslDirectories.mockReset().mockImplementation(async (request: { path?: string }) =>
    request.path === '/home/me/src'
      ? { path: '/home/me/src', directories: ['app'], truncated: false }
      : { path: '/home/me', directories: ['src'], truncated: false })
  addFolder.mockReset().mockImplementation(async () => folder())
  onOpenChange.mockReset()
  onAdded.mockReset()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { paths: { browse: nativeBrowse, resolve, validate, listWslDirectories } },
  })
})

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('Inbox add-folder dialog on Windows', () => {
  beforeEach(() => {
    useWorkspace.setState({
      platform: { platform: 'win32', isWindows: true },
      distros: [ubuntu, debian],
      refreshDistros: vi.fn(async () => undefined),
    })
    useInboxChat.setState({ addFolder })
  })

  it('browses the distro’s own folders instead of opening the Windows file dialog', async () => {
    await mount(createElement(AddInboxFolderDialog, { open: true, onOpenChange, onAdded }))
    expect(browser()).toBeNull()

    await click(button('Browse'))

    expect(nativeBrowse).not.toHaveBeenCalled()
    expect(browser()).not.toBeNull()
    expect(document.body.textContent).toContain('Choose a folder in Ubuntu-24.04')
    expect(listWslDirectories).toHaveBeenCalledWith({ distro: 'Ubuntu-24.04' })
    expect(folderRows()).toEqual(['src'])
  })

  it('puts the chosen folder in the field and adds exactly that folder', async () => {
    await mount(createElement(AddInboxFolderDialog, { open: true, onOpenChange, onAdded }))
    await click(button('Browse'))
    await click(document.querySelector('[data-testid="wsl-folder-row"]')!)

    await click(button('Choose this folder'))

    expect(browser()).toBeNull()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(document.querySelector<HTMLInputElement>('#inbox-folder-path')!.value).toBe('/home/me/src')

    await click(button('Add project'))
    expect(addFolder).toHaveBeenCalledWith({ kind: 'wsl', distro: 'Ubuntu-24.04', path: '/home/me/src' })
    expect(onAdded).toHaveBeenCalled()
  })

  it('starts the browser in the folder that was typed', async () => {
    await mount(createElement(AddInboxFolderDialog, { open: true, onOpenChange, onAdded }))
    const input = document.querySelector<HTMLInputElement>('#inbox-folder-path')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '/home/me/src')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    await click(button('Browse'))

    expect(listWslDirectories).toHaveBeenCalledWith({ distro: 'Ubuntu-24.04', path: '/home/me/src' })
  })

  it('leaves the field alone when the browser is cancelled', async () => {
    await mount(createElement(AddInboxFolderDialog, { open: true, onOpenChange, onAdded }))
    await click(button('Browse'))

    await click(button('Cancel', browser()!))

    expect(browser()).toBeNull()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(document.querySelector<HTMLInputElement>('#inbox-folder-path')!.value).toBe('')
  })

  it('does not offer to browse before a distro is known', async () => {
    useWorkspace.setState({ distros: [] })
    await mount(createElement(AddInboxFolderDialog, { open: true, onOpenChange, onAdded }))

    expect(button('Browse').disabled).toBe(true)
  })

  it('closes the browser together with the dialog', async () => {
    const root = await mount(createElement(AddInboxFolderDialog, { open: true, onOpenChange, onAdded }))
    await click(button('Browse'))
    expect(browser()).not.toBeNull()

    await act(async () => root.render(createElement(AddInboxFolderDialog, { open: false, onOpenChange, onAdded })))

    expect(browser()).toBeNull()
  })
})

describe('Inbox add-folder dialog on macOS', () => {
  it('keeps using the system folder dialog', async () => {
    useWorkspace.setState({
      platform: { platform: 'darwin', isWindows: false },
      distros: [],
      refreshDistros: vi.fn(async () => undefined),
    })
    useInboxChat.setState({ addFolder })
    nativeBrowse.mockResolvedValue('/Users/me/src/app/')
    resolve.mockResolvedValue({ path: '/Users/me/src/app' })
    await mount(createElement(AddInboxFolderDialog, { open: true, onOpenChange, onAdded }))

    await click(button('Browse'))

    expect(nativeBrowse).toHaveBeenCalledTimes(1)
    expect(resolve).toHaveBeenCalledWith({ kind: 'native', rawPath: '/Users/me/src/app/' })
    expect(browser()).toBeNull()
    expect(listWslDirectories).not.toHaveBeenCalled()
    expect(document.querySelector<HTMLInputElement>('#inbox-folder-path')!.value).toBe('/Users/me/src/app')
  })
})
