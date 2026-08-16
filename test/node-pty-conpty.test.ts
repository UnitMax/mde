import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  stageConptyFiles,
  stageDevelopmentConpty,
} from '../scripts/stage-node-pty-conpty.mjs'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'mde-conpty-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

describe('bundled ConPTY staging', () => {
  it('copies the runtime DLL and host executable beside the native module', async () => {
    const root = await temporaryDirectory()
    const sourceDirectory = join(root, 'source')
    const destinationDirectory = join(root, 'destination')
    await mkdir(sourceDirectory)
    await writeFile(join(sourceDirectory, 'conpty.dll'), 'dll')
    await writeFile(join(sourceDirectory, 'OpenConsole.exe'), 'host')

    const destinations = await stageConptyFiles({ sourceDirectory, destinationDirectory })

    expect(destinations).toEqual([
      join(destinationDirectory, 'conpty.dll'),
      join(destinationDirectory, 'OpenConsole.exe'),
    ])
    expect(await readFile(join(destinationDirectory, 'conpty.dll'), 'utf8')).toBe('dll')
    expect(await readFile(join(destinationDirectory, 'OpenConsole.exe'), 'utf8')).toBe('host')
  })

  it('fails before creating a partial destination when an artifact is missing', async () => {
    const root = await temporaryDirectory()
    const sourceDirectory = join(root, 'source')
    const destinationDirectory = join(root, 'destination')
    await mkdir(sourceDirectory)
    await writeFile(join(sourceDirectory, 'conpty.dll'), 'dll')

    await expect(stageConptyFiles({ sourceDirectory, destinationDirectory })).rejects.toThrow()
    await expect(access(destinationDirectory)).rejects.toThrow()
  })

  it('does nothing during non-Windows development installs', async () => {
    const rootDirectory = await temporaryDirectory()

    await expect(stageDevelopmentConpty({
      platform: 'linux',
      rootDirectory,
    })).resolves.toEqual([])
  })

  it('stages the x64 prebuild after a Windows development rebuild', async () => {
    const rootDirectory = await temporaryDirectory()
    const sourceDirectory = join(
      rootDirectory,
      'node_modules',
      'node-pty',
      'prebuilds',
      'win32-x64',
      'conpty',
    )
    await mkdir(sourceDirectory, { recursive: true })
    await writeFile(join(sourceDirectory, 'conpty.dll'), 'dll')
    await writeFile(join(sourceDirectory, 'OpenConsole.exe'), 'host')

    const destinations = await stageDevelopmentConpty({
      platform: 'win32',
      arch: 'x64',
      rootDirectory,
    })

    expect(destinations).toEqual([
      join(rootDirectory, 'node_modules', 'node-pty', 'build', 'Release', 'conpty', 'conpty.dll'),
      join(rootDirectory, 'node_modules', 'node-pty', 'build', 'Release', 'conpty', 'OpenConsole.exe'),
    ])
  })
})
