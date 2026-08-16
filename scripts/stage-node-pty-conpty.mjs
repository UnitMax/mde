import { access, copyFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const windowsArch = 'x64'
const artifacts = ['conpty.dll', 'OpenConsole.exe']

export async function stageConptyFiles({ sourceDirectory, destinationDirectory }) {
  const sources = artifacts.map((artifact) => join(sourceDirectory, artifact))
  await Promise.all(sources.map((source) => access(source)))
  await mkdir(destinationDirectory, { recursive: true })

  const destinations = artifacts.map((artifact) => join(destinationDirectory, artifact))
  await Promise.all(sources.map((source, index) => copyFile(source, destinations[index])))
  return destinations
}

function bundledConptyDirectory(rootDirectory) {
  return join(
    rootDirectory,
    'node_modules',
    'node-pty',
    'prebuilds',
    `win32-${windowsArch}`,
    'conpty',
  )
}

export async function stageDevelopmentConpty({
  platform = process.platform,
  arch = process.arch,
  rootDirectory = projectRoot,
} = {}) {
  if (platform !== 'win32') return []
  if (arch !== windowsArch) {
    throw new Error(`Bundled ConPTY staging only supports ${windowsArch}; received ${arch}`)
  }

  const destinations = await stageConptyFiles({
    sourceDirectory: bundledConptyDirectory(rootDirectory),
    destinationDirectory: join(
      rootDirectory,
      'node_modules',
      'node-pty',
      'build',
      'Release',
      'conpty',
    ),
  })
  console.log(`Staged bundled ConPTY for development: ${destinations.join(', ')}`)
  return destinations
}

export default async function stagePackagedConpty(context) {
  if (context.electronPlatformName !== 'win32') return

  // electron-builder performs its own native rebuild after the root
  // postinstall, so restore the development layout as well as the package.
  await stageDevelopmentConpty({
    platform: 'win32',
    arch: windowsArch,
    rootDirectory: projectRoot,
  })

  const destinations = await stageConptyFiles({
    sourceDirectory: bundledConptyDirectory(projectRoot),
    destinationDirectory: join(
      context.appOutDir,
      'resources',
      'app.asar.unpacked',
      'node_modules',
      'node-pty',
      'build',
      'Release',
      'conpty',
    ),
  })
  console.log(`Staged bundled ConPTY in packaged application: ${destinations.join(', ')}`)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath === fileURLToPath(import.meta.url)) await stageDevelopmentConpty()
