import { useId, useState } from 'react'
import { AlertTriangle, ChevronDown, Image, Layers, Terminal, Users, X } from 'lucide-react'
import { ElapsedTime } from '@/components/ElapsedTime'
import { barTrigger } from '@/components/inbox/ComposerBar'
import { useBackgroundTasks } from '@/components/inbox/use-background-tasks'
import { cn } from '@/lib/utils'

const HIDE_UNAVAILABLE_KEY = 'mde.background-tasks-hide-unavailable'

function unavailableHidden(): boolean {
  try { return localStorage.getItem(HIDE_UNAVAILABLE_KEY) === 'true' } catch { return false }
}

const KINDS = {
  shell: { Icon: Terminal, label: 'Shell process' },
  subagent: { Icon: Users, label: 'Subagent' },
  image: { Icon: Image, label: 'Image generation' },
} as const

/**
 * The tasks OpenCode is running for this thread and its subagents, as a row of the tray above the message box
 * (`ComposerDock`). Closed it says how many there are and which; open it lists them, each with how long it has been
 * going. Nothing is drawn while there are none.
 */
export function ChatBackgroundTasks({ threadId }: { threadId: string }): JSX.Element | null {
  const { snapshot, error, refresh } = useBackgroundTasks(threadId)
  const [open, setOpen] = useState(false)
  const [hideUnavailable, setHideUnavailable] = useState(unavailableHidden)
  const listId = useId()
  const tasks = snapshot?.tasks ?? []
  const unavailable = Boolean(error) || snapshot?.supported === false
  if (!snapshot && !error) return null
  if (unavailable && tasks.length === 0 && hideUnavailable) return null
  if (!unavailable && tasks.length === 0 && !open) return null
  const summary = unavailable ? 'Background task status unavailable' : `${tasks.length} background ${tasks.length === 1 ? 'task' : 'tasks'} running`
  // What is running, so that the closed row says more than a number.
  const preview = !open && !unavailable ? tasks.map((task) => task.title).join(', ') : ''
  return (
    <div data-testid="chat-background-tasks" className="px-1.5 py-1">
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          title="Tasks reported by OpenCode for this thread and its subagents"
          onClick={() => { setOpen(!open); if (!open) refresh() }}
          className={cn(barTrigger, 'h-7 min-w-0 flex-1 justify-start px-2')}
        >
          {unavailable ? <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0 text-warn" /> : <Layers aria-hidden className="h-3.5 w-3.5 shrink-0 text-accent" />}
          <span aria-live="polite" className="shrink-0 whitespace-nowrap text-left">{summary}</span>
          {unavailable && tasks.length > 0 && <span className="shrink-0 text-[11px] text-fg-subtle">{tasks.length} last seen</span>}
          <span className="min-w-0 flex-1 truncate text-left text-fg-subtle">{preview && `· ${preview}`}</span>
          <ChevronDown aria-hidden className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-180')} />
        </button>
        {unavailable && tasks.length === 0 && <button
          type="button"
          aria-label="Hide unavailable background task message"
          title="Hide this message. Running tasks will still appear when tracking is available."
          onClick={() => {
            setHideUnavailable(true)
            try { localStorage.setItem(HIDE_UNAVAILABLE_KEY, 'true') } catch { /* Still hidden for this view when storage is unavailable. */ }
          }}
          className={cn(barTrigger, 'h-6 w-6 shrink-0 justify-center px-0')}
        ><X aria-hidden className="h-3.5 w-3.5" /></button>}
      </div>
      {open && <div id={listId} role="region" aria-label="Background tasks" className="px-1 pb-0.5 pt-1">
        {unavailable && <div className="mb-1.5 flex items-start gap-2 px-1 text-xs text-fg-muted">
          <p role={error ? 'alert' : undefined} className="min-w-0 flex-1 leading-relaxed">
            {error ?? 'This OpenCode version cannot list background tasks. Update OpenCode to enable tracking.'}
            {error && tasks.length > 0 && ' The tasks below were last seen running; their current status is unknown.'}
          </p>
          <button type="button" onClick={refresh} className="shrink-0 rounded px-1 text-accent hover:underline">Retry</button>
        </div>}
        {tasks.length > 0 ? <ul className="max-h-48 overflow-y-auto" aria-label="Running background tasks">
          {tasks.map((task) => {
            const { Icon, label } = KINDS[task.kind as keyof typeof KINDS] ?? { Icon: Layers, label: 'Task' }
            const shell = task.kind === 'shell'
            return <li
              key={task.id}
              className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-hover/60"
              title={task.startedAt ? `${label}, started ${new Date(task.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : label}
            >
              <Icon aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-subtle" />
              <div className="min-w-0 flex-1">
                <p className={cn('break-words text-xs leading-relaxed text-fg', shell && 'inbox-code-font')}>
                  <span className="sr-only">{label}: </span>{task.title}
                </p>
                {task.command && task.command !== task.title && <p className="inbox-code-font line-clamp-2 break-all text-[11px] text-fg-muted" title={task.command}>{task.command}</p>}
              </div>
              {task.startedAt ? <ElapsedTime since={task.startedAt} className="mt-0.5 shrink-0 text-[11px] text-fg-subtle" /> : null}
            </li>
          })}
        </ul> : !unavailable && <p role="status" className="px-2 pb-1 text-xs text-fg-muted">No background tasks running.</p>}
      </div>}
    </div>
  )
}
