import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  auditPackagedOutput,
  buildMetadataFiles,
  needleMatchers,
  privatePathNeedles,
  removeBuildMetadata,
  scanFileForNeedles,
} from '../scripts/audit-packaged-output.mjs'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'mde-audit-'))
  temporaryDirectories.push(directory)
  return directory
}

const buildMachine = {
  homeDirectory: '/home/builder',
  username: 'builder',
  rootDirectory: '/home/builder/dev/mde',
}

function matchers() {
  return needleMatchers(privatePathNeedles(buildMachine))
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

describe('private path needles', () => {
  it('covers the build machine, the project root, and Windows profile paths', () => {
    const values = privatePathNeedles(buildMachine).map((needle) => needle.value)

    expect(values).toContain('/home/builder')
    expect(values).toContain('/home/builder/dev/mde')
    expect(values).toContain('C:\\Users\\builder')
    expect(values).toContain('/mnt/c/Users/builder')
    expect(values).toContain('.cache/electron-builder')
  })

  it('ignores profile roots that belong to nobody in particular', () => {
    const values = privatePathNeedles(buildMachine).map((needle) => needle.value)

    expect(values).not.toContain('C:\\Users\\')
    expect(values).not.toContain('/mnt/c/Users/')
  })

  it('does not repeat a value the home directory already covers', () => {
    const values = privatePathNeedles(buildMachine).map((needle) => needle.value)

    expect(values.filter((value) => value === '/home/builder')).toHaveLength(1)
  })

  it('drops needles too short to identify anything', () => {
    const values = privatePathNeedles({ ...buildMachine, homeDirectory: '/' }).map((needle) => (
      needle.value
    ))

    expect(values).not.toContain('/')
  })
})

describe('scanning packaged files', () => {
  it('finds a UTF-8 path', async () => {
    const directory = await temporaryDirectory()
    const file = join(directory, 'main.js')
    await writeFile(file, 'const cache = "/home/builder/.cache/mde"')

    const findings = await scanFileForNeedles(file, matchers())

    expect(findings.map((finding) => finding.value)).toContain('/home/builder')
    expect(findings[0]?.encoding).toBe('utf8')
  })

  it('finds a UTF-16 path such as an installer string table', async () => {
    const directory = await temporaryDirectory()
    const file = join(directory, 'setup.bin')
    await writeFile(file, Buffer.from('C:\\Users\\builder\\dev', 'utf16le'))

    const findings = await scanFileForNeedles(file, matchers())

    expect(findings.some((finding) => finding.encoding === 'utf16le')).toBe(true)
  })

  it('finds a JSON-escaped Windows path regardless of casing', async () => {
    const directory = await temporaryDirectory()
    const file = join(directory, 'config.json')
    await writeFile(file, '{"out":"c:\\\\users\\\\builder\\\\dist"}')

    const findings = await scanFileForNeedles(file, matchers())

    expect(findings.some((finding) => finding.value.includes('\\\\'))).toBe(true)
  })

  it('finds a path split across a read boundary', async () => {
    const directory = await temporaryDirectory()
    const file = join(directory, 'large.bin')
    const padding = 'a'.repeat(1024 * 1024 - 5)
    await writeFile(file, `${padding}/home/builder/dev/mde`)

    const findings = await scanFileForNeedles(file, matchers())

    expect(findings.map((finding) => finding.value)).toContain('/home/builder')
  })

  it('reports each needle once per file', async () => {
    const directory = await temporaryDirectory()
    const file = join(directory, 'repeated.txt')
    await writeFile(file, '/home/builder /home/builder /home/builder')

    const findings = await scanFileForNeedles(file, matchers())

    expect(findings.filter((finding) => finding.value === '/home/builder')).toHaveLength(1)
  })

  it('leaves clean output alone', async () => {
    const directory = await temporaryDirectory()
    const file = join(directory, 'clean.js')
    await writeFile(file, 'const example = "/home/me/src/app"')

    expect(await scanFileForNeedles(file, matchers())).toEqual([])
  })

  it('leaves a third-party fixture quoting another account alone', async () => {
    const directory = await temporaryDirectory()
    const file = join(directory, 'windowsPtyAgent.test.js')
    await writeFile(file, "check('cmd.exe', ['/k', '\"C:\\\\Users\\\\alros\\\\Desktop\\\\test.bat\"'])")

    expect(await scanFileForNeedles(file, matchers())).toEqual([])
  })
})

describe('auditing a packaged output directory', () => {
  it('removes build metadata dumps before scanning', async () => {
    const directory = await temporaryDirectory()
    await writeFile(join(directory, 'builder-debug.yml'), '!include "/home/builder/dev/mde/x.nsh"')
    await writeFile(join(directory, 'builder-effective-config.yaml'), 'appId: dev.mde.app')

    const result = await auditPackagedOutput({ outputDirectory: directory, ...buildMachine })

    expect(result.removed).toEqual(buildMetadataFiles)
    expect(result.missing).toBe(false)
    expect(result.findings).toEqual([])
    expect(result.scannedFiles).toBe(0)
  })

  it('reports leaks in nested artifacts with paths relative to the output directory', async () => {
    const directory = await temporaryDirectory()
    const resources = join(directory, 'linux-unpacked', 'resources')
    await mkdir(resources, { recursive: true })
    await writeFile(join(resources, 'app.asar'), 'built from /home/builder/dev/mde')

    const result = await auditPackagedOutput({ outputDirectory: directory, ...buildMachine })

    expect(result.scannedFiles).toBe(1)
    expect(result.findings.map((finding) => finding.file)).toEqual([
      join('linux-unpacked', 'resources', 'app.asar'),
      join('linux-unpacked', 'resources', 'app.asar'),
    ])
    expect(result.findings.map((finding) => finding.value)).toEqual([
      '/home/builder',
      '/home/builder/dev/mde',
    ])
  })

  it('fails when a named packaged output directory is missing', async () => {
    const directory = await temporaryDirectory()

    await expect(auditPackagedOutput({
      outputDirectory: join(directory, 'dist'),
      ...buildMachine,
    })).rejects.toThrow(/does not exist/)
  })

  it('reports nothing to audit when a commit-time run finds no packaged output', async () => {
    const directory = await temporaryDirectory()

    const result = await auditPackagedOutput({
      outputDirectory: join(directory, 'dist'),
      allowMissing: true,
      ...buildMachine,
    })

    expect(result.missing).toBe(true)
    expect(result.findings).toEqual([])
    expect(result.scannedFiles).toBe(0)
  })

  it('ignores an output directory without metadata dumps', async () => {
    const directory = await temporaryDirectory()

    expect(await removeBuildMetadata(directory)).toEqual([])
  })
})
