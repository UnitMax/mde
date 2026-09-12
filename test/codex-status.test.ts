import { describe, expect, it } from 'vitest'
import {
  CODEX_STATUS_HOOK_MARKER,
  CODEX_STATUS_HOOK_SOURCE,
  CODEX_STATUS_HOOK_VERSION,
  classifyCodexHookSource,
  parseCodexHookVersion
} from '../src/main/codex/status'

const scriptPath = '/home/me/.codex/hooks/mde-status.sh'
const hookEvents = [
  ['SessionStart', 'start'],
  ['UserPromptSubmit', 'working'],
  ['PreToolUse', 'working'],
  ['PostToolUse', 'working'],
  ['PreCompact', 'working'],
  ['PostCompact', 'working'],
  ['PermissionRequest', 'attention'],
  ['SubagentStart', 'working'],
  ['SubagentStop', 'working'],
  ['Stop', 'completed'],
  ['Interrupt', 'interrupted'],
  ['SessionEnd', 'closed']
] as const

type HookEvent = readonly [string, string]

function hooksSource(events: readonly HookEvent[] = hookEvents): string {
  return JSON.stringify({
    hooks: Object.fromEntries(events.map(([event, status]) => [
      event,
      [{ hooks: [{ type: 'command', command: `MDE_CODEX_STATUS_EVENT=${status} /bin/sh '${scriptPath}' # ${CODEX_STATUS_HOOK_MARKER}` }] }]
    ]))
  })
}

describe('Codex status hooks', () => {
  it('ships a syntactically valid POSIX hook script', () => {
    expect(CODEX_STATUS_HOOK_SOURCE).toMatch(/^#!\/bin\/sh\n/)
    expect(CODEX_STATUS_HOOK_SOURCE).toContain(CODEX_STATUS_HOOK_MARKER)
    expect(CODEX_STATUS_HOOK_SOURCE).toContain('MDE_CODEX_STATUS_PROTOCOL')
    expect(CODEX_STATUS_HOOK_SOURCE).toContain('mv -f -- "$temporary" "$file"')
    expect(parseCodexHookVersion(CODEX_STATUS_HOOK_SOURCE)).toBe(CODEX_STATUS_HOOK_VERSION)
  })

  it('recognizes the complete owned hook set, including repeated commands', () => {
    expect(classifyCodexHookSource(hooksSource(), CODEX_STATUS_HOOK_SOURCE, scriptPath)).toBe('installed')
    expect(classifyCodexHookSource(hooksSource(hookEvents.slice(0, -1)), CODEX_STATUS_HOOK_SOURCE, scriptPath)).toBe('outdated')
    expect(classifyCodexHookSource('{not json}', CODEX_STATUS_HOOK_SOURCE, scriptPath)).toBe('conflict')
    expect(classifyCodexHookSource('{}', CODEX_STATUS_HOOK_SOURCE, scriptPath)).toBe('not-installed')
  })
})
