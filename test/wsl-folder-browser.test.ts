// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WslDirectoryListing } from '../src/shared/types'
import type { ListWslDirectoriesRequest } from '../src/shared/ipc'
import { WslFolderBrowser } from '../src/renderer/components/WslFolderBrowser'
import { childFolder, folderCrumbs, parentFolder } from '../src/renderer/lib/wsl-folder'

const roots: Root[] = []
const onChoose = vi.fn()
const onOpenChange = vi.fn()

/** A small distro: the folders below each path, plus a few hidden ones. */
const tree: Record<string, string[]> = {
  '/': ['etc', 'home', 'srv'],
  '/home': ['me'],
  '/home/me': ['docs', 'src'],
  '/home/me/src': ['app', 'tools'],
  '/home/me/src/app': [],
  '/srv': [],
}
const hiddenTree: Record<string, string[]> = { '/home/me': ['.cache', '.config'] }

const list = vi.fn()

function answer(request: ListWslDirectoriesRequest): WslDirectoryListing {
  const path = request.path ?? '/home/me'
  const folders = tree[path]
  if (!folders) throw new Error('That folder does not exist.')
  const extra = request.hidden ? (hiddenTree[path] ?? []) : []
  return { path, directories: [...extra, ...folders].sort(), truncated: false }
}

async function render(props: Partial<Parameters<typeof WslFolderBrowser>[0]> = {}) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  let current = { open: true, onOpenChange, distro: 'Ubuntu-24.04', onChoose, ...props }
  const update = async (patch: Partial<typeof current> = {}) => {
    current = { ...current, ...patch }
    await act(async () => root.render(createElement(WslFolderBrowser, current)))
  }
  await update()
  return { update }
}

function rows(): string[] {
  return Array.from(document.querySelectorAll('[data-testid="wsl-folder-row"]')).map((item) => item.textContent ?? '')
}

function crumbs(): string[] {
  return Array.from(document.querySelectorAll('nav[aria-label="Folder path"] button')).map((item) => item.textContent ?? '')
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (item) => item.textContent === label || item.getAttribute('aria-label') === label,
  )
  if (!found) throw new Error(`Missing button ${label}`)
  return found
}

async function click(target: Element): Promise<void> {
  await act(async () => (target as HTMLElement).click())
}

async function open(name: string): Promise<void> {
  const row = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="wsl-folder-row"]')).find((item) => item.textContent === name)
  if (!row) throw new Error(`Missing folder ${name}`)
  await click(row)
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  list.mockReset().mockImplementation(async (request: ListWslDirectoriesRequest) => answer(request))
  onChoose.mockReset()
  onOpenChange.mockReset()
  Object.defineProperty(window, 'api', { configurable: true, value: { paths: { listWslDirectories: list } } })
})

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  // Radix returns focus on a zero-delay timer after a dialog unmounts. Let those run now, or one
  // would fire in the middle of the next test and move its focus.
  await act(async () => { await new Promise((done) => setTimeout(done, 0)) })
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('WslFolderBrowser', () => {
  it('opens in the distro home and shows only that distro’s folders', async () => {
    await render()

    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledWith({ distro: 'Ubuntu-24.04' })
    expect(document.body.textContent).toContain('Choose a folder in Ubuntu-24.04')
    expect(rows()).toEqual(['docs', 'src'])
    expect(crumbs()).toEqual(['/', 'home', 'me'])
    expect(document.body.textContent).toContain('/home/me')
  })

  it('starts in the folder that is already typed', async () => {
    await render({ startPath: '  /home/me/src ' })

    expect(list).toHaveBeenCalledWith({ distro: 'Ubuntu-24.04', path: '/home/me/src' })
    expect(rows()).toEqual(['app', 'tools'])
  })

  it('starts in the home folder when the typed folder does not exist', async () => {
    await render({ startPath: '/home/me/gone' })

    expect(list.mock.calls.map(([request]) => request)).toEqual([
      { distro: 'Ubuntu-24.04', path: '/home/me/gone' },
      { distro: 'Ubuntu-24.04' },
    ])
    expect(rows()).toEqual(['docs', 'src'])
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  it.each(['C:\\Users\\Me', '~/src', 'src', '\\\\wsl.localhost\\Ubuntu\\home\\me'])('does not start from %j, which is not a Linux path', async (startPath) => {
    await render({ startPath })

    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledWith({ distro: 'Ubuntu-24.04' })
  })

  it('opens a folder when it is clicked and chooses the folder it is in', async () => {
    await render()

    await open('src')
    expect(list).toHaveBeenLastCalledWith({ distro: 'Ubuntu-24.04', path: '/home/me/src' })
    expect(rows()).toEqual(['app', 'tools'])
    expect(crumbs()).toEqual(['/', 'home', 'me', 'src'])

    await click(button('Choose this folder'))
    expect(onChoose).toHaveBeenCalledTimes(1)
    expect(onChoose).toHaveBeenCalledWith('/home/me/src')
  })

  it('goes up with the parent button and with a breadcrumb', async () => {
    await render({ startPath: '/home/me/src/app' })
    expect(rows()).toEqual([])

    await click(button('Parent folder'))
    expect(list).toHaveBeenLastCalledWith({ distro: 'Ubuntu-24.04', path: '/home/me/src' })

    await click(button('home'))
    expect(list).toHaveBeenLastCalledWith({ distro: 'Ubuntu-24.04', path: '/home' })
    expect(rows()).toEqual(['me'])

    await click(button('/'))
    expect(list).toHaveBeenLastCalledWith({ distro: 'Ubuntu-24.04', path: '/' })
    expect(rows()).toEqual(['etc', 'home', 'srv'])
    expect(button('Parent folder').disabled).toBe(true)
  })

  it('returns to the home folder with the home button', async () => {
    await render({ startPath: '/srv' })

    await click(button('Home folder'))

    expect(list).toHaveBeenLastCalledWith({ distro: 'Ubuntu-24.04' })
    expect(rows()).toEqual(['docs', 'src'])
  })

  it('shows hidden folders on request and stays in the same folder', async () => {
    await render()
    const toggle = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(rows()).toEqual(['docs', 'src'])

    await click(toggle)

    expect(list).toHaveBeenLastCalledWith({ distro: 'Ubuntu-24.04', path: '/home/me', hidden: true })
    expect(rows()).toEqual(['.cache', '.config', 'docs', 'src'])

    await click(toggle)
    expect(list).toHaveBeenLastCalledWith({ distro: 'Ubuntu-24.04', path: '/home/me' })
    expect(rows()).toEqual(['docs', 'src'])
  })

  it('keeps asking for hidden folders while moving around', async () => {
    await render()
    await click(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!)

    await open('src')

    expect(list).toHaveBeenLastCalledWith({ distro: 'Ubuntu-24.04', path: '/home/me/src', hidden: true })
  })

  it('starts each opening fresh, without hidden folders and without the old folder', async () => {
    const { update } = await render()
    await click(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!)
    await open('src')
    await update({ open: false })
    list.mockClear()

    await update({ open: true })

    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledWith({ distro: 'Ubuntu-24.04' })
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false)
  })

  it('does not ask for anything while closed', async () => {
    await render({ open: false })

    expect(list).not.toHaveBeenCalled()
    expect(document.querySelector('[data-testid="wsl-folder-browser"]')).toBeNull()
  })

  it('says so for a folder without folders', async () => {
    await render({ startPath: '/srv' })

    expect(rows()).toEqual([])
    expect(document.body.textContent).toContain('No folders in here.')
  })

  it('says when the list was cut off', async () => {
    list.mockResolvedValue({ path: '/home/me', directories: ['a', 'b'], truncated: true })
    await render()

    expect(document.body.textContent).toContain('Only the first 2 folders are shown')
  })

  it('keeps the list and shows the problem when a folder cannot be opened', async () => {
    await render()
    list.mockRejectedValueOnce(new Error("Error invoking remote method 'path:list-wsl-directories': Error: Permission denied."))

    await open('docs')

    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Permission denied.')
    expect(rows()).toEqual(['docs', 'src'])
    expect(crumbs()).toEqual(['/', 'home', 'me'])
    await click(button('Choose this folder'))
    expect(onChoose).toHaveBeenCalledWith('/home/me')
  })

  it('offers the root when not even the home folder can be listed', async () => {
    list.mockRejectedValueOnce(new Error('Could not read the home directory of Ubuntu-24.04.'))
    await render()

    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Could not read the home directory of Ubuntu-24.04.')
    expect(button('Choose this folder').disabled).toBe(true)
    expect(rows()).toEqual([])

    await click(button('Browse from /'))

    expect(list).toHaveBeenLastCalledWith({ distro: 'Ubuntu-24.04', path: '/' })
    expect(rows()).toEqual(['etc', 'home', 'srv'])
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  it('does not let the folder be chosen, or another one opened, while a listing is loading', async () => {
    await render()
    let finish: (listing: WslDirectoryListing) => void = () => undefined
    list.mockImplementationOnce(() => new Promise<WslDirectoryListing>((resolve) => { finish = resolve }))

    await open('src')

    expect(button('Choose this folder').disabled).toBe(true)
    expect(document.querySelector<HTMLButtonElement>('[data-testid="wsl-folder-row"]')!.disabled).toBe(true)
    expect(document.querySelector('ul[aria-label="Folders"]')?.getAttribute('aria-busy')).toBe('true')

    await act(async () => finish({ path: '/home/me/src', directories: ['app'], truncated: false }))

    expect(button('Choose this folder').disabled).toBe(false)
    expect(rows()).toEqual(['app'])
  })

  it('ignores an answer that arrives after a newer request', async () => {
    await render()
    const toggle = (): HTMLInputElement => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    const late: Array<(listing: WslDirectoryListing) => void> = []
    list.mockImplementationOnce(() => new Promise<WslDirectoryListing>((resolve) => { late.push(resolve) }))

    await click(toggle())
    await click(toggle())
    expect(list).toHaveBeenLastCalledWith({ distro: 'Ubuntu-24.04', path: '/home/me' })
    await act(async () => late[0]?.({ path: '/home/me', directories: ['.stale'], truncated: false }))

    expect(rows()).toEqual(['docs', 'src'])
  })

  it('ignores a failure that arrives after a newer request', async () => {
    await render()
    const toggle = (): HTMLInputElement => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    const late: Array<(reason: Error) => void> = []
    list.mockImplementationOnce(() => new Promise<WslDirectoryListing>((_resolve, reject) => { late.push(reject) }))

    await click(toggle())
    await click(toggle())
    await act(async () => late[0]?.(new Error('Permission denied.')))

    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(rows()).toEqual(['docs', 'src'])
    expect(button('Choose this folder').disabled).toBe(false)
  })

  it('stays busy until the newest request is answered', async () => {
    await render()
    const toggle = (): HTMLInputElement => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    const answers: Array<(listing: WslDirectoryListing) => void> = []
    const pending = (): Promise<WslDirectoryListing> => new Promise((resolve) => { answers.push(resolve) })
    list.mockImplementationOnce(pending).mockImplementationOnce(pending)

    await click(toggle())
    await click(toggle())
    await act(async () => answers[0]?.({ path: '/home/me', directories: ['.old'], truncated: false }))

    expect(button('Choose this folder').disabled).toBe(true)
    expect(document.querySelector('ul[aria-label="Folders"]')?.getAttribute('aria-busy')).toBe('true')

    await act(async () => answers[1]?.({ path: '/home/me', directories: ['new'], truncated: false }))

    expect(button('Choose this folder').disabled).toBe(false)
    expect(rows()).toEqual(['new'])
  })

  it('does not show the previous opening’s folders while the next one loads', async () => {
    const { update } = await render()
    await open('src')
    expect(rows()).toEqual(['app', 'tools'])
    await update({ open: false })
    list.mockImplementationOnce(() => new Promise<WslDirectoryListing>(() => undefined))

    await update({ open: true })

    expect(rows()).toEqual([])
    expect(document.body.textContent).toContain('Opening Ubuntu-24.04…')
    expect(button('Choose this folder').disabled).toBe(true)
  })

  it('ignores an answer that arrives after the browser was closed and opened again', async () => {
    const { update } = await render()
    let finish: (listing: WslDirectoryListing) => void = () => undefined
    list.mockImplementationOnce(() => new Promise<WslDirectoryListing>((resolve) => { finish = resolve }))
    await open('src')
    await update({ open: false })
    await update({ open: true })

    await act(async () => finish({ path: '/home/me/src', directories: ['stale'], truncated: false }))

    expect(rows()).toEqual(['docs', 'src'])
  })

  it('gives focus back to the button that opened it', async () => {
    const opener = document.createElement('button')
    opener.textContent = 'Browse'
    document.body.append(opener)
    opener.focus()
    const { update } = await render({ open: false })

    await update({ open: true })
    expect(document.activeElement).not.toBe(opener)
    await click(button('Cancel'))
    await update({ open: false })

    // Radix moves focus on a timer after the dialog has unmounted, so wait for it instead of guessing.
    await vi.waitFor(() => expect(document.activeElement).toBe(opener))
  })

  it('closes without choosing anything', async () => {
    await render()

    await click(button('Cancel'))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onChoose).not.toHaveBeenCalled()
  })

  it('treats a folder named like markup as plain text', async () => {
    list.mockResolvedValue({ path: '/home/me', directories: ['<img src=x onerror=alert(1)>'], truncated: false })
    await render()

    expect(rows()).toEqual(['<img src=x onerror=alert(1)>'])
    expect(document.querySelector('ul[aria-label="Folders"] img')).toBeNull()
  })
})

describe('folder path helpers', () => {
  it('splits a path into breadcrumbs from the root', () => {
    expect(folderCrumbs('/')).toEqual([{ name: '/', path: '/' }])
    expect(folderCrumbs('/home/me')).toEqual([
      { name: '/', path: '/' },
      { name: 'home', path: '/home' },
      { name: 'me', path: '/home/me' },
    ])
  })

  it('finds the parent folder', () => {
    expect(parentFolder('/')).toBeNull()
    expect(parentFolder('/home')).toBe('/')
    expect(parentFolder('/home/me/src')).toBe('/home/me')
    expect(parentFolder('relative')).toBeNull()
  })

  it('joins a folder name onto its parent', () => {
    expect(childFolder('/', 'home')).toBe('/home')
    expect(childFolder('/home/me', 'src')).toBe('/home/me/src')
  })
})
