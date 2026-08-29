import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface PackageManifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

interface PackageLock {
  packages: Record<string, { version?: string } | undefined>
}

const packageJson = JSON.parse(
  readFileSync(resolve(__dirname, '../package.json'), 'utf8')
) as PackageManifest
const packageLock = JSON.parse(
  readFileSync(resolve(__dirname, '../package-lock.json'), 'utf8')
) as PackageLock

describe('direct dependency policy', () => {
  it('pins every direct dependency to its committed lockfile version', () => {
    const directDependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies
    }

    for (const [name, version] of Object.entries(directDependencies)) {
      expect(version, `${name} must use an exact version`).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
      expect(packageLock.packages[`node_modules/${name}`]?.version, name).toBe(version)
    }
  })
})
