import { useId, useState } from 'react'
import { AlertTriangle, ChevronDown, Image, Layers, Terminal, Users, X } from 'lucide-react'
import { barTrigger } from '@/components/inbox/ComposerBar'
import { useBackgroundTasks } from '@/components/inbox/use-background-tasks'
import { cn } from '@/lib/utils'

const HIDE_UNAVAILABLE_KEY = 'mde.background-tasks-hide-unavailable'

function unavailableHidden(): boolean {
  try { return localStorage.getItem(HIDE_UNAVAILABLE_KEY) === 'true' } catch { return false }
}

/** The companion to the worktree strip, tucked above the composer instead of below it. */
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
  return (
    <div data-testid="chat-background-tasks" className="relative z-0 -mb-1.5 mx-5 overflow-hidden rounded-t-xl border border-b-0 border-line bg-elevated/50 px-1.5 pb-2 pt-1">
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => { setOpen(!open); if (!open) refresh() }}
          className={cn(barTrigger, 'h-7 min-w-0 flex-1 justify-start px-2')}
        >
          {unavailable ? <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0 text-warn" /> : <Layers aria-hidden className="h-3.5 w-3.5 shrink-0 text-accent" />}
          <span aria-live="polite" className="min-w-0 flex-1 truncate text-left">{summary}</span>
          {unavailable && tasks.length > 0 && <span className="text-[11px] text-fg-subtle">{tasks.length} last seen</span>}
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
      {open && <div id={listId} role="region" aria-label="Background tasks" className="px-2 pb-1 pt-1">
        {unavailable && <div className="mb-2 flex items-start gap-2 text-xs text-fg-muted">
          <p role={error ? 'alert' : undefined} className="min-w-0 flex-1 leading-relaxed">
            {error ?? 'This OpenCode version cannot list background tasks. Update OpenCode to enable tracking.'}
            {error && tasks.length > 0 && ' The tasks below were last seen running; their current status is unknown.'}
          </p>
          <button type="button" onClick={refresh} className="shrink-0 rounded px-1 text-accent hover:underline">Retry</button>
        </div>}
        {tasks.length > 0 ? <ul className="max-h-52 space-y-1 overflow-y-auto" aria-label="Running background tasks">
          {tasks.map((task) => {
            const Icon = task.kind === 'shell' ? Terminal : task.kind === 'subagent' ? Users : task.kind === 'image' ? Image : Layers
            return <li key={task.id} className="rounded-lg border border-line bg-bg/40 px-2.5 py-2">
              <div className="flex items-start gap-2">
                <Icon aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                <div className="min-w-0 flex-1">
                  <p className={cn('break-words text-xs leading-relaxed text-fg', task.kind === 'shell' && 'inbox-code-font')} title={task.command ?? task.title}>{task.title}</p>
                  {task.command && task.command !== task.title && <p className="inbox-code-font mt-0.5 line-clamp-2 break-all text-[11px] text-fg-muted" title={task.command}>{task.command}</p>}
                  <p className="mt-0.5 text-[11px] text-fg-subtle">
                    {task.kind === 'shell' ? 'Shell process' : task.kind === 'subagent' ? 'Subagent' : task.kind === 'image' ? 'Image generation' : 'Task'}
                    {task.startedAt ? ` · Started ${new Date(task.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                  </p>
                </div>
              </div>
            </li>
          })}
        </ul> : !unavailable && <p role="status" className="pb-1 text-xs text-fg-muted">No background tasks running.</p>}
        <p className="mt-2 text-[11px] text-fg-subtle">Tasks reported by OpenCode for this thread and its subagents.</p>
      </div>}
    </div>
  )
}
