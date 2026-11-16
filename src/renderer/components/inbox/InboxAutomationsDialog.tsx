import { useEffect, useState } from 'react'
import { ArrowLeft, CalendarClock, CircleAlert, LoaderCircle, Pencil, Play, Trash2 } from 'lucide-react'
import type { InboxAutomation } from '@shared/automations'
import type { InboxFolder } from '@shared/types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ScheduleEditor, useNow } from '@/components/inbox/AutomationSchedule'
import { ProjectIcon } from '@/components/inbox/ProjectIcon'
import {
  automationScheduleLabel,
  automationStatusLine,
  automationTimeLabel,
  automationTitle,
  formSchedule,
  scheduleForm,
  type ScheduleForm,
} from '@/lib/automations'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { cn } from '@/lib/utils'
import { useInboxAutomations } from '@/store/inbox-automations'
import { useInboxChat } from '@/store/inbox-chat'
import { useWorkspace } from '@/store/workspace'

const MESSAGE_LIMIT = 100_000

/** Where and how an automation's threads run, in a line: "app · build · gpt-5 · Terminal · new worktree from main". */
function runsWith(automation: InboxAutomation, folder: InboxFolder | undefined): string {
  return [
    folder?.name ?? 'Removed project',
    automation.agent,
    automation.model.id,
    ...(automation.mode === 'terminal' ? ['Terminal'] : []),
    ...(automation.worktree ? [`new worktree from ${automation.worktree.base}`] : []),
  ].join(' · ')
}

/** What became of the last run, when there is something to say about it. */
function LastRun({ automation, now, onOpenThread }: { automation: InboxAutomation; now: number; onOpenThread: (threadId: string) => void }): JSX.Element | null {
  if (automation.lastRunAt === undefined && automation.skippedAt === undefined) return null
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11px] text-fg-subtle">
      {automation.lastRunAt !== undefined && (
        <span>
          Last run {automationTimeLabel(automation.lastRunAt, now, true)}
          {automation.runs > 0 && ` · ${automation.runs} ${automation.runs === 1 ? 'run' : 'runs'}`}
        </span>
      )}
      {automation.lastThreadId && (
        <button
          type="button"
          data-testid={`automation-open-thread-${automation.id}`}
          onClick={() => onOpenThread(automation.lastThreadId!)}
          className="rounded text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          Open thread
        </button>
      )}
      {automation.skippedAt !== undefined && (
        <span title="The thread of the run before it was still working, so no second one was started.">
          Skipped a run {automationTimeLabel(automation.skippedAt, now, true)}
        </span>
      )}
    </span>
  )
}

function AutomationRow({
  automation,
  folder,
  now,
  onEdit,
  onRemove,
  onOpenThread,
}: {
  automation: InboxAutomation
  folder: InboxFolder | undefined
  now: number
  onEdit: () => void
  onRemove: () => void
  onOpenThread: (threadId: string) => void
}): JSX.Element {
  const setEnabled = useInboxAutomations((state) => state.setEnabled)
  const run = useInboxAutomations((state) => state.run)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const title = automationTitle(automation.text)
  const act = (work: () => Promise<unknown>, fallback: string): void => {
    setBusy(true)
    setError(null)
    work().catch((reason) => setError(ipcErrorMessage(reason, fallback))).finally(() => setBusy(false))
  }
  const problem = error ?? automation.lastError
  return (
    <li data-testid="automation-row" data-automation={automation.id} data-enabled={automation.enabled ? '' : undefined} className="group flex flex-wrap items-start gap-x-3 gap-y-2 rounded-md px-2 py-2 hover:bg-hover">
      <Switch
        checked={automation.enabled}
        disabled={busy}
        aria-label={automation.enabled ? `Pause ${title}` : `Turn on ${title}`}
        title={automation.enabled ? 'On. Click to pause.' : 'Paused. Click to turn on.'}
        data-testid="automation-enabled"
        className="mt-0.5"
        onCheckedChange={(next) => act(() => setEnabled(automation.id, next), 'Could not change the automation.')}
      />
      <button type="button" onClick={onEdit} data-testid="automation-row-open" className="flex min-w-0 flex-1 flex-col gap-0.5 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
        <span className={cn('block w-full truncate text-[13px]', automation.enabled ? 'text-fg' : 'text-fg-muted')} title={title}>{title}</span>
        <span className="flex min-w-0 max-w-full items-center gap-1.5 text-[11px] text-fg-muted">
          <ProjectIcon icon={folder?.icon} size="sm" className="shrink-0 text-fg-subtle" />
          <span className="truncate">
            {folder?.name ?? 'Removed project'}
            {' · '}
            {automationScheduleLabel(automation.schedule)}
            {' · '}
            <span data-testid="automation-next" className={automation.enabled ? 'text-fg' : undefined}>{automationStatusLine(automation, now)}</span>
          </span>
        </span>
      </button>
      <span className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={busy}
          data-testid="automation-run"
          aria-label={`Run ${title} now`}
          title="Run now: start a thread and keep the schedule"
          onClick={() => act(() => run(automation.id), 'Could not start the thread.')}
        >
          {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
        </Button>
        <Button type="button" variant="ghost" size="icon" data-testid="automation-edit" aria-label={`Edit ${title}`} title="Edit" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" data-testid="automation-remove" aria-label={`Delete ${title}`} title="Delete" className="hover:text-danger" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </span>
      {/* Under the row's own lines, at their indent. */}
      {(problem || automation.lastRunAt !== undefined || automation.skippedAt !== undefined) && (
        <span className="-mt-1.5 flex w-full basis-full flex-col gap-0.5 pl-12">
          {problem && (
            <span role="alert" data-testid="automation-error" className="flex items-start gap-1 text-[11px] text-danger">
              <CircleAlert aria-hidden className="mt-px h-3 w-3 shrink-0" />
              <span className="min-w-0 break-words">{problem}</span>
            </span>
          )}
          <LastRun automation={automation} now={now} onOpenThread={onOpenThread} />
        </span>
      )}
    </li>
  )
}

/** One automation, to change its message and its schedule. Where and with what it runs was chosen when it was made. */
function AutomationEditor({
  automation,
  folder,
  now,
  onDone,
  onRemove,
  onOpenThread,
}: {
  automation: InboxAutomation
  folder: InboxFolder | undefined
  now: number
  onDone: () => void
  onRemove: () => void
  onOpenThread: (threadId: string) => void
}): JSX.Element {
  const save = useInboxAutomations((state) => state.save)
  const [text, setText] = useState(automation.text)
  const [form, setForm] = useState<ScheduleForm>(() => scheduleForm(automation.schedule))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const result = formSchedule(form)
  const tooLong = text.length > MESSAGE_LIMIT
  const canSave = !saving && text.trim().length > 0 && !tooLong && 'schedule' in result && Boolean(folder)
  return (
    <form
      className="flex flex-col gap-4"
      data-testid="automation-editor"
      onSubmit={(event) => {
        event.preventDefault()
        if (!canSave || !('schedule' in result)) return
        setSaving(true)
        setError(null)
        save({
          id: automation.id,
          folderId: automation.folderId,
          text,
          agent: automation.agent,
          model: automation.model,
          ...(automation.mode ? { mode: automation.mode } : {}),
          ...(automation.permissionMode ? { permissionMode: automation.permissionMode } : {}),
          ...(automation.worktree ? { worktree: automation.worktree } : {}),
          schedule: result.schedule,
        })
          .then(onDone)
          .catch((reason) => setError(ipcErrorMessage(reason, 'Could not save the automation.')))
          .finally(() => setSaving(false))
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="automation-text">Message</Label>
        <textarea
          id="automation-text"
          data-testid="automation-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={6}
          spellCheck={false}
          className="max-h-[40vh] min-h-24 w-full resize-y rounded border border-line-strong bg-bg px-2.5 py-2 text-[13px] leading-5 text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
          placeholder="What every run should do"
        />
        <p className="text-[11px] text-fg-subtle">Every run starts a new thread with this message.</p>
        {tooLong && <p role="alert" className="text-xs text-danger">The message is too long.</p>}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Schedule</Label>
        <ScheduleEditor form={form} onChange={setForm} existing />
      </div>
      <div className="flex flex-col gap-1 rounded-md border border-line bg-panel px-3 py-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-fg-muted">
          <ProjectIcon icon={folder?.icon} size="sm" className="shrink-0 text-fg-subtle" />
          <span className="truncate" data-testid="automation-runs-with" title={folder?.directory}>{runsWith(automation, folder)}</span>
        </span>
        <span className="text-[11px] text-fg-subtle">
          {folder
            ? 'To run it in another project or with another agent or model, make a new automation on the New thread page.'
            : 'Its project was removed from the Inbox, so it cannot run. Add the project again, or delete the automation.'}
        </span>
        <LastRun automation={automation} now={now} onOpenThread={onOpenThread} />
      </div>
      {(error ?? automation.lastError) && (
        <p role="alert" data-testid="automation-editor-error" className="text-xs text-danger">{error ?? automation.lastError}</p>
      )}
      <DialogFooter className="mt-1 items-center">
        <Button type="button" variant="ghost" data-testid="automation-editor-remove" className="mr-auto text-fg-muted hover:text-danger" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={!canSave} data-testid="automation-save">
          {saving && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
          Save
        </Button>
      </DialogFooter>
    </form>
  )
}

/**
 * The automations of the Inbox: each with its switch, its schedule and when it runs next, and a way to run it now,
 * change it or delete it. New ones are made on the New thread page, where everything a thread needs is chosen.
 * Opened from the Inbox toolbar, from the schedule chip, and from a thread an automation started.
 */
export function InboxAutomationsDialog(): JSX.Element {
  const manager = useInboxAutomations((state) => state.manager)
  const automations = useInboxAutomations((state) => state.automations)
  const loaded = useInboxAutomations((state) => state.loaded)
  const openManager = useInboxAutomations((state) => state.openManager)
  const closeManager = useInboxAutomations((state) => state.closeManager)
  const remove = useInboxAutomations((state) => state.remove)
  const folders = useInboxChat((state) => state.folders)
  const now = useNow()
  const [removing, setRemoving] = useState<InboxAutomation | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const editing = manager.editId ? automations.find((item) => item.id === manager.editId) ?? null : null
  // The one being edited was deleted (here, or it never loaded): back to the list.
  useEffect(() => {
    if (manager.open && manager.editId && loaded && !editing) openManager()
  }, [manager.open, manager.editId, loaded, editing, openManager])
  const folderOf = (automation: InboxAutomation): InboxFolder | undefined => folders.find((folder) => folder.id === automation.folderId)
  const openThread = (threadId: string): void => {
    const workspace = useWorkspace.getState()
    if (!workspace.inboxThreads.some((thread) => thread.id === threadId)) return
    workspace.selectInboxThread(threadId)
    closeManager()
  }
  const active = automations.filter((item) => item.enabled).length
  return (
    <>
      <Dialog open={manager.open} onOpenChange={(next) => { if (!next) closeManager() }}>
        <DialogContent className="max-h-[calc(100vh-2rem)] max-w-xl overflow-y-auto" data-testid="inbox-automations">
          {editing ? (
            <>
              <DialogHeader>
                <Button type="button" variant="ghost" size="sm" data-testid="automation-back" className="-ml-2 mb-1 text-fg-muted" onClick={() => openManager()}>
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Automations
                </Button>
                <DialogTitle>Edit automation</DialogTitle>
                <DialogDescription>
                  {editing.enabled ? automationStatusLine(editing, now) : 'Paused: it runs nothing until it is turned on again.'}
                </DialogDescription>
              </DialogHeader>
              <AutomationEditor
                key={editing.id}
                automation={editing}
                folder={folderOf(editing)}
                now={now}
                onDone={() => openManager()}
                onRemove={() => setRemoving(editing)}
                onOpenThread={openThread}
              />
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Automations</DialogTitle>
                <DialogDescription>
                  Messages that start a new thread on a schedule. They run while MDE is open; one that came due while
                  MDE was closed runs once when it starts.
                </DialogDescription>
              </DialogHeader>
              {automations.length === 0 ? (
                <div data-testid="inbox-automations-empty" className="flex flex-col items-center gap-2 rounded-md border border-dashed border-line px-4 py-8 text-center">
                  <CalendarClock aria-hidden className="h-5 w-5 text-fg-subtle" />
                  <p className="text-[13px] text-fg">No automations yet</p>
                  <p className="max-w-sm text-xs text-fg-muted">
                    On the New thread page, write the message, pick a schedule from the <span className="text-fg">Run once</span> chip
                    under the box, and send.
                  </p>
                </div>
              ) : (
                <>
                  <ul data-testid="inbox-automation-list" className="-mx-2 flex max-h-[min(28rem,60vh)] flex-col gap-0.5 overflow-y-auto">
                    {automations.map((automation) => (
                      <AutomationRow
                        key={automation.id}
                        automation={automation}
                        folder={folderOf(automation)}
                        now={now}
                        onEdit={() => openManager(automation.id)}
                        onRemove={() => setRemoving(automation)}
                        onOpenThread={openThread}
                      />
                    ))}
                  </ul>
                  <p className="mt-3 text-[11px] text-fg-subtle" data-testid="inbox-automations-count">
                    {active === automations.length ? `${active} on` : `${active} on, ${automations.length - active} paused`}
                    {' · New ones are made on the New thread page.'}
                  </p>
                </>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={removing !== null} onOpenChange={(next) => { if (!next && !removeBusy) setRemoving(null) }}>
        <AlertDialogContent>
          <AlertDialogTitle>Delete this automation?</AlertDialogTitle>
          <AlertDialogDescription>
            “{removing ? automationTitle(removing.text) : ''}” stops running. The threads it started stay in the Inbox.
          </AlertDialogDescription>
          {removeError && <p role="alert" className="mt-3 text-xs text-danger">{removeError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="automation-remove-confirm"
              disabled={removeBusy}
              onClick={(event) => {
                // Stay open until it is gone, so a failure can be shown and tried again.
                event.preventDefault()
                if (!removing) return
                setRemoveBusy(true)
                setRemoveError(null)
                remove(removing.id)
                  .then(() => setRemoving(null))
                  .catch((reason) => setRemoveError(ipcErrorMessage(reason, 'Could not delete the automation.')))
                  .finally(() => setRemoveBusy(false))
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
