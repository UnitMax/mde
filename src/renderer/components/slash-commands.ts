import type { OpenCodeSlashCommand } from '@shared/types'

export interface GuiSlashCommandDefinition {
  command: OpenCodeSlashCommand
  aliases: string[]
  description: string
}

export const GUI_SLASH_COMMANDS: GuiSlashCommandDefinition[] = [
  { command: 'compact', aliases: ['summarize'], description: 'Compact the current session' },
  { command: 'init', aliases: [], description: 'Create or update AGENTS.md' }
]

export function slashCommandDraft(value: string): { token: string; hasArguments: boolean } | null {
  const trimmed = value.trim()
  if (!trimmed.startsWith('/')) return null
  const match = trimmed.match(/^\/([^\s]*)(?:\s+.+)?$/)
  if (!match) return { token: '', hasArguments: true }
  return { token: match[1] ?? '', hasArguments: /\s+/.test(trimmed) }
}

export function resolveSlashCommand(value: string): { command?: OpenCodeSlashCommand; error?: string } | null {
  const draft = slashCommandDraft(value)
  if (!draft) return null

  const normalized = draft.token.toLowerCase()
  const definition = GUI_SLASH_COMMANDS.find(
    (candidate) => candidate.command === normalized || candidate.aliases.includes(normalized)
  )
  if (!definition) return { error: normalized ? `Unknown slash command: /${draft.token}` : 'Enter a slash command.' }
  if (draft.hasArguments) return { error: `/${draft.token} does not accept arguments.` }
  return { command: definition.command }
}
