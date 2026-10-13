import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createWindowsExecutableResolver } from '../../src/main/windows-executable'
import { runWslCommand, runWslCommandBuffer, listDistros } from '../../src/main/wsl/distros'
import { PtyManager } from '../../src/main/pty/manager'
import { buildLaunchSpec } from '../../src/main/pty/launch'
import { metadataQueryLaunch } from '../../src/main/opencode/sessions'
import type { Session } from '../../src/shared/types'

const run = promisify(execFile)
const palette = { foreground: '#ffffff', background: '#000000' }

/** Real Windows launch checks using scratch files and no interactive shell history. */
export async function runWindowsExecutableCheck(): Promise<void> {
  assert.equal(process.platform, 'win32')
  const resolver = createWindowsExecutableResolver()
  const powershell = resolver.shell()
  const wsl = resolver.wsl()
  const root = await mkdtemp(join(tmpdir(), 'mde-windows-lookup-'))
  const previousCwd = process.cwd()
  const previousPath = process.env.PATH
  const previousSentinel = process.env.MDE_LOOKUP_SENTINEL
  const marker = join(root, 'unexpected-execution.txt')
  let manager: PtyManager | undefined
  try {
    const compiler = join(root, 'sentinel.ps1')
    const sentinel = join(root, 'wsl.exe')
    const source = [
      '$OutputPath = $env:MDE_SENTINEL_BUILD_OUTPUT',
      'Add-Type -TypeDefinition @\'',
      'public class MdeLookupSentinel {',
      '  public static int Main(string[] args) {',
      '    System.IO.File.WriteAllText(System.Environment.GetEnvironmentVariable("MDE_LOOKUP_SENTINEL"), "unexpected execution");',
      '    return 87;',
      '  }',
      '}',
      "'@ -OutputAssembly $OutputPath -OutputType ConsoleApplication",
    ].join('\n')
    await writeFile(compiler, source)
    await run(powershell, ['-NoProfile', '-NonInteractive', '-Command', source], {
      cwd: wsl.cwd, timeout: 30_000, windowsHide: true,
      env: { ...process.env, MDE_SENTINEL_BUILD_OUTPUT: sentinel },
    })
    await copyFile(sentinel, join(root, 'powershell.exe'))
    await copyFile(sentinel, join(root, 'cmd.exe'))
    process.env.MDE_LOOKUP_SENTINEL = marker
    // Prove the harmless sentinel really executes and detects a wrong launch.
    await assert.rejects(run(sentinel, [], { timeout: 10_000 }), (error: unknown) => (error as { code: number }).code === 87)
    assert.equal(await readFile(marker, 'utf8'), 'unexpected execution')
    await rm(marker)

    process.chdir(root)
    process.env.PATH = `${root};${previousPath ?? ''}`
    const distros = await listDistros()
    const distro = process.env.MDE_WSL_DISTRO ?? distros[0]?.name
    assert.ok(distro, 'A WSL distro is required for Windows executable lookup integration checks.')
    assert.ok(distros.some((candidate) => candidate.name === distro))
    const text = await runWslCommand(distro, ['/usr/bin/printf', '%s', 'WINDOWS_LOOKUP_WSL_TEXT'])
    assert.equal(text.code, 0)
    assert.equal(text.stdout, 'WINDOWS_LOOKUP_WSL_TEXT')
    const bytes = await runWslCommandBuffer(distro, ['/usr/bin/printf', '%s', 'WINDOWS_LOOKUP_WSL_BYTES'])
    assert.equal(bytes.code, 0)
    assert.equal(bytes.stdout.toString(), 'WINDOWS_LOOKUP_WSL_BYTES')

    const wslSession: Session = {
      id: 'wsl-fixture', projectId: 'fixture', name: 'Fixture', kind: 'wsl',
      distro, path: '/tmp', createdAt: new Date(0).toISOString(),
    }
    // Exercise the actual history launch specification without touching an agent database.
    const query = metadataQueryLaunch(wslSession, '/usr/bin/printf', 'SELECT fixture', 'fixture', wsl)
    const history = await run(query.spec.file, query.spec.args, {
      cwd: query.spec.cwd, timeout: 30_000, windowsHide: true, encoding: 'utf8',
      env: { ...process.env, WSL_UTF8: '1' },
    })
    assert.ok(history.stdout.includes(query.begin) && history.stdout.includes(query.end))

    const terminalOutput = new Map<string, string>()
    manager = new PtyManager({
      onData: ({ terminalId, data }) => terminalOutput.set(terminalId, (terminalOutput.get(terminalId) ?? '') + data),
      onDirectory: () => {},
      onExit: () => {},
    })
    const nativePath = join(root, 'project with spaces')
    await mkdir(nativePath)
    const nativeSession: Session = { ...wslSession, id: 'native-fixture', kind: 'native', path: nativePath }
    const nativeSpec = buildLaunchSpec(nativeSession, { platform: 'win32', windowsExecutable: { file: powershell } })
    const native = await run(nativeSpec.file, ['-NoProfile', '-NonInteractive', '-Command',
      `${nativeSpec.args[2]}; [Console]::WriteLine("WINDOWS_LOOKUP_NATIVE_OK:" + (Get-Location).Path)`], {
      cwd: nativeSpec.cwd, timeout: 30_000, windowsHide: true,
    })
    assert.ok(native.stdout.includes(`WINDOWS_LOOKUP_NATIVE_OK:${nativePath}`))
    // cmd has no persistent command history; exercise the real native ConPTY path.
    manager.ensure('native', { ...nativeSession, shell: 'cmd.exe' }, { cols: 80, rows: 24 }, palette)
    manager.write('native', 'echo WINDOWS_LOOKUP_NATIVE_PTY_OK\r\nexit\r\n')
    manager.ensure('wsl', wslSession, { cols: 80, rows: 24 }, palette, {
      directory: '/tmp', agent: { executable: '/usr/bin/printf', args: ['%s', 'WINDOWS_LOOKUP_WSL_PTY_OK'] },
    })
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline && (manager.status('native') !== 'exited' || manager.status('wsl') !== 'exited')) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.equal(manager.status('native'), 'exited')
    assert.equal(manager.status('wsl'), 'exited')
    assert.ok(terminalOutput.get('native')?.includes('WINDOWS_LOOKUP_NATIVE_PTY_OK'))
    assert.ok(terminalOutput.get('wsl')?.includes('WINDOWS_LOOKUP_WSL_PTY_OK'))
    await assert.rejects(readFile(marker), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT')
  } finally {
    manager?.disposeAll()
    process.chdir(previousCwd)
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    if (previousSentinel === undefined) delete process.env.MDE_LOOKUP_SENTINEL
    else process.env.MDE_LOOKUP_SENTINEL = previousSentinel
    await rm(root, { recursive: true, force: true })
  }
}
