import type { AgentCommand, CodingAgent } from '@shared/types'
import type { AgentCommandSetting } from '@/terminal/terminal-settings'

export interface AgentCommandOption {
  kind: CodingAgent
  label: string
  description: string
}

export const AGENT_COMMAND_OPTIONS: readonly AgentCommandOption[] = [
  { kind: 'opencode', label: 'OpenCode', description: 'Start an OpenCode session' },
  { kind: 'codex', label: 'Codex', description: 'Start a Codex session' },
  { kind: 'claude', label: 'Claude', description: 'Start a Claude session' }
]

/** Parses shell-style argv text without interpreting shell syntax. */
export function parseAgentArguments(value: string): string[] | null {
  const args: string[] = []
  let current = ''
  let tokenStarted = false
  let quote: "'" | '"' | null = null
  let escaped = false

  for (const character of value) {
    if (escaped) {
      current += character
      tokenStarted = true
      escaped = false
      continue
    }

    if (character === '\\') {
      escaped = true
      tokenStarted = true
      continue
    }

    if (quote) {
      if (character === quote) quote = null
      else current += character
      tokenStarted = true
      continue
    }

    if (character === "'" || character === '"') {
      quote = character
      tokenStarted = true
      continue
    }

    if (/\s/.test(character)) {
      if (tokenStarted) {
        args.push(current)
        current = ''
        tokenStarted = false
      }
      continue
    }

    current += character
    tokenStarted = true
  }

  if (escaped || quote) return null
  if (tokenStarted) args.push(current)
  return args
}

function containsControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value)
}

export function agentCommandSettingError(setting: AgentCommandSetting): string | null {
  const executable = setting.executable.trim()
  if (!executable) return 'Enter an executable name.'
  if (containsControlCharacter(executable)) return 'The executable contains a control character.'
  if (parseAgentArguments(setting.args) === null) return 'Arguments contain an unfinished quote or escape.'
  if (containsControlCharacter(setting.args)) return 'Arguments contain a control character.'
  return null
}

export function resolveAgentCommand(setting: AgentCommandSetting): AgentCommand | null {
  if (agentCommandSettingError(setting)) return null
  return {
    executable: setting.executable.trim(),
    args: parseAgentArguments(setting.args) ?? []
  }
}
