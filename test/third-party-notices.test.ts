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
      '@xterm/xterm',
      'lucide-react',
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
})
