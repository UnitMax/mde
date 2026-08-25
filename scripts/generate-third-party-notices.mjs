import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const lockPath = join(root, 'package-lock.json')
const outputPath = join(root, 'THIRD_PARTY_NOTICES.md')
const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
const packages = lock.packages ?? {}
const rootPackage = packages[''] ?? {}
const supplementalLicenseFiles = {
  'node_modules/react-remove-scroll-bar': [{
    name: 'upstream/LICENSE',
    path: join(root, 'scripts', 'license-overrides', 'react-remove-scroll-bar-LICENSE'),
  }],
}

// electron-vite bundles these renderer libraries into the shipped JavaScript
// and CSS. They remain devDependencies so electron-builder does not also copy
// their complete package trees into app.asar, but their runtime dependency
// closures still require attribution.
export const bundledRendererDependencies = [
  '@radix-ui/react-alert-dialog',
  '@radix-ui/react-context-menu',
  '@radix-ui/react-dialog',
  '@radix-ui/react-label',
  '@radix-ui/react-radio-group',
  '@radix-ui/react-select',
  '@radix-ui/react-slot',
  '@xterm/addon-fit',
  '@xterm/addon-webgl',
  '@xterm/xterm',
  'class-variance-authority',
  'clsx',
  'lucide-react',
  'react',
  'react-dom',
  'tailwind-merge',
  'zustand',
]

function packageName(packagePath, metadata) {
  if (typeof metadata.name === 'string' && metadata.name) return metadata.name
  const marker = '/node_modules/'
  const index = packagePath.lastIndexOf(marker)
  return index >= 0 ? packagePath.slice(index + marker.length) : packagePath.replace(/^node_modules\//, '')
}

function packageDirectory(packagePath) {
  return join(root, packagePath)
}

function repositoryUrl(metadata) {
  const repository = metadata.repository
  if (typeof repository === 'string') return repository
  if (repository && typeof repository.url === 'string') return repository.url
  if (typeof metadata.homepage === 'string') return metadata.homepage
  if (typeof metadata.resolved === 'string') return metadata.resolved
  return 'Not declared in package metadata'
}

function licenseFiles(packagePath) {
  const directory = packageDirectory(packagePath)
  if (!existsSync(directory)) return supplementalLicenseFiles[packagePath] ?? []

  const files = []
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        visit(path)
      } else if (entry.isFile() && /^(license|notice)(?:[._-].*)?$/i.test(entry.name)) {
        files.push({ name: relative(directory, path).replaceAll('\\', '/'), path })
      }
    }
  }
  visit(directory)
  files.push(...(supplementalLicenseFiles[packagePath] ?? []))
  return files.sort((a, b) => a.name.localeCompare(b.name))
}

function isPlatformConditioned(metadata) {
  return metadata.optional === true && (metadata.os || metadata.cpu)
}

function dependencyPath(packagePath, dependencyName, packageMetadata = packages) {
  let ancestor = packagePath
  while (true) {
    const candidate = ancestor
      ? `${ancestor}/node_modules/${dependencyName}`
      : `node_modules/${dependencyName}`
    if (packageMetadata[candidate]) return candidate

    const marker = ancestor.lastIndexOf('/node_modules/')
    if (marker >= 0) {
      ancestor = ancestor.slice(0, marker)
    } else if (ancestor.startsWith('node_modules/')) {
      ancestor = ''
    } else {
      return null
    }
  }
}

export function dependencyClosure(rootNames, packageMetadata = packages) {
  const selected = new Set()
  const pending = rootNames.map((name) => ({ name, parentPath: '' }))

  while (pending.length > 0) {
    const dependency = pending.shift()
    const packagePath = dependencyPath(
      dependency.parentPath,
      dependency.name,
      packageMetadata,
    )
    if (!packagePath || selected.has(packagePath)) continue
    selected.add(packagePath)

    const metadata = packageMetadata[packagePath]
    for (const name of Object.keys(metadata.dependencies ?? {})) {
      pending.push({ name, parentPath: packagePath })
    }
  }
  return selected
}

export function attributedPackagePaths(packageMetadata = packages) {
  const selected = new Set(
    Object.entries(packageMetadata)
      .filter(([packagePath, metadata]) => packagePath !== '' && !metadata.dev)
      .map(([packagePath]) => packagePath),
  )
  for (const packagePath of dependencyClosure(bundledRendererDependencies, packageMetadata)) {
    selected.add(packagePath)
  }
  return selected
}

function packageEntries() {
  const attributed = attributedPackagePaths()
  return Object.entries(packages)
    .filter(([packagePath]) => attributed.has(packagePath))
    .map(([packagePath, metadata]) => ({
      packagePath,
      metadata,
      name: packageName(packagePath, metadata),
      version: typeof metadata.version === 'string' ? metadata.version : 'unknown',
      license: typeof metadata.license === 'string' ? metadata.license : 'Not declared',
      repository: repositoryUrl(metadata),
      // Platform-specific optional packages (e.g. esbuild/rollup native binaries)
      // are only present on disk for whichever OS ran npm ci, which would make
      // the rendered notice text differ by host platform. Skip embedding their
      // license file text so output is identical on Linux and Windows; they
      // still appear in the inventory table above from lockfile metadata alone.
      files: isPlatformConditioned(metadata) ? [] : licenseFiles(packagePath)
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version) || a.packagePath.localeCompare(b.packagePath))
}

function directDependencyNames() {
  return new Set([
    ...Object.keys(rootPackage.dependencies ?? {}),
    ...bundledRendererDependencies,
  ])
}

function markdownCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
}

function noticeText(entries) {
  const groups = new Map()
  for (const entry of entries) {
    for (const file of entry.files) {
      const text = readFileSync(file.path, 'utf8').replaceAll('\r\n', '\n').trim()
      if (!text) continue
      const hash = createHash('sha256').update(text).digest('hex')
      const group = groups.get(hash) ?? { text, files: [], packages: [] }
      group.files.push(`${entry.packagePath}/${file.name}`)
      group.packages.push(`${entry.name}@${entry.version}`)
      groups.set(hash, group)
    }
  }
  return [...groups.values()].sort((a, b) => a.packages[0].localeCompare(b.packages[0]))
}

export function renderThirdPartyNotices() {
  const entries = packageEntries()
  const direct = directDependencyNames()
  const notices = noticeText(entries)
  const lines = [
    '# Third-party notices',
    '',
    'MDE first-party source, documentation, scripts, and branding are licensed under the MIT License in `LICENSE`.',
    'This file records third-party packages resolved by `package-lock.json`. Those packages are not relicensed by MDE and remain under their respective licenses.',
    '',
    'The packaged application also includes Electron and Chromium legal files generated by electron-builder:',
    '',
    '- `LICENSE.electron.txt`',
    '- `LICENSES.chromium.html`',
    '',
    'The OpenCode executable is an external dependency and is not bundled or relicensed by MDE.',
    '',
    'The `react-remove-scroll-bar@2.3.8` npm tarball declares MIT but omits its license file. Its notice text below is preserved from the upstream repository license at `https://github.com/theKashey/react-remove-scroll-bar/blob/master/LICENSE`.',
    '',
    '## Locked package inventory',
    '',
    `Generated from \`package-lock.json\` by \`npm run licenses\`. ${entries.length} shipped package entries are listed, including production dependencies and libraries bundled into renderer assets. Build-time-only dependencies are excluded.`,
    '',
    '| Package | Version | Direct dependency | Declared license | Source |',
    '| --- | --- | --- | --- | --- |'
  ]

  for (const entry of entries) {
    lines.push(
      `| \`${markdownCell(entry.name)}\` | \`${markdownCell(entry.version)}\` | ${direct.has(entry.name) ? 'yes' : 'no'} | ${markdownCell(entry.license)} | ${markdownCell(entry.repository)} |`
    )
  }

  lines.push('', '## Package-provided license and notice text', '')
  lines.push(
    'The sections below preserve distinct `LICENSE*` and `NOTICE*` files found in the installed package trees. The package inventory above identifies which packages each text belongs to.'
  )

  for (const [index, notice] of notices.entries()) {
    lines.push('', `### Notice text ${index + 1}`, '', `Packages: ${notice.packages.map((name) => `\`${name}\``).join(', ')}`, '')
    lines.push('Files:', '', ...notice.files.map((file) => `- \`${file}\``), '')
    lines.push('~~~text', notice.text, '~~~')
  }

  return `${lines.join('\n')}\n`
}

export function generateThirdPartyNotices({ check = false } = {}) {
  const entryCount = packageEntries().length
  const rendered = renderThirdPartyNotices()
  if (check) {
    const current = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : ''
    if (current !== rendered) {
      console.error('THIRD_PARTY_NOTICES.md is out of date. Run `npm run licenses` and commit the result.')
      process.exitCode = 1
    }
  } else {
    writeFileSync(outputPath, rendered)
    console.log(`Wrote ${relative(root, outputPath)} from ${entryCount} shipped package entries.`)
  }
  return { entryCount, rendered }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath === fileURLToPath(import.meta.url)) {
  generateThirdPartyNotices({ check: process.argv.includes('--check') })
}
