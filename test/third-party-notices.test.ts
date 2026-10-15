import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import {
  attributedPackagePaths,
  bundledRendererDependencies,
  dependencyClosure,
  renderThirdPartyNotices,
} from '../scripts/generate-third-party-notices.mjs'

describe('third-party notice package selection', () => {
  it('tracks every renderer library that is bundled into shipped assets', () => {
    expect(bundledRendererDependencies).toEqual(expect.arrayContaining([
      '@radix-ui/react-dialog',
      '@tiptap/extension-table',
      '@tiptap/extension-code-block',
      '@tiptap/markdown',
      '@tiptap/react',
      '@tiptap/starter-kit',
      '@xterm/xterm',
      'lucide-react',
      'mermaid',
      'dompurify',
      'react',
      'react-dom',
      'zustand',
    ]))
  })

  it('includes transitive dependencies of bundled renderer libraries', () => {
    const packages = {
      '': {},
      'node_modules/ui': { dev: true, dependencies: { helper: '^1.0.0' } },
      'node_modules/helper': { dev: true },
      'node_modules/unrelated-build-tool': { dev: true },
    }

    expect(dependencyClosure(['ui'], packages)).toEqual(new Set([
      'node_modules/ui',
      'node_modules/helper',
    ]))
  })

  it('combines production packages with the renderer bundle closure', () => {
    const packages = {
      '': {},
      'node_modules/node-pty': { dependencies: { 'native-helper': '^1.0.0' } },
      'node_modules/native-helper': {},
      'node_modules/react': { dev: true, dependencies: { scheduler: '^1.0.0' } },
      'node_modules/scheduler': { dev: true },
      'node_modules/unrelated-build-tool': { dev: true },
    }

    const selected = attributedPackagePaths(packages)

    expect(selected).toEqual(new Set([
      'node_modules/node-pty',
      'node_modules/native-helper',
      'node_modules/react',
      'node_modules/scheduler',
    ]))
  })

  it('includes the upstream license omitted from react-remove-scroll-bar npm package', () => {
    const rendered = renderThirdPartyNotices()

    expect(rendered).toContain('Packages: `react-remove-scroll-bar@2.3.8`')
    expect(rendered).toContain('node_modules/react-remove-scroll-bar/upstream/LICENSE')
  })

  it('accepts CRLF checkouts but rejects changed notice content', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mde-notices-check-'))
    const run = promisify(execFile)
    try {
      await mkdir(join(directory, 'scripts'))
      const script = join(directory, 'scripts', 'generate-third-party-notices.mjs')
      await copyFile(resolve('scripts/generate-third-party-notices.mjs'), script)
      await writeFile(join(directory, 'package-lock.json'), JSON.stringify({ packages: { '': {} } }))
      await run(process.execPath, [script])
      const notices = join(directory, 'THIRD_PARTY_NOTICES.md')
      const rendered = await readFile(notices, 'utf8')
      await run(process.execPath, [script, '--check'])
      await writeFile(notices, rendered.replaceAll('\n', '\r\n'))
      await run(process.execPath, [script, '--check'])
      await writeFile(notices, rendered.replace('MIT License', 'Changed License'))
      await expect(run(process.execPath, [script, '--check'])).rejects.toMatchObject({ code: 1 })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
