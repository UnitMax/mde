import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const dependencyFingerprintFile = '.mde-windows-deps-fingerprint'

const lifecycleScriptNames = [
  'preinstall',
  'install',
  'postinstall',
  'prepublish',
  'prepare',
  'postprepare',
]

const packageMetadataNames = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'overrides',
  'engines',
  'packageManager',
]

const requiredPackagePaths = [
  'node_modules/electron/package.json',
  'node_modules/electron-vite/package.json',
  'node_modules/node-pty/package.json',
]

function normalizedPackageJson(packageJson) {
  const metadata = Object.fromEntries(
    packageMetadataNames
      .filter((name) => packageJson[name] !== undefined)
      .map((name) => [name, packageJson[name]])
  )
  const scripts = Object.fromEntries(
    lifecycleScriptNames
      .filter((name) => packageJson.scripts?.[name] !== undefined)
      .map((name) => [name, packageJson.scripts[name]])
  )

  return { metadata, scripts }
}

function normalizedPackageLock(packageLock) {
  const normalized = JSON.parse(JSON.stringify(packageLock))
  const rootPackage = normalized.packages?.['']

  // The application version changes independently of dependency installation.
  // Ignore it so the normal version bump does not trigger npm ci.
  delete normalized.name
  delete normalized.version
  if (rootPackage) {
    delete rootPackage.name
    delete rootPackage.version
  }

  return normalized
}

export function createDependencyFingerprint({
  packageJson,
  packageLock,
  npmrc = '',
  platform,
  arch,
  nodeVersion,
  npmVersion,
}) {
  const input = {
    packageJson: normalizedPackageJson(packageJson),
    packageLock: normalizedPackageLock(packageLock),
    npmrc,
    runtime: { platform, arch, nodeVersion, npmVersion },
  }

  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

export function dependenciesNeedInstall({ rootDirectory, fingerprint, force = false }) {
  if (force) return true

  const stampPath = join(rootDirectory, dependencyFingerprintFile)
  if (!existsSync(stampPath)) return true
  if (readFileSync(stampPath, 'utf8').trim() !== fingerprint) return true

  return requiredPackagePaths.some((path) => !existsSync(join(rootDirectory, path)))
}

function npmVersion() {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = spawnSync(npmCommand, ['--version'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Unable to determine npm version (exit code ${result.status ?? 'unknown'})`)
  }

  return result.stdout.trim()
}

function installDependencies(rootDirectory) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = spawnSync(
    npmCommand,
    ['ci', '--prefer-offline', '--no-audit', '--no-fund'],
    { cwd: rootDirectory, shell: process.platform === 'win32', stdio: 'inherit' }
  )
  if (result.error) throw result.error
  return result.status ?? 1
}

export function ensureWindowsDependencies({
  rootDirectory = process.cwd(),
  force = false,
  install = installDependencies,
  platform = process.platform,
  arch = process.arch,
  nodeVersion = process.version,
  npmVersionValue = npmVersion(),
} = {}) {
  const packageJson = JSON.parse(readFileSync(join(rootDirectory, 'package.json'), 'utf8'))
  const packageLock = JSON.parse(readFileSync(join(rootDirectory, 'package-lock.json'), 'utf8'))
  const npmrcPath = join(rootDirectory, '.npmrc')
  const npmrc = existsSync(npmrcPath) ? readFileSync(npmrcPath, 'utf8') : ''
  const fingerprint = createDependencyFingerprint({
    packageJson,
    packageLock,
    npmrc,
    platform,
    arch,
    nodeVersion,
    npmVersion: npmVersionValue,
  })

  if (!dependenciesNeedInstall({ rootDirectory, fingerprint, force })) {
    console.log('Windows dependencies unchanged; reusing node_modules.')
    return false
  }

  console.log('Installing Windows dependencies with npm ci...')
  const status = install(rootDirectory)
  if (status !== 0) {
    throw new Error(`npm ci failed with exit code ${status}`)
  }

  writeFileSync(join(rootDirectory, dependencyFingerprintFile), `${fingerprint}\n`)
  console.log('Windows dependency fingerprint updated.')
  return true
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
const modulePath = fileURLToPath(import.meta.url)

if (invokedPath === modulePath) {
  if (process.platform !== 'win32') {
    throw new Error('Windows dependencies must be installed with native Windows Node.js.')
  }

  ensureWindowsDependencies({ force: process.argv.includes('--force') })
}
