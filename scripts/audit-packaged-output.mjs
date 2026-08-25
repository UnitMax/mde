import { open, readdir, rm, stat } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const chunkSize = 1024 * 1024

// electron-builder writes these debug dumps beside the release artifacts on every
// packaging run. They record absolute paths from the build machine, so they must
// never travel with the artifacts they sit next to.
export const buildMetadataFiles = ['builder-debug.yml', 'builder-effective-config.yaml']

function usableNeedle(value) {
  return typeof value === 'string' && value.length >= 4 && value !== '/'
}

// Only account-specific paths are needles. A bare `C:\Users\` would flag third-party
// fixtures such as node-pty's shipped tests, which quote a stranger's desktop path.
export function privatePathNeedles({
  homeDirectory = homedir(),
  username = userInfo().username,
  rootDirectory = projectRoot,
} = {}) {
  const candidates = [
    { label: 'build machine home directory', value: homeDirectory },
    { label: 'project root directory', value: rootDirectory },
    { label: 'Linux home path', value: `/home/${username}` },
    { label: 'macOS home path', value: `/Users/${username}` },
    { label: 'Windows profile path', value: `C:\\Users\\${username}` },
    { label: 'WSL view of the Windows profile', value: `/mnt/c/Users/${username}` },
    { label: 'electron-builder cache path', value: '.cache/electron-builder' },
  ]

  const seen = new Set()
  const needles = []
  for (const candidate of candidates) {
    if (!usableNeedle(candidate.value)) continue
    const key = candidate.value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    needles.push(candidate)
  }
  return needles
}

// Paths leak in more shapes than they were written in: JSON escapes backslashes,
// and Electron string tables are UTF-16. Match case-insensitively because Windows
// paths survive round trips with their casing changed.
function lowercaseAscii(buffer) {
  const lowered = Buffer.from(buffer)
  for (let index = 0; index < lowered.length; index += 1) {
    const byte = lowered[index]
    if (byte >= 0x41 && byte <= 0x5a) lowered[index] = byte + 0x20
  }
  return lowered
}

export function needleMatchers(needles) {
  const matchers = []
  for (const needle of needles) {
    const variants = new Set([needle.value])
    if (needle.value.includes('\\')) variants.add(needle.value.replaceAll('\\', '\\\\'))
    for (const value of variants) {
      for (const encoding of ['utf8', 'utf16le']) {
        matchers.push({
          label: needle.label,
          value,
          encoding,
          pattern: lowercaseAscii(Buffer.from(value.toLowerCase(), encoding)),
        })
      }
    }
  }
  return matchers
}

export async function scanFileForNeedles(filePath, matchers) {
  if (matchers.length === 0) return []

  const overlap = Math.max(...matchers.map((matcher) => matcher.pattern.length)) - 1
  const findings = []
  const found = new Set()
  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.allocUnsafe(chunkSize)
    let carry = Buffer.alloc(0)
    let position = 0

    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, chunkSize, position)
      if (bytesRead === 0) break

      const window = Buffer.concat([carry, lowercaseAscii(buffer.subarray(0, bytesRead))])
      const windowStart = position - carry.length
      for (const matcher of matchers) {
        const key = `${matcher.value}\u0000${matcher.encoding}`
        if (found.has(key)) continue
        const index = window.indexOf(matcher.pattern)
        if (index === -1) continue
        found.add(key)
        findings.push({
          file: filePath,
          label: matcher.label,
          value: matcher.value,
          encoding: matcher.encoding,
          offset: windowStart + index,
        })
      }

      position += bytesRead
      carry = window.subarray(Math.max(0, window.length - overlap))
    }
  } finally {
    await handle.close()
  }
  return findings
}

async function* walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      yield* walkFiles(entryPath)
    } else if (entry.isFile()) {
      yield entryPath
    }
  }
}

export async function removeBuildMetadata(outputDirectory) {
  const removed = []
  for (const name of buildMetadataFiles) {
    const metadataPath = join(outputDirectory, name)
    const exists = await stat(metadataPath).then(() => true, () => false)
    if (!exists) continue
    await rm(metadataPath, { force: true })
    removed.push(name)
  }
  return removed
}

export async function auditPackagedOutput({
  outputDirectory,
  allowMissing = false,
  ...needleOptions
} = {}) {
  const directory = resolve(outputDirectory ?? join(projectRoot, 'dist'))
  const directoryExists = await stat(directory).then(
    (entry) => entry.isDirectory(),
    () => false,
  )
  if (!directoryExists) {
    // A commit-time run usually has nothing packaged yet; a run that names its
    // own directory asked for that directory and should fail when it is absent.
    if (!allowMissing) throw new Error(`Packaged output directory does not exist: ${directory}`)
    return { directory, missing: true, removed: [], scannedFiles: 0, findings: [] }
  }

  const removed = await removeBuildMetadata(directory)
  const matchers = needleMatchers(privatePathNeedles(needleOptions))
  const findings = []
  let scannedFiles = 0

  for await (const filePath of walkFiles(directory)) {
    scannedFiles += 1
    const fileFindings = await scanFileForNeedles(filePath, matchers)
    for (const finding of fileFindings) {
      findings.push({ ...finding, file: relative(directory, filePath) })
    }
  }

  return { directory, missing: false, removed, scannedFiles, findings }
}

function readDirectoryArgument(argv) {
  for (const [index, argument] of argv.entries()) {
    if (argument.startsWith('--directory=')) return argument.slice('--directory='.length)
    if (argument === '--directory') return argv[index + 1]
  }
  return undefined
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath === fileURLToPath(import.meta.url)) {
  const outputDirectory = readDirectoryArgument(process.argv.slice(2))
  const { directory, missing, removed, scannedFiles, findings } = await auditPackagedOutput(
    outputDirectory ? { outputDirectory } : { allowMissing: true },
  )

  if (missing) {
    console.log(`No packaged output in ${directory}; nothing to audit.`)
    process.exit(0)
  }

  if (removed.length > 0) {
    console.log(`Removed build metadata dumps: ${removed.join(', ')}`)
  }

  if (findings.length === 0) {
    console.log(`No private paths found in ${scannedFiles} packaged files under ${directory}.`)
  } else {
    console.error(`Private paths found in packaged output under ${directory}:`)
    for (const finding of findings) {
      console.error(`  ${finding.file}: ${finding.label} (${finding.encoding}) "${finding.value}" at byte ${finding.offset}`)
    }
    console.error('Remove the leaking content and rebuild before publishing these artifacts.')
    process.exitCode = 1
  }
}
