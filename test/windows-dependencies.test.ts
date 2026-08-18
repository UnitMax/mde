import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDependencyFingerprint,
  dependenciesNeedInstall,
  dependencyFingerprintFile,
  ensureWindowsDependencies,
} from '../scripts/ensure-windows-dependencies.mjs'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'mde-windows-deps-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

function packageJson(version = '0.0.22') {
  return {
    name: 'mde',
    version,
    dependencies: { 'node-pty': '^1.1.0' },
    devDependencies: { electron: '^43.4.0' },
    scripts: { postinstall: 'electron-rebuild --force --only node-pty' },
  }
}

function packageLock(version = '0.0.22') {
  return {
    name: 'mde',
    version,
    lockfileVersion: 3,
    packages: {
      '': {
        name: 'mde',
        version,
        dependencies: { 'node-pty': '^1.1.0' },
        devDependencies: { electron: '^43.4.0' },
      },
      'node_modules/electron': { version: '43.4.0' },
      'node_modules/node-pty': { version: '1.1.0' },
    },
  }
}

const fingerprintOptions = {
  npmrc: '',
  platform: 'win32',
  arch: 'x64',
  nodeVersion: 'v24.15.0',
  npmVersion: '11.13.0',
}

describe('Windows dependency fingerprinting', () => {
  it('ignores application version changes', () => {
    const original = createDependencyFingerprint({
      packageJson: packageJson(),
      packageLock: packageLock(),
      ...fingerprintOptions,
    })
    const bumped = createDependencyFingerprint({
      packageJson: packageJson('0.0.23'),
      packageLock: packageLock('0.0.23'),
      ...fingerprintOptions,
    })

    expect(bumped).toBe(original)
  })

  it('changes when dependencies or native runtime inputs change', () => {
    const original = createDependencyFingerprint({
      packageJson: packageJson(),
      packageLock: packageLock(),
      ...fingerprintOptions,
    })
    const dependencyChanged = createDependencyFingerprint({
      packageJson: { ...packageJson(), dependencies: { 'node-pty': '^1.2.0' } },
      packageLock: packageLock(),
      ...fingerprintOptions,
    })
    const runtimeChanged = createDependencyFingerprint({
      packageJson: packageJson(),
      packageLock: packageLock(),
      ...fingerprintOptions,
      nodeVersion: 'v24.16.0',
    })

    expect(dependencyChanged).not.toBe(original)
    expect(runtimeChanged).not.toBe(original)
  })

  it('requires installation when the stamp or required packages are missing', async () => {
    const rootDirectory = await temporaryDirectory()
    const fingerprint = 'fingerprint'

    expect(dependenciesNeedInstall({ rootDirectory, fingerprint })).toBe(true)

    await writeFile(join(rootDirectory, dependencyFingerprintFile), `${fingerprint}\n`)
    expect(dependenciesNeedInstall({ rootDirectory, fingerprint })).toBe(true)

    await mkdir(join(rootDirectory, 'node_modules', 'electron'), { recursive: true })
    await mkdir(join(rootDirectory, 'node_modules', 'electron-vite'), { recursive: true })
    await mkdir(join(rootDirectory, 'node_modules', 'node-pty'), { recursive: true })
    await writeFile(join(rootDirectory, 'node_modules', 'electron', 'package.json'), '{}')
    await writeFile(join(rootDirectory, 'node_modules', 'electron-vite', 'package.json'), '{}')
    await writeFile(join(rootDirectory, 'node_modules', 'node-pty', 'package.json'), '{}')

    expect(dependenciesNeedInstall({ rootDirectory, fingerprint })).toBe(false)
  })

  it('installs and records the fingerprint only when dependencies are stale', async () => {
    const rootDirectory = await temporaryDirectory()
    await writeFile(join(rootDirectory, 'package.json'), JSON.stringify(packageJson()))
    await writeFile(join(rootDirectory, 'package-lock.json'), JSON.stringify(packageLock()))
    const install = vi.fn(() => 0)

    expect(ensureWindowsDependencies({
      rootDirectory,
      install,
      ...fingerprintOptions,
      npmVersionValue: fingerprintOptions.npmVersion,
    })).toBe(true)
    expect(install).toHaveBeenCalledOnce()

    await mkdir(join(rootDirectory, 'node_modules', 'electron'), { recursive: true })
    await mkdir(join(rootDirectory, 'node_modules', 'electron-vite'), { recursive: true })
    await mkdir(join(rootDirectory, 'node_modules', 'node-pty'), { recursive: true })
    await writeFile(join(rootDirectory, 'node_modules', 'electron', 'package.json'), '{}')
    await writeFile(join(rootDirectory, 'node_modules', 'electron-vite', 'package.json'), '{}')
    await writeFile(join(rootDirectory, 'node_modules', 'node-pty', 'package.json'), '{}')

    expect(ensureWindowsDependencies({
      rootDirectory,
      install,
      ...fingerprintOptions,
      npmVersionValue: fingerprintOptions.npmVersion,
    })).toBe(false)
    expect(install).toHaveBeenCalledOnce()
  })
})
