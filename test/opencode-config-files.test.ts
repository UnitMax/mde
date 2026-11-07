import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  OPENCODE_CONFIG_CHANGED,
  OPENAI_COMPATIBLE_PACKAGE,
  emptyDraft,
  type OpenCodeConfigDraft,
  type OpenCodeConfigSnapshot,
} from '@shared/opencode-config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nativeConfigFileSystem, wslConfigFileSystem, WSL_CONFIG_DIRECTORY_EXPRESSION } from '../src/main/opencode/config/files'
import { OpenCodeConfigService } from '../src/main/opencode/config/service'
import { openCodeConfigDirectory } from '../src/main/native-environment'

const target = { kind: 'native' } as const
const RULE = { action: 'shell', resource: '*', effect: 'ask' } as const

let root = ''
let directory = ''

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'mde-opencode-config-test-'))
  directory = join(root, '.config', 'opencode')
})

afterEach(async () => {
  vi.useRealTimers()
  await fs.rm(root, { recursive: true, force: true })
})

function service(options: { providers?: () => Promise<{ id: string; name: string }[]>; onSaved?: () => void } = {}): OpenCodeConfigService {
  return new OpenCodeConfigService({
    fileSystem: () => nativeConfigFileSystem(async () => directory, () => root),
    knownProviders: options.providers ?? (async () => []),
    onSaved: options.onSaved ?? (() => undefined),
  })
}

const withRule = (snapshot: OpenCodeConfigSnapshot): OpenCodeConfigDraft => ({
  ...snapshot.draft,
  permissions: [...snapshot.draft.permissions, RULE],
})

describe('reading', () => {
  it('describes a missing file without creating it', async () => {
    const snapshot = await service().read(target)
    expect(snapshot).toMatchObject({
      file: { displayPath: '~/.config/opencode/opencode.jsonc', exists: false },
      revision: 'absent',
      draft: emptyDraft(),
      parseError: null,
    })
    await expect(fs.stat(directory)).rejects.toThrow()
  })

  it('prefers opencode.jsonc and says so when opencode.json exists too', async () => {
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(join(directory, 'opencode.json'), '{ "policies": [{ "action": "provider.use", "resource": "a", "effect": "deny" }] }')
    expect((await service().read(target)).draft.disabledProviders).toEqual(['a'])

    await fs.writeFile(join(directory, 'opencode.jsonc'), '{ "policies": [{ "action": "provider.use", "resource": "b", "effect": "deny" }] }')
    const snapshot = await service().read(target)
    expect(snapshot.draft.disabledProviders).toEqual(['b'])
    expect(snapshot.warnings.join(' ')).toContain('Both opencode.jsonc and opencode.json exist')
  })

  it('reports a broken file and refuses to preview or save over it', async () => {
    await fs.mkdir(directory, { recursive: true })
    const path = join(directory, 'opencode.jsonc')
    await fs.writeFile(path, '{ "permissions": [')
    const subject = service()
    const snapshot = await subject.read(target)
    expect(snapshot.parseError).toBeTruthy()
    await expect(subject.preview(target, withRule(snapshot))).rejects.toThrow(/not valid JSON/)
    await expect(subject.save(target, withRule(snapshot), snapshot.revision)).rejects.toThrow(/not valid JSON/)
    expect(await fs.readFile(path, 'utf8')).toBe('{ "permissions": [')
  })

  it('refuses a file over 1 MiB', async () => {
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(join(directory, 'opencode.jsonc'), `{ "x": "${'a'.repeat(1024 * 1024)}" }`)
    await expect(service().read(target)).rejects.toThrow(/larger than 1 MiB/)
  })

  it('gives up waiting for the running service after a few seconds, and when it fails', async () => {
    vi.useFakeTimers()
    const slow = service({ providers: () => new Promise(() => undefined) }).read(target)
    await vi.advanceTimersByTimeAsync(3000)
    expect((await slow).knownProviders).toEqual([])
    vi.useRealTimers()

    const failing = service({ providers: async () => { throw new Error('down') } })
    expect((await failing.read(target)).knownProviders).toEqual([])
    const listed = service({ providers: async () => [{ id: 'opencode', name: 'OpenCode' }] })
    expect((await listed.read(target)).knownProviders).toEqual([{ id: 'opencode', name: 'OpenCode' }])
  })
})

describe('saving', () => {
  it('creates the folder and a private file when there is none', async () => {
    const onSaved = vi.fn()
    const subject = service({ onSaved })
    const snapshot = await subject.save(target, { ...emptyDraft(), permissions: [RULE] }, 'absent')
    const path = join(directory, 'opencode.jsonc')
    const text = await fs.readFile(path, 'utf8')
    expect(text).toContain('"$schema": "https://opencode.ai/config.json"')
    expect((await fs.stat(path)).mode & 0o777).toBe(0o600)
    expect(snapshot.file.exists).toBe(true)
    expect(snapshot.draft.permissions).toEqual([RULE])
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('changes only what the draft changed, keeps the file mode and leaves no temporary file', async () => {
    await fs.mkdir(directory, { recursive: true })
    const path = join(directory, 'opencode.jsonc')
    const original = '{\n  // mine\n  "model": "a/b",\n  "provider": { "old": {} }\n}\n'
    await fs.writeFile(path, original)
    await fs.chmod(path, 0o640)
    const subject = service()
    const snapshot = await subject.read(target)
    await subject.save(target, withRule(snapshot), snapshot.revision)
    const text = await fs.readFile(path, 'utf8')
    expect(text.startsWith('{\n  // mine\n  "model": "a/b",\n  "provider": { "old": {} }')).toBe(true)
    expect(text).toContain('"permissions"')
    expect((await fs.stat(path)).mode & 0o777).toBe(0o640)
    expect(await fs.readdir(directory)).toEqual(['opencode.jsonc'])
  })

  it('does not write, or announce a change, when the draft is what the file says', async () => {
    await fs.mkdir(directory, { recursive: true })
    const path = join(directory, 'opencode.jsonc')
    await fs.writeFile(path, '{ "model": "a/b" }')
    const before = (await fs.stat(path)).mtimeMs
    const onSaved = vi.fn()
    const subject = service({ onSaved })
    const snapshot = await subject.read(target)
    await subject.save(target, snapshot.draft, snapshot.revision)
    expect((await fs.stat(path)).mtimeMs).toBe(before)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('refuses to save over a file that changed since it was read', async () => {
    await fs.mkdir(directory, { recursive: true })
    const path = join(directory, 'opencode.jsonc')
    await fs.writeFile(path, '{ "model": "a/b" }')
    const subject = service()
    const snapshot = await subject.read(target)
    await fs.writeFile(path, '{ "model": "someone/else" }')
    await expect(subject.save(target, withRule(snapshot), snapshot.revision)).rejects.toThrow(OPENCODE_CONFIG_CHANGED)
    expect(await fs.readFile(path, 'utf8')).toBe('{ "model": "someone/else" }')
  })

  it('lets only one of two saves from the same snapshot through', async () => {
    const subject = service()
    const snapshot = await subject.read(target)
    const results = await Promise.allSettled([
      subject.save(target, withRule(snapshot), snapshot.revision),
      subject.save(target, withRule(snapshot), snapshot.revision),
    ])
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected'])
  })

  it('writes through a symbolic link instead of replacing it', async () => {
    await fs.mkdir(directory, { recursive: true })
    const dotfiles = join(root, 'dotfiles')
    await fs.mkdir(dotfiles)
    await fs.writeFile(join(dotfiles, 'opencode.jsonc'), '{ "model": "a/b" }')
    await fs.symlink(join(dotfiles, 'opencode.jsonc'), join(directory, 'opencode.jsonc'))
    const subject = service()
    const snapshot = await subject.read(target)
    await subject.save(target, withRule(snapshot), snapshot.revision)
    expect((await fs.lstat(join(directory, 'opencode.jsonc'))).isSymbolicLink()).toBe(true)
    expect(await fs.readFile(join(dotfiles, 'opencode.jsonc'), 'utf8')).toContain('"permissions"')
  })

  it('keeps a byte order mark', async () => {
    await fs.mkdir(directory, { recursive: true })
    const path = join(directory, 'opencode.jsonc')
    await fs.writeFile(path, '﻿{ "model": "a/b" }')
    const subject = service()
    const snapshot = await subject.read(target)
    expect(snapshot.parseError).toBeNull()
    await subject.save(target, withRule(snapshot), snapshot.revision)
    expect((await fs.readFile(path, 'utf8')).charCodeAt(0)).toBe(0xfeff)
  })

  it('rejects a draft that is not valid before touching the file', async () => {
    await fs.mkdir(directory, { recursive: true })
    const path = join(directory, 'opencode.jsonc')
    await fs.writeFile(path, '{}')
    const subject = service()
    const snapshot = await subject.read(target)
    const draft: OpenCodeConfigDraft = { ...emptyDraft(), permissions: [{ action: '', resource: '*', effect: 'ask' }] }
    await expect(subject.save(target, draft, snapshot.revision)).rejects.toThrow(/needs an action/)
    expect(await fs.readFile(path, 'utf8')).toBe('{}')
  })
})

describe('previewing', () => {
  it('shows the result with secret values hidden and writes nothing', async () => {
    await fs.mkdir(directory, { recursive: true })
    const path = join(directory, 'opencode.jsonc')
    const original = `{ "providers": { "p": { "package": "${OPENAI_COMPATIBLE_PACKAGE}", "settings": { "baseURL": "http://h/v1", "apiKey": "sk-secret" }, "models": { "m": {} } } } }`
    await fs.writeFile(path, original)
    const subject = service()
    const snapshot = await subject.read(target)
    const preview = await subject.preview(target, withRule(snapshot))
    expect(preview.text).toContain('"permissions"')
    expect(preview.text).toContain('(hidden)')
    expect(preview.text).not.toContain('sk-secret')
    expect(await fs.readFile(path, 'utf8')).toBe(original)
  })
})

describe('where the configuration lives', () => {
  it('follows OPENCODE_CONFIG_DIR, then XDG_CONFIG_HOME, then ~/.config', () => {
    expect(openCodeConfigDirectory({ OPENCODE_CONFIG_DIR: '/opt/oc/', XDG_CONFIG_HOME: '/xdg' }, '/home/me')).toBe('/opt/oc')
    expect(openCodeConfigDirectory({ XDG_CONFIG_HOME: '/xdg' }, '/home/me')).toBe('/xdg/opencode')
    expect(openCodeConfigDirectory({}, '/home/me')).toBe('/home/me/.config/opencode')
    expect(openCodeConfigDirectory({ XDG_CONFIG_HOME: 'relative' }, '/home/me')).toBe('/home/me/.config/opencode')
    expect(() => openCodeConfigDirectory({ OPENCODE_CONFIG_DIR: 'relative' }, '/home/me')).toThrow(/absolute/)
  })

  it('asks a WSL distro for the same, through its login shell', async () => {
    const readValue = vi.fn(async (_distro: string, expression: string) => ({
      value: expression === '"$HOME"' ? '/home/me/' : '/home/me/.config/opencode',
      detail: '',
    }))
    const canonicalize = vi.fn(async (_distro: string, path: string) => (path === '/home/me/.config/opencode/opencode.jsonc' ? '/home/me/dotfiles/opencode.jsonc' : path))
    const files = wslConfigFileSystem('Ubuntu', { readValue, canonicalize })
    expect(await files.directory()).toBe('/home/me/.config/opencode')
    expect(readValue).toHaveBeenCalledWith('Ubuntu', WSL_CONFIG_DIRECTORY_EXPRESSION)
    expect(await files.home()).toBe('/home/me')
    expect(await files.realpath('/home/me/.config/opencode/opencode.jsonc')).toBe('/home/me/dotfiles/opencode.jsonc')
    expect(await files.realpath('/home/me/.config/opencode/opencode.json')).toBe('/home/me/.config/opencode/opencode.json')
  })

  it('resolves a link in the folder of a file that does not exist yet, and survives an unreadable distro', async () => {
    const canonicalize = vi.fn(async (_distro: string, path: string) => (path === '/home/me/.config/opencode' ? '/mnt/data/opencode' : path))
    const files = wslConfigFileSystem('Ubuntu', { readValue: async () => ({ value: null, detail: 'no output' }), canonicalize })
    expect(await files.realpath('/home/me/.config/opencode/opencode.jsonc')).toBe('/mnt/data/opencode/opencode.jsonc')
    await expect(files.directory()).rejects.toThrow(/Could not find OpenCode's configuration folder in Ubuntu/)
    expect(await files.home()).toBeNull()
  })

  it('refuses a directory the distro reports as relative', async () => {
    const files = wslConfigFileSystem('Ubuntu', { readValue: async () => ({ value: 'relative/path', detail: '' }), canonicalize: async (_d, p) => p })
    await expect(files.directory()).rejects.toThrow(/invalid/)
  })
})

describe('the providers the editor lists as known', () => {
  const lazy = async () => (await import('../src/main/opencode/config')).listKnownProviders

  it('asks the service where OpenCode runs and keeps only ids and names', async () => {
    const listKnownProviders = await lazy()
    const request = vi.fn(async () => ({
      data: [
        { id: 'anthropic', name: 'Anthropic', activation: 'env', settings: { apiKey: 'sk-must-not-travel' } },
        { id: 'local' },
        { name: 'no id' },
      ],
    }))

    expect(await listKnownProviders({ request }, { kind: 'native' })).toEqual([
      { id: 'anthropic', name: 'Anthropic' },
      // A provider without a name is listed by its id.
      { id: 'local', name: 'local' },
    ])
    expect(request).toHaveBeenCalledWith({ kind: 'native' }, 'provider.list')

    await listKnownProviders({ request }, { kind: 'wsl', distro: 'Ubuntu-24.04' })
    expect(request).toHaveBeenLastCalledWith({ kind: 'wsl', distro: 'Ubuntu-24.04' }, 'provider.list')
  })

  it('refuses a WSL target without a distribution, and passes a failure on for the service to absorb', async () => {
    const listKnownProviders = await lazy()
    const request = vi.fn(async () => { throw new Error('OpenCode is not running') })
    await expect(listKnownProviders({ request }, { kind: 'wsl' })).rejects.toThrow('needs a distribution')
    expect(request).not.toHaveBeenCalled()
    await expect(listKnownProviders({ request }, { kind: 'native' })).rejects.toThrow('not running')
  })

  it('shows the file without providers when the service cannot be asked', async () => {
    const service = new OpenCodeConfigService({
      fileSystem: () => nativeConfigFileSystem(async () => directory, () => '/home/me'),
      knownProviders: async () => {
        const listKnownProviders = await lazy()
        return listKnownProviders({ request: async () => { throw new Error('connection refused') } }, target)
      },
      onSaved: () => undefined,
    })
    const snapshot = await service.read(target)
    expect(snapshot.knownProviders).toEqual([])
    expect(snapshot.parseError).toBeNull()
  })
})
