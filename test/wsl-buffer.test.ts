import { afterEach, describe, expect, it, vi } from 'vitest'

const execFileMock = vi.hoisted(() => vi.fn())
vi.mock('../src/main/exec-host', () => ({ execFile: execFileMock }))

import { isWslAvailable, runWslCommandBuffer } from '../src/main/wsl/distros'
import * as hostExecutables from '../src/main/windows-executable'

describe('runWslCommandBuffer', () => {
  afterEach(() => {
    execFileMock.mockReset()
    vi.restoreAllMocks()
  })

  it('returns stdout bytes untouched, even when they look like UTF-16', async () => {
    // ASCII with interleaved NULs is what decodeWslOutput treats as UTF-16LE.
    const bytes = Buffer.from('a\u0000b\u0000c\u0000d\u0000e\u0000', 'latin1')
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      callback(null, bytes, Buffer.from('warning\n'))
    })

    const result = await runWslCommandBuffer('Ubuntu-24.04', ['cat', '/tmp/x'], { maxBuffer: 1024 })

    expect(result.stdout.equals(bytes)).toBe(true)
    expect(result.stderr).toBe('warning\n')
    expect(result.code).toBe(0)
    expect(execFileMock).toHaveBeenCalledWith(
      'wsl.exe',
      ['-d', 'Ubuntu-24.04', '-e', 'cat', '/tmp/x'],
      expect.objectContaining({ encoding: 'buffer', maxBuffer: 1024 }),
      expect.any(Function)
    )
  })

  it('reports the exit code of a failed command', async () => {
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      callback(Object.assign(new Error('failed'), { code: 12 }), Buffer.alloc(0), Buffer.alloc(0))
    })
    await expect(runWslCommandBuffer('Ubuntu-24.04', ['false'])).resolves.toMatchObject({ code: 12 })
  })

  it('uses the pinned Windows executable and host cwd for binary queries', async () => {
    const executable = { file: 'D:\\Windows\\System32\\wsl.exe', cwd: 'D:\\Windows\\System32' }
    vi.spyOn(hostExecutables, 'resolveWslExecutable').mockReturnValue(executable)
    execFileMock.mockImplementation((_file, _args, _options, callback) => callback(null, Buffer.from('ok'), Buffer.alloc(0)))
    await runWslCommandBuffer('Ubuntu-24.04', ['cat', '/tmp/x'])
    expect(execFileMock).toHaveBeenCalledWith(executable.file, expect.any(Array),
      expect.objectContaining({ cwd: executable.cwd }), expect.any(Function))
  })

  it('does not launch anything when trusted WSL resolution fails', async () => {
    vi.spyOn(hostExecutables, 'resolveWslExecutable').mockImplementation(() => { throw new Error('WSL unavailable') })
    await expect(runWslCommandBuffer('Ubuntu-24.04', ['true'])).rejects.toThrow('WSL unavailable')
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('reports unavailable WSL without rejecting the application availability check', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    vi.spyOn(hostExecutables, 'resolveWslExecutable').mockImplementation(() => { throw new Error('WSL unavailable') })
    await expect(isWslAvailable()).resolves.toBe(false)
    expect(execFileMock).not.toHaveBeenCalled()
  })
})
