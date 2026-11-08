import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readContainedFile } from '../src/main/files/read'
import { WINDOWS_CONTAINED_READER } from '../src/main/files/windows-read'
import { resolveWindowsShell } from '../src/main/windows-executable'

/** Junctions need no symlink privilege. These tests run on native Windows, including CI. */
describe.skipIf(process.platform !== 'win32')('native Windows contained file reads', () => {
  let base: string
  let root: string
  let sub: string
  let parked: string
  let outside: string
  let file: string
  let redirected: boolean
  beforeEach(async () => {
    base = await fs.mkdtemp(join(tmpdir(), 'mde-win-contained-'))
    root = join(base, "root with spaces ' $literal")
    sub = join(root, 'sub')
    parked = join(root, 'parked')
    outside = join(base, 'outside')
    file = join(sub, 'file.txt')
    redirected = false
    await fs.mkdir(sub, { recursive: true })
    await fs.mkdir(outside)
    await fs.writeFile(file, 'inside-fixture')
    await fs.writeFile(join(outside, 'file.txt'), 'outside-fixture-secret')
  })
  const toOutside = async (): Promise<void> => {
    if (redirected) return
    await fs.rename(sub, parked)
    await fs.symlink(outside, sub, 'junction')
    redirected = true
  }
  const toInside = async (): Promise<void> => {
    if (!redirected) return
    await fs.unlink(sub)
    await fs.rename(parked, sub)
    redirected = false
  }
  afterEach(async () => {
    vi.restoreAllMocks()
    await toInside()
    await fs.rm(base, { recursive: true, force: true })
  })

  it('reads bytes, empty files and size limits, with paths passed only as data', async () => {
    expect((await readContainedFile(root, 'sub/file.txt', 100)).bytes?.toString()).toBe('inside-fixture')
    expect(await readContainedFile(root, 'sub/file.txt', 2)).toEqual({ size: 14, bytes: null })
    await fs.writeFile(file, '')
    expect(await readContainedFile(root, 'sub/file.txt', 100)).toEqual({ size: 0, bytes: Buffer.alloc(0) })
    // Successful reads must release the ancestor locks too.
    await fs.rename(sub, parked)
    await fs.rename(parked, sub)
  }, 30_000)

  it('allows an internal junction and rejects an external junction', async () => {
    await fs.symlink(sub, join(root, 'internal'), 'junction')
    expect((await readContainedFile(root, 'internal/file.txt', 100)).bytes?.toString()).toBe('inside-fixture')
    await toOutside()
    await expect(readContainedFile(root, 'sub/file.txt', 100)).rejects.toThrow('outside the session')
  }, 30_000)

  it('closes the reproduced repeated-junction realpath/stat race', async () => {
    const realpath = fs.realpath.bind(fs)
    // On the old implementation each verify returned an inside pathname, then
    // stat/open followed the replacement junction and accepted outside bytes.
    vi.spyOn(fs, 'realpath').mockImplementation((async (path) => {
      if (path === file) {
        await toInside()
        const canonical = await realpath(path)
        await toOutside()
        return canonical
      }
      return realpath(path)
    }) as typeof fs.realpath)
    await expect(readContainedFile(root, 'sub/file.txt', 100)).rejects.toThrow('could not be opened safely')
    vi.restoreAllMocks()
    await toInside()
    expect((await readContainedFile(root, 'sub/file.txt', 100)).bytes?.toString()).toBe('inside-fixture')
  }, 30_000)

  it('pins ancestors against both rename and write handles until released', async () => {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "Add-Type -TypeDefinition @'", WINDOWS_CONTAINED_READER, "'@",
      "$flags = [Reflection.BindingFlags]'NonPublic,Static'",
      "$create = [MdeContainedReader].GetMethod('CreateFileW', $flags)",
      '$arguments = @($env:MDE_PIN_PATH, [uint32]0x40000000, [uint32]7, [IntPtr]::Zero, [uint32]3, [uint32]0x02200000, [IntPtr]::Zero)',
      '$before = $create.Invoke($null, $arguments)',
      'if ($before.IsInvalid) { throw "Fixture is not writable" }; $before.Dispose()',
      "$pin = [MdeContainedReader].GetMethod('Open', $flags).Invoke($null, @($env:MDE_PIN_PATH, $true))",
      'try {',
      '  $write = $create.Invoke($null, $arguments)',
      '  try { if (!$write.IsInvalid) { throw "Directory write sharing was permitted" } } finally { $write.Dispose() }',
      '  $blocked = $false',
      '  try { [IO.Directory]::Move($env:MDE_PIN_PATH, $env:MDE_PIN_PATH + "-moved") } catch [IO.IOException] { $blocked = $true }',
      '  if (!$blocked) { throw "Ancestor rename was permitted" }',
      '} finally { $pin.Dispose() }',
      '[IO.Directory]::Move($env:MDE_PIN_PATH, $env:MDE_PIN_PATH + "-moved")',
      '[IO.Directory]::Move($env:MDE_PIN_PATH + "-moved", $env:MDE_PIN_PATH)',
      'Write-Output "PIN_LOCKS_OK"',
    ].join('\n')
    const result = await promisify(execFile)(resolveWindowsShell('powershell.exe'), [
      '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'),
    ], { env: { ...process.env, MDE_PIN_PATH: sub }, timeout: 30_000, windowsHide: true })
    expect(result.stdout).toContain('PIN_LOCKS_OK')
  }, 30_000)
})
