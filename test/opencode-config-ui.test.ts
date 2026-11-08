// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenCodeConfigDialog } from '../src/renderer/components/inbox/OpenCodeConfigDialog'
import { useOpenCodeConfig } from '../src/renderer/store/opencode-config'
import { useWorkspace } from '../src/renderer/store/workspace'
import { emptyDraft, OPENCODE_CONFIG_CHANGED, type OpenCodeConfigDraft, type OpenCodeConfigSnapshot } from '../src/shared/opencode-config'

// CodeMirror needs real layout; what matters here is the text the Source tab hands to the viewer.
vi.mock('../src/renderer/components/CodeViewer', async () => {
  const { createElement: h } = await import('react')
  return { CodeViewer: ({ content }: { content: string }) => h('pre', { 'data-testid': 'code-viewer' }, content) }
})

const baseDraft: OpenCodeConfigDraft = {
  permissions: [{ action: 'shell', resource: '*', effect: 'ask' }],
  customProviders: [],
  disabledProviders: [],
}

function snapshot(overrides: Partial<OpenCodeConfigSnapshot> = {}): OpenCodeConfigSnapshot {
  return {
    target: { kind: 'native' },
    file: { displayPath: '~/.config/opencode/opencode.jsonc', exists: true },
    revision: 'rev-1',
    draft: baseDraft,
    foreignProviders: [],
    legacy: { keys: [], providers: [], disabledProviders: [], enabledProviders: [] },
    knownProviders: [
      { id: 'opencode', name: 'OpenCode Zen' },
      { id: 'anthropic', name: 'Anthropic' },
    ],
    warnings: [],
    parseError: null,
    ...overrides,
  }
}

describe('OpenCode configuration dialog', () => {
  let root: Root
  let container: HTMLDivElement
  const read = vi.fn()
  const preview = vi.fn()
  const save = vi.fn()
  const distros = vi.fn()

  const q = (testId: string): HTMLElement | null => document.body.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  const all = (testId: string): HTMLElement[] => Array.from(document.body.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`))
  const field = (testId: string, at = 0): HTMLInputElement => {
    const found = all(testId)[at]
    if (!found) throw new Error(`No field ${testId} #${at}`)
    return found as HTMLInputElement
  }
  const settle = async (): Promise<void> => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) }) }
  const click = async (element: Element | null): Promise<void> => {
    if (!element) throw new Error('Nothing to click')
    await act(async () => (element as HTMLElement).click())
    await settle()
  }
  const type = async (input: HTMLInputElement, value: string): Promise<void> => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const openDialog = async (): Promise<void> => {
    await act(async () => useWorkspace.getState().openOpenCodeConfig())
    await settle()
  }
  const saveButton = (): HTMLButtonElement => q('opencode-config-save') as HTMLButtonElement
  const status = (): string => q('opencode-config-status')?.textContent ?? ''
  const lastSaved = (): OpenCodeConfigDraft => (save.mock.calls.at(-1)![0] as { draft: OpenCodeConfigDraft }).draft

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('api', { opencodeConfig: { read, preview, save }, wsl: { distros } })
    read.mockReset().mockResolvedValue(snapshot())
    preview.mockReset().mockResolvedValue({ text: '{\n  "permissions": []\n}\n' })
    save.mockReset().mockImplementation(async (request: { draft: OpenCodeConfigDraft }) =>
      snapshot({ revision: 'rev-2', draft: request.draft })
    )
    distros.mockReset().mockResolvedValue([{ name: 'Ubuntu-24.04', state: 'Running', version: 2, isDefault: true }])
    useOpenCodeConfig.getState().reset()
    useWorkspace.setState({
      platform: { platform: 'darwin', isWindows: false },
      opencodeConfigDialog: { open: false },
      distros: [],
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root.render(createElement(OpenCodeConfigDialog)))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
    useOpenCodeConfig.getState().reset()
    vi.unstubAllGlobals()
  })

  it('reads the file when it opens and lists its permission rules', async () => {
    expect(read).not.toHaveBeenCalled()
    await openDialog()

    expect(read).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledWith({ kind: 'native' })
    expect(q('opencode-config-path')?.textContent).toBe('~/.config/opencode/opencode.jsonc')
    expect(all('opencode-rule')).toHaveLength(1)
    expect(field('opencode-rule-action').value).toBe('shell')
    expect(field('opencode-rule-resource').value).toBe('*')
    expect(q('opencode-rule-ask')?.getAttribute('data-state')).toBe('checked')
    // Nothing is changed yet, so there is nothing to save or revert.
    expect(saveButton().disabled).toBe(true)
    expect((q('opencode-config-revert') as HTMLButtonElement).disabled).toBe(true)
  })

  it('says when the file does not exist yet', async () => {
    read.mockResolvedValue(snapshot({ file: { displayPath: '~/.config/opencode/opencode.jsonc', exists: false }, draft: emptyDraft() }))
    await openDialog()
    expect(document.body.textContent).toContain('does not exist yet; Save creates it')
    expect(q('opencode-rules-empty')).not.toBeNull()
  })

  describe('permissions', () => {
    it('edits a rule and saves exactly that draft against the revision it was read at', async () => {
      await openDialog()
      await click(q('opencode-rule-deny'))
      await type(field('opencode-rule-resource'), 'git push *')

      expect(status()).toBe('Unsaved changes.')
      expect(saveButton().disabled).toBe(false)
      await click(saveButton())

      expect(save).toHaveBeenCalledTimes(1)
      expect(save).toHaveBeenCalledWith({
        kind: 'native',
        revision: 'rev-1',
        draft: { ...baseDraft, permissions: [{ action: 'shell', resource: 'git push *', effect: 'deny' }] },
      })
      expect(status()).toContain('Saved. OpenCode applies it within a few seconds')
      expect(saveButton().disabled).toBe(true)
      // The next save is made against the file as the last one left it.
      await click(q('opencode-rule-allow'))
      await click(saveButton())
      expect(save.mock.calls.at(-1)![0]).toMatchObject({ revision: 'rev-2' })
    })

    it('adds, reorders and removes rules, and Revert puts them all back', async () => {
      await openDialog()
      await click(q('opencode-rule-add'))
      expect(all('opencode-rule')).toHaveLength(2)
      await type(field('opencode-rule-action', 1), 'edit')
      // A rule needs an action and a resource; the footer says what is missing and Save waits.
      await type(field('opencode-rule-resource', 1), '')
      expect(status()).toContain('edit rule needs a resource')
      expect(saveButton().disabled).toBe(true)
      await type(field('opencode-rule-resource', 1), 'src/**')

      const up = document.body.querySelector<HTMLButtonElement>('[aria-label="Move rule 2 up"]')!
      await click(up)
      expect(field('opencode-rule-action', 0).value).toBe('edit')
      expect(field('opencode-rule-action', 1).value).toBe('shell')

      await click(all('opencode-rule-delete')[1]!)
      expect(all('opencode-rule')).toHaveLength(1)
      expect(field('opencode-rule-action').value).toBe('edit')

      await click(q('opencode-config-revert'))
      expect(all('opencode-rule')).toHaveLength(1)
      expect(field('opencode-rule-action').value).toBe('shell')
      expect(save).not.toHaveBeenCalled()
    })

    it('quick-adds a rule once, and offers to rename the V1 action names', async () => {
      read.mockResolvedValue(snapshot({ draft: { ...baseDraft, permissions: [{ action: 'bash', resource: '*', effect: 'ask' }] } }))
      await openDialog()

      expect(q('opencode-rule-legacy')?.textContent).toContain('matches “shell”, not “bash”')
      await click(document.body.querySelector('[data-testid="opencode-rule-legacy"] button'))
      expect(field('opencode-rule-action').value).toBe('shell')
      expect(q('opencode-rule-legacy')).toBeNull()

      const deny = all('opencode-rule-quick').find((item) => item.textContent === 'Deny git push') as HTMLButtonElement
      await click(deny)
      expect(all('opencode-rule')).toHaveLength(2)
      expect(field('opencode-rule-resource', 1).value).toBe('git push *')
      expect(deny.disabled).toBe(true)
    })
  })

  describe('providers', () => {
    const openProviders = async (): Promise<void> => click(q('opencode-config-tab-providers'))

    it('adds a custom OpenAI-compatible provider with a model and saves it', async () => {
      await openDialog()
      await openProviders()
      expect(q('opencode-providers-empty')).not.toBeNull()
      await click(q('opencode-provider-add'))

      const done = q('opencode-provider-done') as HTMLButtonElement
      expect(done.disabled).toBe(true)
      expect(q('opencode-provider-problem')?.textContent).toContain('A provider id')
      await type(field('opencode-provider-id'), 'llama-cpp')
      await type(field('opencode-provider-name'), ' llama.cpp ')
      await type(field('opencode-provider-url'), 'http://localhost:8080/v1')
      await type(field('opencode-provider-key'), 'LLAMA_KEY')
      expect(done.disabled).toBe(true)
      expect(q('opencode-provider-problem')?.textContent).toContain('needs an id')
      await type(field('opencode-model-id'), 'qwen3')
      await type(field('opencode-model-name'), 'Qwen 3')
      await type(field('opencode-model-context'), '12x8,000')
      await type(field('opencode-model-output'), '4096')
      await click(q('opencode-model-images'))
      expect(done.disabled).toBe(false)
      expect(q('opencode-provider-problem')).toBeNull()
      await click(done)

      // Back at the list, with the provider in it. Nothing is written until Save.
      expect(q('opencode-provider-form')).toBeNull()
      expect(all('opencode-provider-row')[0]?.textContent).toContain('llama.cpp')
      expect(all('opencode-provider-row')[0]?.textContent).toContain('http://localhost:8080/v1 · 1 model')
      expect(save).not.toHaveBeenCalled()

      await click(saveButton())
      expect(lastSaved().customProviders).toEqual([
        {
          id: 'llama-cpp',
          name: 'llama.cpp',
          baseUrl: 'http://localhost:8080/v1',
          apiKeyEnv: 'LLAMA_KEY',
          models: [{ id: 'qwen3', name: 'Qwen 3', context: 128000, output: 4096, tools: true, imageInput: true }],
        },
      ])
    })

    it('rejects a base URL with a password in it and an environment variable that is a key', async () => {
      await openDialog()
      await openProviders()
      await click(q('opencode-provider-add'))
      await type(field('opencode-provider-id'), 'acme')
      await type(field('opencode-model-id'), 'm1')
      await type(field('opencode-provider-url'), 'https://user:secret@example.test/v1')
      expect(q('opencode-provider-problem')?.textContent).toContain('base URL')
      await type(field('opencode-provider-url'), 'https://example.test/v1')
      await type(field('opencode-provider-key'), 'sk-live key')
      expect(q('opencode-provider-problem')?.textContent).toContain('environment variable name')
      await type(field('opencode-provider-key'), 'ACME_API_KEY')
      expect((q('opencode-provider-done') as HTMLButtonElement).disabled).toBe(false)
    })

    it('edits a provider without letting its id change, and Cancel keeps the draft as it was', async () => {
      const provider = {
        id: 'local',
        name: 'Local',
        baseUrl: 'http://localhost:1234/v1',
        apiKeyEnv: '',
        models: [{ id: 'a', name: '', context: null, output: null, tools: true, imageInput: false }],
      }
      read.mockResolvedValue(snapshot({ draft: { ...baseDraft, customProviders: [provider] } }))
      await openDialog()
      await openProviders()
      await click(q('opencode-provider-edit'))

      expect(field('opencode-provider-id').readOnly).toBe(true)
      await type(field('opencode-provider-name'), 'Changed')
      await click(q('opencode-provider-cancel'))
      expect(all('opencode-provider-row')[0]?.textContent).toContain('Local')
      expect(saveButton().disabled).toBe(true)

      await click(q('opencode-provider-edit'))
      await click(q('opencode-model-add'))
      await type(field('opencode-model-id', 1), 'b')
      await click(q('opencode-provider-done'))
      await click(saveButton())
      expect(lastSaved().customProviders[0]?.models.map((model) => model.id)).toEqual(['a', 'b'])
    })

    it('does not take the id of a provider that is in the file but not managed here', async () => {
      read.mockResolvedValue(
        snapshot({
          foreignProviders: [{ id: 'azure', name: 'Azure' }],
          legacy: { keys: ['provider'], providers: ['llama.cpp'], disabledProviders: [], enabledProviders: [] },
        })
      )
      await openDialog()
      await openProviders()
      expect(all('opencode-foreign-provider')[0]?.textContent).toContain('Azure')
      expect(q('opencode-legacy-note')?.textContent).toContain('still applies them')
      await click(q('opencode-provider-add'))
      await type(field('opencode-provider-id'), 'azure')
      await type(field('opencode-provider-url'), 'http://localhost:1/v1')
      await type(field('opencode-model-id'), 'm')
      expect(q('opencode-provider-problem')?.textContent).toContain('already used')
      await type(field('opencode-provider-id'), 'llama.cpp')
      expect(q('opencode-provider-problem')?.textContent).toContain('already used')
      await type(field('opencode-provider-id'), 'fresh')
      expect(q('opencode-provider-problem')).toBeNull()
    })

    it('removes a provider from the draft', async () => {
      const provider = {
        id: 'local',
        name: 'Local',
        baseUrl: 'http://localhost:1234/v1',
        apiKeyEnv: '',
        models: [{ id: 'a', name: '', context: null, output: null, tools: true, imageInput: false }],
      }
      read.mockResolvedValue(snapshot({ draft: { ...baseDraft, customProviders: [provider] } }))
      await openDialog()
      await openProviders()
      await click(q('opencode-provider-remove'))
      expect(q('opencode-providers-empty')).not.toBeNull()
      await click(saveButton())
      expect(lastSaved().customProviders).toEqual([])
    })

    it('switches providers off and on, keeps a disabled one in the list, and adds an id by hand', async () => {
      read.mockResolvedValue(snapshot({ draft: { ...baseDraft, disabledProviders: ['openrouter'] } }))
      await openDialog()
      await openProviders()

      const rows = (): string[] => all('opencode-provider-switch-name').map((name) => name.textContent ?? '')
      // The running service does not list a disabled provider, but the file does, so it stays switchable.
      expect(rows()).toEqual(['Anthropic', 'OpenCode Zen', 'openrouter'])
      const switchFor = (name: string): HTMLButtonElement =>
        document.body.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${name} enabled"]`)!
      expect(switchFor('openrouter').getAttribute('aria-checked')).toBe('false')
      expect(switchFor('Anthropic').getAttribute('aria-checked')).toBe('true')

      await click(switchFor('Anthropic'))
      expect(switchFor('Anthropic').getAttribute('aria-checked')).toBe('false')
      await click(switchFor('openrouter'))
      expect(switchFor('openrouter').getAttribute('aria-checked')).toBe('true')

      await type(field('opencode-disable-input'), 'ac*')
      await click(q('opencode-disable-add'))
      expect(rows()).toContain('ac*')
      expect(document.body.textContent).toContain('matches several providers')
      await type(field('opencode-disable-input'), 'not a provider')
      expect((q('opencode-disable-add') as HTMLButtonElement).disabled).toBe(true)

      await click(saveButton())
      expect(lastSaved().disabledProviders).toEqual(['anthropic', 'ac*'])
    })

    it('locks a provider that an older disabled_providers key disables', async () => {
      read.mockResolvedValue(
        snapshot({ legacy: { keys: ['disabled_providers'], providers: [], disabledProviders: ['opencode'], enabledProviders: [] } })
      )
      await openDialog()
      await openProviders()
      const lock = document.body.querySelector<HTMLButtonElement>('[role="switch"][aria-label="OpenCode Zen enabled"]')!
      expect(lock.disabled).toBe(true)
      expect(lock.getAttribute('aria-checked')).toBe('false')
      expect(document.body.textContent).toContain('Remove it there to enable the provider')
    })

    it('keeps a half-filled provider while the Source tab is looked at', async () => {
      await openDialog()
      await openProviders()
      await click(q('opencode-provider-add'))
      await type(field('opencode-provider-id'), 'half')
      await click(q('opencode-config-tab-source'))
      await click(q('opencode-config-tab-providers'))
      expect(field('opencode-provider-id').value).toBe('half')
    })
  })

  describe('source', () => {
    it('shows the text the main process builds for the draft, and asks again when the draft changes', async () => {
      await openDialog()
      await click(q('opencode-config-tab-source'))
      expect(preview).toHaveBeenCalledWith({ kind: 'native', draft: baseDraft })
      expect(q('code-viewer')?.textContent).toBe('{\n  "permissions": []\n}\n')

      preview.mockResolvedValue({ text: '{ "changed": true }' })
      await click(q('opencode-config-tab-permissions'))
      await click(q('opencode-rule-deny'))
      await click(q('opencode-config-tab-source'))
      expect(preview).toHaveBeenLastCalledWith({
        kind: 'native',
        draft: { ...baseDraft, permissions: [{ action: 'shell', resource: '*', effect: 'deny' }] },
      })
      expect(q('code-viewer')?.textContent).toBe('{ "changed": true }')
    })

    it('does not ask for a preview of a draft that cannot be saved', async () => {
      await openDialog()
      await click(q('opencode-rule-add'))
      await click(q('opencode-config-tab-source'))
      expect(preview).not.toHaveBeenCalled()
      expect(q('opencode-source-problem')?.textContent).toContain('needs an action')
      expect(q('code-viewer')).toBeNull()
    })

    it('shows why the preview failed', async () => {
      preview.mockRejectedValue(new Error("Error invoking remote method 'opencode-config:preview': Error: The file has no JSON object to edit."))
      await openDialog()
      await click(q('opencode-config-tab-source'))
      expect(document.body.textContent).toContain('The file has no JSON object to edit.')
      expect(document.body.textContent).not.toContain('Error invoking remote method')
    })
  })

  describe('problems', () => {
    it('refuses to edit a file that is not valid JSON', async () => {
      read.mockResolvedValue(snapshot({ draft: emptyDraft(), parseError: 'Unexpected token at line 3' }))
      await openDialog()

      expect(q('opencode-config-parse-error')?.textContent).toContain('Unexpected token at line 3')
      expect((q('opencode-rule-add') as HTMLButtonElement).disabled).toBe(true)
      expect(saveButton().disabled).toBe(true)

      read.mockResolvedValue(snapshot())
      await click(q('opencode-config-reload'))
      expect(q('opencode-config-parse-error')).toBeNull()
      expect((q('opencode-rule-add') as HTMLButtonElement).disabled).toBe(false)
    })

    it('shows a conflict, keeps the edits, and reloads on request', async () => {
      save.mockRejectedValue(new Error(`Error invoking remote method 'opencode-config:save': Error: ${OPENCODE_CONFIG_CHANGED}`))
      await openDialog()
      await click(q('opencode-rule-deny'))
      await click(saveButton())

      expect(q('opencode-config-conflict')).not.toBeNull()
      expect(status()).toBe(OPENCODE_CONFIG_CHANGED)
      expect(q('opencode-rule-deny')?.getAttribute('data-state')).toBe('checked')

      read.mockResolvedValue(snapshot({ revision: 'rev-9', draft: { ...baseDraft, permissions: [] } }))
      await click(q('opencode-config-reload'))
      expect(read).toHaveBeenCalledTimes(2)
      expect(q('opencode-config-conflict')).toBeNull()
      expect(all('opencode-rule')).toHaveLength(0)
      expect(saveButton().disabled).toBe(true)
    })

    it('shows any other save failure without the IPC wrapper, and keeps the draft', async () => {
      save.mockRejectedValue(new Error("Error invoking remote method 'opencode-config:save': Error: EACCES: permission denied"))
      await openDialog()
      await click(q('opencode-rule-deny'))
      await click(saveButton())
      expect(status()).toBe('EACCES: permission denied')
      expect(q('opencode-config-conflict')).toBeNull()
      expect(saveButton().disabled).toBe(false)
    })

    it('says when the file could not be read, and tries again', async () => {
      read.mockRejectedValueOnce(new Error("Error invoking remote method 'opencode-config:read': Error: opencode.jsonc is larger than 1 MiB."))
      await openDialog()
      expect(q('opencode-config-load-error')?.textContent).toBe('opencode.jsonc is larger than 1 MiB.')
      await click(q('opencode-config-retry'))
      expect(q('opencode-config-load-error')).toBeNull()
      expect(all('opencode-rule')).toHaveLength(1)
    })

    it('shows warnings about the file', async () => {
      read.mockResolvedValue(snapshot({ warnings: ['Both opencode.jsonc and opencode.json exist; only opencode.jsonc is edited.'] }))
      await openDialog()
      expect(q('opencode-config-warning')?.textContent).toContain('only opencode.jsonc is edited')
    })
  })

  describe('closing', () => {
    it('closes at once when nothing was changed, and forgets the file', async () => {
      await openDialog()
      await click(q('opencode-config-close'))
      expect(useWorkspace.getState().opencodeConfigDialog.open).toBe(false)
      expect(q('opencode-config-dialog')).toBeNull()
      expect(useOpenCodeConfig.getState().snapshot).toBeNull()
    })

    it('asks before throwing away unsaved changes', async () => {
      await openDialog()
      await click(q('opencode-rule-deny'))
      await click(q('opencode-config-close'))
      expect(useWorkspace.getState().opencodeConfigDialog.open).toBe(true)
      expect(document.body.textContent).toContain('Discard your changes?')

      const keep = Array.from(document.body.querySelectorAll('button')).find((item) => item.textContent === 'Keep editing')
      await click(keep ?? null)
      expect(useWorkspace.getState().opencodeConfigDialog.open).toBe(true)
      expect(q('opencode-rule-deny')?.getAttribute('data-state')).toBe('checked')

      await click(q('opencode-config-close'))
      await click(q('opencode-config-discard'))
      expect(useWorkspace.getState().opencodeConfigDialog.open).toBe(false)
      expect(save).not.toHaveBeenCalled()

      // Opening it again reads the file again and shows what is on disk.
      await openDialog()
      expect(read).toHaveBeenCalledTimes(2)
      expect(q('opencode-rule-ask')?.getAttribute('data-state')).toBe('checked')
    })
  })

  describe('on Windows', () => {
    it('edits the file in the default WSL distro', async () => {
      useWorkspace.setState({
        platform: { platform: 'win32', isWindows: true },
        distros: [{ name: 'Ubuntu-24.04', state: 'Running', version: 2, isDefault: true }],
      })
      await openDialog()

      expect(distros).toHaveBeenCalled()
      expect(read).toHaveBeenCalledWith({ kind: 'wsl', distro: 'Ubuntu-24.04' })
      expect(q('opencode-config-distro')).not.toBeNull()

      await click(q('opencode-rule-deny'))
      await click(saveButton())
      expect(save).toHaveBeenCalledWith({
        kind: 'wsl',
        distro: 'Ubuntu-24.04',
        revision: 'rev-1',
        draft: { ...baseDraft, permissions: [{ action: 'shell', resource: '*', effect: 'deny' }] },
      })
    })

    it('reads nothing until a distro is known', async () => {
      useWorkspace.setState({ platform: { platform: 'win32', isWindows: true }, distros: [] })
      distros.mockResolvedValue([])
      await openDialog()
      expect(read).not.toHaveBeenCalled()
      expect(document.body.textContent).toContain('No WSL distro was found')
    })
  })
})
