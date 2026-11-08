// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatModel, OpenCodeModelRef } from '../src/shared/types'
import { ComposerDock } from '../src/renderer/components/inbox/ComposerDock'
import { ModelQuickSwitch } from '../src/renderer/components/inbox/ModelQuickSwitch'
import { INBOX_MODEL_QUICK_SWITCH_STORAGE_KEY } from '../src/renderer/lib/inbox-settings'
import { useInboxView } from '../src/renderer/store/inbox-view'
import { useModelFavorites } from '../src/renderer/store/model-favorites'

const models: ChatModel[] = [
  { id: 'sonnet', providerId: 'anthropic', providerName: 'Anthropic', name: 'Claude Sonnet', variants: ['low', 'high'] },
  { id: 'opus', providerId: 'anthropic', providerName: 'Anthropic', name: 'Claude Opus', variants: ['low', 'high'] },
  { id: 'haiku', providerId: 'anthropic', providerName: 'Anthropic', name: 'Claude Haiku' },
  { id: 'glm', providerId: 'opencode', providerName: 'OpenCode', name: 'glm' },
  { id: 'gpt', providerId: 'openai', providerName: 'OpenAI', name: 'GPT' },
  { id: 'gemini', providerId: 'google', providerName: 'Google', name: 'Gemini' },
  { id: 'llama', providerId: 'meta', providerName: 'Meta', name: 'Llama' },
]
const star = (...keys: string[]) => keys.map((key) => { const [providerId, id] = key.split('/') as [string, string]; return { id, providerId } })

let root: Root
let container: HTMLElement
const onChange = vi.fn()

const render = (value: OpenCodeModelRef | null, extra: { disabled?: boolean } = {}) =>
  act(async () => root.render(createElement(ComposerDock, null, createElement(ModelQuickSwitch, { models, value, onChange, ...extra }))))
const chips = () => Array.from(container.querySelectorAll<HTMLButtonElement>('[data-testid^="model-quick-switch-"]'))
const chip = (key: string) => container.querySelector<HTMLButtonElement>(`[data-testid="model-quick-switch-${key}"]`)!

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  onChange.mockReset()
  localStorage.clear()
  useInboxView.setState({ modelQuickSwitch: true })
  useModelFavorites.setState({ favorites: [] })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('quick switch between favorite models', () => {
  it('draws nothing, and no tray, while there is no favorite this place offers', async () => {
    await render({ id: 'sonnet', providerId: 'anthropic' })
    expect(container.querySelector('[data-testid="model-quick-switch"]')).toBeNull()
    expect(container.querySelector('[data-testid="composer-dock"]')?.childNodes.length).toBe(0)

    await act(async () => useModelFavorites.setState({ favorites: star('anthropic/gone') }))
    expect(container.querySelector('[data-testid="model-quick-switch"]')).toBeNull()
  })

  it('shows up to five favorites in the order they were starred, with the one in use lit', async () => {
    useModelFavorites.setState({ favorites: star('opencode/glm', 'anthropic/sonnet', 'anthropic/haiku', 'anthropic/opus', 'openai/gpt', 'google/gemini') })
    await render({ id: 'sonnet', providerId: 'anthropic' })
    expect(chips().map((item) => item.textContent)).toEqual(['glm', 'Claude Sonnet', 'Claude Haiku', 'Claude Opus', 'GPT'])
    expect(chips().map((item) => item.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false', 'false', 'false'])
    expect(chip('anthropic/sonnet').getAttribute('title')).toBe('Anthropic / Claude Sonnet')
    expect(container.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Switch model')
  })

  it('switches to the one clicked, and does nothing for the one already in use', async () => {
    useModelFavorites.setState({ favorites: star('anthropic/sonnet', 'opencode/glm') })
    await render({ id: 'sonnet', providerId: 'anthropic' })
    await act(async () => chip('opencode/glm').click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ id: 'glm', providerId: 'opencode' })
    await act(async () => chip('anthropic/sonnet').click())
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('takes the effort along to a model that has it', async () => {
    useModelFavorites.setState({ favorites: star('anthropic/sonnet', 'anthropic/opus', 'anthropic/haiku') })
    await render({ id: 'sonnet', providerId: 'anthropic', variant: 'high' })
    await act(async () => chip('anthropic/opus').click())
    expect(onChange).toHaveBeenLastCalledWith({ id: 'opus', providerId: 'anthropic', variant: 'high' })
    await act(async () => chip('anthropic/haiku').click())
    expect(onChange).toHaveBeenLastCalledWith({ id: 'haiku', providerId: 'anthropic' })
  })

  it('lights nothing for a model that is not a favorite, and keeps a favorite beyond the fifth in view', async () => {
    useModelFavorites.setState({ favorites: star('anthropic/sonnet', 'anthropic/opus', 'anthropic/haiku', 'openai/gpt', 'google/gemini', 'opencode/glm') })
    await render({ id: 'glm', providerId: 'opencode' })
    expect(chips().map((item) => item.textContent)).toEqual(['Claude Sonnet', 'Claude Opus', 'Claude Haiku', 'GPT', 'glm'])
    expect(chip('opencode/glm').getAttribute('aria-pressed')).toBe('true')
    await render({ id: 'unlisted', providerId: 'x' })
    expect(chips().every((item) => item.getAttribute('aria-pressed') === 'false')).toBe(true)
  })

  it('follows the favorites as they are starred and unstarred', async () => {
    await render({ id: 'sonnet', providerId: 'anthropic' })
    await act(async () => useModelFavorites.getState().toggle({ id: 'opus', providerId: 'anthropic' }))
    expect(chips()).toHaveLength(1)
    await act(async () => useModelFavorites.getState().toggle({ id: 'opus', providerId: 'anthropic' }))
    expect(container.querySelector('[data-testid="model-quick-switch"]')).toBeNull()
  })

  it('is on until the Inbox setting turns it off, and then it is gone, tray and all, with the favorites kept', async () => {
    useModelFavorites.setState({ favorites: star('anthropic/sonnet', 'opencode/glm') })
    await render({ id: 'sonnet', providerId: 'anthropic' })
    expect(chips()).toHaveLength(2)
    await act(async () => useInboxView.getState().setModelQuickSwitch(false))
    expect(container.querySelector('[data-testid="model-quick-switch"]')).toBeNull()
    expect(container.querySelector('[data-testid="composer-dock"]')?.childNodes.length).toBe(0)
    expect(localStorage.getItem(INBOX_MODEL_QUICK_SWITCH_STORAGE_KEY)).toBe('off')
    expect(useModelFavorites.getState().favorites).toHaveLength(2)
    await act(async () => useInboxView.getState().setModelQuickSwitch(true))
    expect(chips()).toHaveLength(2)
    expect(localStorage.getItem(INBOX_MODEL_QUICK_SWITCH_STORAGE_KEY)).toBe('on')
  })

  it('can be switched off while the choice cannot be made', async () => {
    useModelFavorites.setState({ favorites: star('anthropic/sonnet', 'opencode/glm') })
    await render({ id: 'sonnet', providerId: 'anthropic' }, { disabled: true })
    expect(chip('opencode/glm').disabled).toBe(true)
  })
})
