import { goalKeyword, goalObjectiveProblem, type GoalKeyword } from '@shared/goal'
import { describes } from '@/lib/skills'

/**
 * Slash commands of the message box. A message that begins with `/` and the name of a command is that
 * command, not text for the agent: the box lists the commands while the name is being typed, and
 * Enter runs it. Anything else that starts with a slash (a path, say) is an ordinary message.
 */

export interface SlashCommand {
  /** What follows the slash, in lower case and without spaces: `btw`. */
  name: string
  /** Other names that run the same command. */
  aliases?: readonly string[]
  /** One sentence for the list. */
  description: string
  /** What the command takes after its name; left out for a command that takes nothing. */
  argument?: { hint: string; required: boolean }
  /**
   * The quotes attached to the message go with what is written after the name, as block quotes before it, and
   * leave the box. Only when something is written: a command run on its own leaves them for the next message.
   */
  takesQuotes?: boolean
  /** Does the work. A rejection puts the text back in the box and is shown under it. */
  run: (args: string) => void | Promise<void>
}

/** The `/word` being typed at the very start of the message: the caret is in the first word, which starts with a slash. */
export interface SlashTrigger {
  /** The end of that first word, which the chosen command replaces. */
  end: number
  /** What was typed after the slash, up to the caret. */
  query: string
}

export function slashTriggerAt(text: string, caret: number): SlashTrigger | null {
  if (!Number.isInteger(caret) || caret < 1 || caret > text.length || text[0] !== '/') return null
  const end = 1 + (/^\/(\S*)/.exec(text)?.[1]?.length ?? 0)
  return caret > end ? null : { end, query: text.slice(1, caret) }
}

/** The commands that fit what was typed after the slash: names that start with it first, then names that contain it, then descriptions. */
export function filterCommands(commands: readonly SlashCommand[], query: string): SlashCommand[] {
  const needle = query.toLowerCase()
  if (!needle) return [...commands]
  const ranked: Array<{ command: SlashCommand; rank: number; index: number }> = []
  commands.forEach((command, index) => {
    const names = [command.name, ...(command.aliases ?? [])].map((name) => name.toLowerCase())
    const rank = names[0]!.startsWith(needle) ? 0
      : names.some((name) => name.startsWith(needle)) ? 1
        : names.some((name) => name.includes(needle)) ? 2
          : describes(command.description, needle) ? 3 : -1
    if (rank >= 0) ranked.push({ command, rank, index })
  })
  return ranked.sort((a, b) => a.rank - b.rank || a.index - b.index).map((entry) => entry.command)
}

/**
 * Writes the chosen command over the `/word` being typed. A command that takes an argument gets a space
 * after it so that typing carries on; one that follows already is kept, not doubled.
 */
export function applyCommand(text: string, trigger: SlashTrigger, command: SlashCommand): { text: string; caret: number } {
  const written = `/${command.name}`
  const after = text.slice(trigger.end)
  const gap = command.argument && !/^\s/.test(after) ? ' ' : ''
  const caret = written.length + (gap || (command.argument && after.startsWith(' ')) ? 1 : 0)
  return { text: written + gap + after, caret }
}

export interface SlashInvocation {
  command: SlashCommand
  /** Everything after the name, trimmed; empty when there is none. */
  args: string
  /** Where the written name ends (the slash and the name, as typed). */
  nameEnd: number
}

/**
 * The command a message is, or null when it is an ordinary message: it starts with a slash and the
 * name of one of `commands` (or an alias), in any case, as a whole word.
 */
export function parseInvocation(commands: readonly SlashCommand[], text: string): SlashInvocation | null {
  if (commands.length === 0) return null
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text)
  if (!match) return null
  const name = match[1]!.toLowerCase()
  const command = commands.find((candidate) => candidate.name.toLowerCase() === name || candidate.aliases?.some((alias) => alias.toLowerCase() === name))
  return command ? { command, args: (match[2] ?? '').trim(), nameEnd: 1 + match[1]!.length } : null
}

/**
 * What the commands need from the thread they run in. A command whose action is left out is not offered: a new
 * thread, which has no conversation yet, has nothing to ask about, fork or compact, so it gives `goal` alone.
 */
export interface SlashActions {
  /** Asks a side question about the conversation; the answer is shown apart from it. */
  ask?: (question: string) => void | Promise<void>
  /** Opens the thread's earlier side questions; left out while it has none. */
  asked?: () => void
  /** Forks the whole conversation into a new thread, which is opened. */
  fork?: () => void | Promise<void>
  /** Compacts the conversation: it is summarized to free up context. */
  compact?: () => void | Promise<void>
  /** Sets the thread's goal, or pauses, resumes or clears it. */
  goal?: (change: { action: 'set'; objective: string } | { action: GoalKeyword }) => void | Promise<void>
}

/** The commands of the Inbox message box that `actions` can do. A new one is another entry here, with what it needs added to {@link SlashActions}. */
export function slashCommands(actions: SlashActions): SlashCommand[] {
  const { ask, fork, compact, goal } = actions
  const commands: SlashCommand[] = []
  if (ask) {
    commands.push({
      name: 'btw',
      description: 'Ask a side question. It is answered from this conversation and not added to it.',
      // On its own it opens the earlier side questions, once there are any.
      argument: { hint: 'your question', required: !actions.asked },
      // A question about a quoted passage needs the passage: the model cannot tell which part was meant.
      takesQuotes: true,
      run: (question) => question ? ask(question) : actions.asked?.(),
    })
  }
  if (fork) {
    commands.push({
      name: 'fork',
      description: 'Fork this thread. A new thread starts with a copy of the conversation, and this one stays as it is.',
      run: () => fork(),
    })
  }
  if (compact) {
    commands.push({
      name: 'compact',
      aliases: ['summarize'],
      description: 'Compact the conversation. It is summarized to free up context.',
      run: () => compact(),
    })
  }
  if (goal) {
    commands.push({
      name: 'goal',
      description: 'Keep working until an objective is met. “/goal pause”, “resume” and “clear” manage the goal.',
      argument: { hint: 'an objective', required: true },
      run: (args) => {
        const keyword = goalKeyword(args)
        if (keyword) return goal({ action: keyword })
        const problem = goalObjectiveProblem(args)
        if (problem) throw new Error(problem)
        return goal({ action: 'set', objective: args.trim() })
      },
    })
  }
  return commands
}

/** The commands of a thread that is not started yet: only a goal can be given to one, and it starts the thread. */
export function newThreadCommands(start: (objective: string) => void | Promise<void>): SlashCommand[] {
  const [goal] = slashCommands({
    goal: (change) => {
      if (change.action !== 'set') throw new Error(`There is no goal to ${change.action} yet. Write an objective after /goal to start the thread with one.`)
      return start(change.objective)
    },
  })
  return [{ ...goal!, description: 'Start the thread with a goal: the agent keeps working until the objective is met.' }]
}
