// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AddSessionDialog } from '../src/renderer/components/AddSessionDialog'
import { useWorkspace } from '../src/renderer/store/workspace'

let root: Root
const addSession = vi.fn()
const onOpenChange = vi.fn()

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  addSession.mockReset().mockResolvedValue({})
  onOpenChange.mockClear()
  useWorkspace.setState({
    platform: { platform: 'darwin', isWindows: false },
    wslAvailable: false, distros: [], addSession,
    refreshDistros: vi.fn(async () => undefined),
  })
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

const render = (): Promise<void> => act(async () => root.render(createElement(AddSessionDialog, { open: true, onOpenChange })))
const createButton = (): HTMLButtonElement => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Create')!

async function enterName(): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('#session-name')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '  Tools  ')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it('creates a native session with only a name', async () => {
  await render()
  expect(createButton().disabled).toBe(true)
  await enterName()
  expect(createButton().disabled).toBe(false)
  await act(async () => createButton().click())
  expect(addSession).toHaveBeenCalledWith({ name: 'Tools', kind: 'native' })
  expect(onOpenChange).toHaveBeenCalledWith(false)
})

it('creates a WSL session in the selected distribution', async () => {
  useWorkspace.setState({
    platform: { platform: 'win32', isWindows: true }, wslAvailable: true,
    distros: [{ name: 'Ubuntu-24.04', state: 'Running', version: 2, isDefault: true }],
  })
  await render()
  const wsl = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'WSL')!
  await act(async () => wsl.click())
  await enterName()
  await act(async () => createButton().click())
  expect(addSession).toHaveBeenCalledWith({ name: 'Tools', kind: 'wsl', distro: 'Ubuntu-24.04' })
})
