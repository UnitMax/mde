import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

describe('patched packaging glob compatibility', () => {
  it('preserves the builder matcher and universal merger named API', () => {
    const builder = createRequire(require.resolve('app-builder-lib'))
    const universal = createRequire(builder.resolve('@electron/universal'))
    const { FileMatcher } = require('app-builder-lib/out/fileMatcher')
    const matcher = new FileMatcher('/fixture/from', '/fixture/to', (value: string) => value, ['**/*.js'])
    const patterns: { match(path: string): boolean }[] = []
    matcher.computeParsedPatterns(patterns)
    expect(patterns.some((pattern) => pattern.match('out/main.js'))).toBe(true)
    expect(patterns.some((pattern) => pattern.match('out/secret.txt'))).toBe(false)
    expect(universal('minimatch').minimatch('Contents/Resources/app.asar', '**/*.asar')).toBe(true)
    expect(builder('minimatch/package.json').version).toBe('11.0.1')
    expect(universal('minimatch/package.json').version).toBe('11.0.1')
  })

  it('preserves the legacy callable API used by asar crawling', () => {
    const builder = createRequire(require.resolve('app-builder-lib'))
    const asar = createRequire(builder.resolve('@electron/asar'))
    const legacy = asar('minimatch')
    expect(typeof legacy).toBe('function')
    expect(legacy('index.js', '**/*.js')).toBe(true)
  })
})
