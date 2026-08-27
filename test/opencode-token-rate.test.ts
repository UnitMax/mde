import { describe, expect, it } from 'vitest'
import {
  addTokenRatePluginToConfig,
  classifyTokenRatePluginSource,
  configRegistersTokenRatePlugin,
  legacyWslTokenRatePluginSpec,
  parseTokenRatePluginVersion,
  removeTokenRatePluginFromConfig,
  removeTokenRatePluginSpecsFromConfig,
  repairTokenRatePluginConfig,
  TOKEN_RATE_PLUGIN_MARKER,
  TOKEN_RATE_PLUGIN_SOURCE,
  TOKEN_RATE_PLUGIN_VERSION,
  wslOpenCodeVersionArgs,
  wslTokenRatePluginSpec
} from '../src/main/opencode/token-rate'

const spec = wslTokenRatePluginSpec('/home/me/.config/opencode')

describe('OpenCode token-rate TUI plugin', () => {
  it('ships a gated TUI-only module with prompt-row and generation event hooks', () => {
    expect(TOKEN_RATE_PLUGIN_SOURCE).toContain(TOKEN_RATE_PLUGIN_MARKER)
    expect(TOKEN_RATE_PLUGIN_SOURCE).toContain(
      'mde-opencode-token-rate-plugin-version: ' + TOKEN_RATE_PLUGIN_VERSION
    )
    expect(TOKEN_RATE_PLUGIN_SOURCE).toContain('MDE_OPENCODE_TOKEN_RATE')
    expect(TOKEN_RATE_PLUGIN_SOURCE).toContain('session_prompt_right')
    expect(TOKEN_RATE_PLUGIN_SOURCE).toContain('message.part.updated')
    expect(TOKEN_RATE_PLUGIN_SOURCE).toContain('message.updated')
    expect(TOKEN_RATE_PLUGIN_SOURCE).toContain('tok/s')
    expect(TOKEN_RATE_PLUGIN_SOURCE).not.toContain('export const MdeTuiStatus')
    expect(parseTokenRatePluginVersion(TOKEN_RATE_PLUGIN_SOURCE)).toBe(TOKEN_RATE_PLUGIN_VERSION)
  })

  it('classifies only the owned source as installed', () => {
    expect(classifyTokenRatePluginSource(null)).toBe('not-installed')
    expect(classifyTokenRatePluginSource('export default {}')).toBe('conflict')
    expect(classifyTokenRatePluginSource('// ' + TOKEN_RATE_PLUGIN_MARKER)).toBe('outdated')
    expect(classifyTokenRatePluginSource(TOKEN_RATE_PLUGIN_SOURCE)).toBe('installed')
  })

  it('resolves OpenCode through the WSL login shell', () => {
    expect(wslOpenCodeVersionArgs('Ubuntu-24.04')).toEqual([
      '-d',
      'Ubuntu-24.04',
      '-e',
      'bash',
      '-lic',
      'exec opencode --version'
    ])
  })

  it('uses POSIX WSL file URLs and repairs the legacy Windows-separator URL', () => {
    const legacySpec = legacyWslTokenRatePluginSpec('/home/me/.config/opencode')
    expect(spec).toBe('file:///home/me/.config/opencode/plugins/mde-token-rate.tsx')
    expect(legacySpec).toBe('file://%5Chome%5Cme%5C.config%5Copencode%5Cplugins%5Cmde-token-rate.tsx')

    const original = JSON.stringify({ plugin: ['user-plugin', legacySpec] })
    const repaired = repairTokenRatePluginConfig(original, spec, [legacySpec])
    expect(JSON.parse(repaired).plugin).toEqual(['user-plugin', spec])
    expect(configRegistersTokenRatePlugin(repaired, spec)).toBe(true)
    expect(configRegistersTokenRatePlugin(repaired, legacySpec)).toBe(false)
  })

  it('adds an owned file plugin to JSONC without losing comments or user plugins', () => {
    const original = [
      '{',
      '  // Keep this user plugin.',
      '  "plugin": [',
      '    "user-plugin"',
      '  ],',
      '  "theme": "dark",',
      '}'
    ].join('\n')
    const updated = addTokenRatePluginToConfig(original, spec)
    expect(updated).toContain('// Keep this user plugin.')
    expect(updated).toContain('"user-plugin"')
    expect(updated).toContain(JSON.stringify(spec))
    expect(configRegistersTokenRatePlugin(updated, spec)).toBe(true)
    expect(addTokenRatePluginToConfig(updated, spec)).toBe(updated)
  })

  it('supports an empty config and tuple plugin entries', () => {
    const added = addTokenRatePluginToConfig('{}\n', spec)
    expect(JSON.parse(added).plugin).toEqual([spec])

    const original = JSON.stringify({ plugin: [['user-plugin', { enabled: true }]] })
    const updated = addTokenRatePluginToConfig(original, spec)
    expect(JSON.parse(updated).plugin).toEqual([
      ['user-plugin', { enabled: true }],
      spec
    ])
  })

  it('removes only the owned entry and leaves the user configuration intact', () => {
    const original = [
      '{',
      '  "plugin": [',
      '    "user-plugin",',
      '    ' + JSON.stringify(spec),
      '  ],',
      '  "theme": "dark"',
      '}'
    ].join('\n')
    const updated = removeTokenRatePluginFromConfig(original, spec)
    expect(updated).toContain('"user-plugin"')
    expect(updated).toContain('"theme": "dark"')
    expect(configRegistersTokenRatePlugin(updated, spec)).toBe(false)
  })

  it('removes canonical and legacy registrations without removing user plugins', () => {
    const legacySpec = legacyWslTokenRatePluginSpec('/home/me/.config/opencode')
    const original = JSON.stringify({ plugin: ['user-plugin', spec, legacySpec] })
    const updated = removeTokenRatePluginSpecsFromConfig(original, [spec, legacySpec])
    expect(JSON.parse(updated).plugin).toEqual(['user-plugin'])
  })
})
