import { describe, expect, it } from 'vitest'
import { GUI_SLASH_COMMANDS, resolveSlashCommand, slashCommandDraft } from '../src/renderer/components/slash-commands'

describe('GUI OpenCode slash commands', () => {
  it('offers only the first-draft commands', () => {
    expect(GUI_SLASH_COMMANDS.map((item) => item.command)).toEqual(['compact', 'init'])
  })

  it('resolves compact and its summarize alias', () => {
    expect(resolveSlashCommand('/compact')).toEqual({ command: 'compact' })
    expect(resolveSlashCommand('/summarize')).toEqual({ command: 'compact' })
    expect(resolveSlashCommand('/COMPACT')).toEqual({ command: 'compact' })
  })

  it('resolves init and ignores leading or trailing whitespace', () => {
    expect(resolveSlashCommand('  /init  ')).toEqual({ command: 'init' })
  })

  it('rejects unknown commands and arguments', () => {
    expect(resolveSlashCommand('/share')).toEqual({ error: 'Unknown slash command: /share' })
    expect(resolveSlashCommand('/compact now')).toEqual({ error: '/compact does not accept arguments.' })
    expect(resolveSlashCommand('/')).toEqual({ error: 'Enter a slash command.' })
  })

  it('identifies a command draft for autocomplete', () => {
    expect(slashCommandDraft('/com')).toEqual({ token: 'com', hasArguments: false })
    expect(slashCommandDraft('/init extra')).toEqual({ token: 'init', hasArguments: true })
    expect(slashCommandDraft('normal prompt')).toBeNull()
  })
})
