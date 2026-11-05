import { describe, expect, it } from 'vitest'
import {
  agentCommandSettingError,
  parseAgentArguments,
  resolveAgentCommand
} from '../src/renderer/lib/agent-commands'
import { isTerminalLauncherShortcut } from '../src/renderer/lib/terminal-launcher'

describe('agent command settings', () => {
  it('parses shell-style arguments into literal argv without expansion', () => {
    expect(parseAgentArguments('--model "gpt 5" --tag \'nightly build\' path\\ with\\ spaces')).toEqual([
      '--model',
      'gpt 5',
      '--tag',
      'nightly build',
      'path with spaces'
    ])
    expect(parseAgentArguments('$HOME; echo unsafe')).toEqual(['$HOME;', 'echo', 'unsafe'])
  })

  it('preserves empty quoted arguments and rejects malformed input', () => {
    expect(parseAgentArguments('"" \'\'')).toEqual(['', ''])
    expect(parseAgentArguments('--model "unfinished')).toBeNull()
    expect(parseAgentArguments('trailing\\')).toBeNull()
  })

  it('disables malformed settings while leaving missing executables optimistic', () => {
    expect(agentCommandSettingError({ executable: '', args: '' })).toMatch(/executable/)
    expect(agentCommandSettingError({ executable: 'codex', args: '"unfinished' })).toMatch(/unfinished/)
    expect(agentCommandSettingError({ executable: 'not-installed', args: '' })).toBeNull()
    expect(resolveAgentCommand({ executable: 'codex', args: '--model "gpt 5"' })).toEqual({
      executable: 'codex',
      args: ['--model', 'gpt 5']
    })
  })
})

describe('terminal launcher shortcut', () => {
  const base = {
    type: 'keydown',
    key: 'n',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false
  }

  it('accepts Ctrl+N and Cmd+N with no extra modifiers', () => {
    expect(isTerminalLauncherShortcut({ ...base, ctrlKey: true })).toBe(true)
    expect(isTerminalLauncherShortcut({ ...base, metaKey: true })).toBe(true)
  })

  it('rejects unrelated or composing shortcuts', () => {
    expect(isTerminalLauncherShortcut({ ...base, key: 'o', ctrlKey: true })).toBe(false)
    expect(isTerminalLauncherShortcut({ ...base, ctrlKey: true, shiftKey: true })).toBe(false)
    expect(isTerminalLauncherShortcut({ ...base, ctrlKey: true, altKey: true })).toBe(false)
    expect(isTerminalLauncherShortcut({ ...base, ctrlKey: true, type: 'keyup' })).toBe(false)
    expect(isTerminalLauncherShortcut({ ...base, ctrlKey: true, isComposing: true })).toBe(false)
  })
})
