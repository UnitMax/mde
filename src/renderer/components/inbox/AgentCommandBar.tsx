import { Bot } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useInboxTerminal } from '@/store/inbox-terminal'

/**
 * Over an Inbox terminal pane an agent opened: the command it asked to run, waiting for the person. The command is
 * shown in full, exactly as main will type it; main keeps its own copy, so nothing here can change what runs.
 */
export function AgentCommandBar({ terminalId }: { terminalId: string }): JSX.Element | null {
  const waiting = useInboxTerminal((state) => state.agentCommands[terminalId])
  const decide = useInboxTerminal((state) => state.decideAgentCommand)
  if (!waiting) return null
  return (
    <div
      role="group"
      aria-label="Command an agent asked to run"
      data-testid="agent-command-bar"
      className="agent-command-bar flex shrink-0 flex-col gap-1.5 border-b border-accent/40 bg-accent/10 px-3 py-2"
    >
      <p className="flex min-w-0 items-center gap-1.5 text-[11px] text-fg-muted">
        <Bot aria-hidden className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="min-w-0 truncate">
          {waiting.from ? <>An agent in <span className="text-fg">{waiting.from}</span> wants to run:</> : 'An agent wants to run:'}
        </span>
      </p>
      <code
        data-testid="agent-command-text"
        className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded border border-line bg-bg px-2 py-1 font-mono text-[12px] text-fg"
      >
        {waiting.command}
      </code>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button type="button" size="sm" data-testid="agent-command-run" onClick={() => decide(terminalId, 'run')}>
          Run
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          data-testid="agent-command-run-hour"
          title="Run this, and run commands agents ask for without asking for the next hour"
          onClick={() => decide(terminalId, 'run-for-hour')}
        >
          Run, and allow for an hour
        </Button>
        <Button type="button" size="sm" variant="ghost" data-testid="agent-command-cancel" onClick={() => decide(terminalId, 'cancel')}>
          Don’t run
        </Button>
      </div>
    </div>
  )
}
