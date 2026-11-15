import { useMemo, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { ChangesSection, FilesSection, showInboxTerminal } from '@/components/inbox/InboxChanges'
import { InboxToolCalls } from '@/components/inbox/InboxToolCalls'
import { ChevronRight, Code, FileDiff, Folder, FolderOpen, FolderX, GitBranch, PanelRight, PanelRightClose, PanelRightOpen, SquareTerminal, Wrench, type LucideIcon } from 'lucide-react'
import type { DirectoryContext, InboxThread } from '@shared/types'
import { ProjectIcon } from '@/components/inbox/ProjectIcon'
import { useOpenFolder } from '@/components/OpenFolderButtons'
import { inboxFolderLabel, inboxThreadFolder, inboxThreadHome } from '@/lib/inbox'
import { toolTally } from '@/lib/tool-review'
import { cn } from '@/lib/utils'
import { inboxChangesKey, useInboxChanges } from '@/store/inbox-changes'
import { useInboxChat } from '@/store/inbox-chat'
import { useInboxFloatingTerminal } from '@/store/inbox-floating-terminal'
import { useInboxView, type FloatingSection } from '@/store/inbox-view'
import { useWorkspace } from '@/store/workspace'

/** Where the floating card and its panel sit: below the thread's header, or at the top of the new-thread page. */
export function floatingTop(threadId: string | undefined): string {
  return threadId ? 'top-14' : 'top-3'
}

const CARD = 'rounded-xl border border-line-strong bg-elevated/95 shadow-xl shadow-shade/50 backdrop-blur'

/** Up and Down (Home and End) walk the card's rows. */
function walkRows(event: ReactKeyboardEvent<HTMLElement>): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  // Keys inside an opened section (the file tree, the tool list) are theirs.
  if (!(event.target as HTMLElement).matches('[data-menu-row]')) return
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-menu-row]'))
  const at = rows.indexOf(event.target as HTMLElement)
  const next = event.key === 'Home' ? rows[0]
    : event.key === 'End' ? rows[rows.length - 1]
      : rows[at < 0 ? 0 : at + (event.key === 'ArrowDown' ? 1 : -1)]
  if (!next) return
  event.preventDefault()
  next.focus()
}

function Row({
  icon: Icon,
  iconNode,
  label,
  meta,
  title,
  muted = false,
  chevron = false,
  expanded,
  testId,
  onClick,
}: {
  icon?: LucideIcon
  iconNode?: ReactNode
  label: ReactNode
  meta?: ReactNode
  title?: string
  muted?: boolean
  chevron?: boolean
  /** The row opens a section out below it; whether it is open. */
  expanded?: boolean
  testId?: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      data-menu-row
      data-testid={testId}
      title={title}
      aria-expanded={expanded}
      onClick={onClick}
      className={cn(
        'group/row flex h-8 w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] transition-colors',
        'hover:bg-hover focus-visible:bg-hover focus-visible:outline-none',
        muted ? 'text-fg-muted hover:text-fg' : 'text-fg',
        expanded && 'bg-hover/60',
      )}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-fg-subtle transition-colors group-hover/row:text-fg-muted">
        {iconNode ?? (Icon && <Icon aria-hidden className="h-4 w-4" />)}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta !== undefined && meta !== null && <span className="flex shrink-0 items-center gap-1.5 text-[12px] tabular-nums text-fg-subtle">{meta}</span>}
      {(chevron || expanded !== undefined) && (
        <ChevronRight
          aria-hidden
          className={cn('h-3.5 w-3.5 shrink-0 text-fg-subtle transition-[transform,opacity] duration-150', expanded ? 'rotate-90 opacity-100' : 'opacity-60 group-hover/row:opacity-100')}
        />
      )}
    </button>
  )
}

/** What a row opens out onto: framed under it, inside the card, which scrolls when it grows past the window. */
function Section({ testId, children }: { testId: string; children: ReactNode }): JSX.Element {
  return (
    <div data-testid={testId} className="mx-1 mb-1.5 mt-0.5 min-w-0 overflow-hidden rounded-lg border border-line bg-panel">
      {children}
    </div>
  )
}

function GoneNote(): JSX.Element {
  return (
    <p className="flex items-start gap-2 px-3 py-2.5 text-[12px] leading-snug text-fg-muted">
      <FolderX aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-subtle" />
      This thread’s worktree was deleted, so its folder is gone. What the agent did is still in the conversation.
    </p>
  )
}

/** The card's width with a section open: room for a list, at least the docked sidebar's width. */
const OPEN_WIDTH_REM = 22

function Divider(): JSX.Element {
  return <div role="separator" className="-mx-1.5 my-1.5 border-t border-line" />
}

/** "Open folder" (and "Open in VS Code" where main can hand the folder to it) for the thread or the project shown. */
function OpenFolderRows({ inboxId, kind, distro }: { inboxId: string; kind: 'native' | 'wsl'; distro?: string }): JSX.Element {
  const { canOpenInVsCode, openInVsCode, reveal } = useOpenFolder({ inboxId }, kind, distro)
  return (
    <>
      <Row icon={FolderOpen} label="Open in File Explorer" muted onClick={reveal} testId="inbox-menu-reveal" />
      {canOpenInVsCode && <Row icon={Code} label="Open in VS Code" muted onClick={openInVsCode} testId="inbox-menu-vscode" />}
    </>
  )
}

/**
 * The sidebar as a card floating over the conversation's top right corner: where the thread works and what can be
 * opened from there, each row with what it holds at a glance. Files, Changes and Tools open out below their row, one
 * at a time, and the card scrolls when that runs past the window. The branch opens the Git graph (the card steps aside
 * meanwhile), and Terminal shows the floating terminal or docks the sidebar on its Terminal tab.
 */
export function InboxSidebarMenu({
  session,
  threadId,
  gui,
}: {
  session: DirectoryContext
  threadId?: string
  /** The open thread is a GUI chat, whose tool calls can be listed. */
  gui: boolean
}): JSX.Element {
  const thread: InboxThread | undefined = useWorkspace((s) => (threadId ? s.inboxThreads.find((item) => item.id === threadId) : undefined))
  const project = useInboxChat((s) => (thread ? inboxThreadFolder(thread, s.folders) : s.folders.find((folder) => folder.id === session.id)))
  const messages = useInboxChat((s) => (threadId && gui ? s.threads[threadId]?.messages : undefined))
  const tally = useMemo(() => (threadId && gui ? toolTally(messages ?? []) : null), [threadId, gui, messages])
  const changes = useInboxChanges((s) => (threadId ? s.entries[inboxChangesKey(threadId)]?.value : undefined))
  const floatingTerminal = useInboxFloatingTerminal((s) => s.floating)
  const toggleCollapsed = useWorkspace((s) => s.toggleFileTree)
  const stored = useInboxView((s) => s.floatingSection)
  const sidebarWidth = useInboxView((s) => s.sidebarWidth)
  const removed = thread?.worktreeRemovedAt !== undefined
  // Changes and Tools belong to a thread, and Tools to a GUI one; a section that does not apply is shut.
  const open: FloatingSection | null = stored === 'files' || (stored === 'changes' && threadId) || (stored === 'tools' && tally) ? stored : null
  const toggle = (section: FloatingSection): void => useInboxView.getState().setFloatingSection(open === section ? null : section)
  const name = project?.name ?? inboxFolderLabel(thread ? inboxThreadHome(thread) : session.path)
  const kind = thread ? thread.target.kind : session.kind
  const distro = thread ? (thread.target.kind === 'wsl' ? thread.target.distro : undefined) : session.distro
  const available = changes?.available ? changes : null
  return (
    <nav
      aria-label="Thread sidebar"
      data-testid="inbox-sidebar-menu"
      data-open={open ?? undefined}
      onKeyDown={walkRows}
      style={open ? { width: `max(${OPEN_WIDTH_REM}rem, ${sidebarWidth}px)` } : undefined}
      className={cn(
        'absolute right-3 z-20 flex w-[17rem] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden transition-[width] duration-150',
        threadId ? 'max-h-[calc(100%-4.25rem)]' : 'max-h-[calc(100%-1.5rem)]',
        floatingTop(threadId),
        CARD,
      )}
    >
      <div className="min-h-0 overflow-y-auto overscroll-contain p-1.5" data-testid="inbox-sidebar-menu-scroller">
        <div
          className="flex h-8 min-w-0 items-center gap-2.5 px-2.5 text-[13px] font-medium text-fg"
          title={thread?.directory ?? session.path}
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center"><ProjectIcon icon={project?.icon} /></span>
          <span className="min-w-0 flex-1 truncate">{name}</span>
        </div>
        {!removed && <OpenFolderRows inboxId={threadId ?? session.id} kind={kind} {...(distro ? { distro } : {})} />}
        <Row icon={Folder} label="Files" muted={removed} expanded={open === 'files'} onClick={() => toggle('files')} testId="inbox-menu-files" />
        {open === 'files' && (
          <Section testId="inbox-menu-files-section">{removed ? <GoneNote /> : <FilesSection session={session} />}</Section>
        )}
        <Row
          icon={SquareTerminal}
          label="Terminal"
          meta={floatingTerminal
            ? <kbd className="rounded border border-line px-1 font-sans text-[10.5px]">F11</kbd>
            : <PanelRight aria-hidden className="h-3.5 w-3.5" />}
          title={floatingTerminal ? 'Show the floating terminal (F11)' : 'Dock the sidebar and show its terminal'}
          onClick={() => showInboxTerminal(true)}
          testId="inbox-menu-terminal"
        />
        {threadId && (
          <>
            <Divider />
            {available?.branch && !removed && (
              <Row
                icon={GitBranch}
                label={available.branch}
                meta="Graph"
                title="Show every commit, branch and tag in a graph"
                onClick={() => useInboxChanges.getState().openGraph(threadId)}
                testId="inbox-menu-graph"
              />
            )}
            <Row
              icon={FileDiff}
              label="Changes"
              muted={!available || available.fileCount === 0}
              expanded={open === 'changes'}
              meta={available ? (
                available.fileCount === 0 ? 'None' : (
                  <span className="inbox-code-font flex items-center gap-1.5 text-[11.5px]">
                    {available.additions > 0 && <span className="text-ok">+{available.additions}</span>}
                    <span className={available.deletions > 0 ? 'text-danger' : 'text-fg-subtle'}>−{available.deletions}</span>
                  </span>
                )
              ) : changes ? 'No Git' : undefined}
              onClick={() => toggle('changes')}
              testId="inbox-menu-changes"
            />
            {open === 'changes' && (
              <Section testId="inbox-menu-changes-panel">{removed ? <GoneNote /> : <ChangesSection threadId={threadId} />}</Section>
            )}
            {tally && thread && (
              <>
                <Row
                  icon={Wrench}
                  label="Tools"
                  muted={tally.all === 0}
                  expanded={open === 'tools'}
                  meta={tally.all === 0 ? 'None' : (
                    <>
                      <span title={`${tally.actions} commands and MCP calls of ${tally.all} tool calls`}>{tally.actions} {tally.actions === 1 ? 'action' : 'actions'}</span>
                      {tally.failed > 0 && <span className="text-danger" title={`${tally.failed} failed`}>{tally.failed} failed</span>}
                    </>
                  )}
                  onClick={() => toggle('tools')}
                  testId="inbox-menu-tools"
                />
                {open === 'tools' && (
                  <Section testId="inbox-menu-tools-section"><InboxToolCalls thread={thread} /></Section>
                )}
              </>
            )}
          </>
        )}
        <Divider />
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            data-menu-row
            data-testid="inbox-menu-dock"
            onClick={() => useInboxView.getState().setSidebarFloating(false)}
            className="flex h-7 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 text-left text-[12px] text-fg-subtle transition-colors hover:bg-hover hover:text-fg focus-visible:bg-hover focus-visible:outline-none"
          >
            <PanelRight aria-hidden className="h-4 w-4 shrink-0" />
            Dock as sidebar
          </button>
          <button
            type="button"
            data-menu-row
            aria-label="Hide menu"
            title="Hide menu"
            onClick={toggleCollapsed}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-subtle transition-colors hover:bg-hover hover:text-fg focus-visible:bg-hover focus-visible:outline-none"
          >
            <PanelRightClose aria-hidden className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </nav>
  )
}

/** The menu hidden: one small button in its corner brings it back. */
export function InboxSidebarMenuButton({ threadId }: { threadId?: string }): JSX.Element {
  const toggle = useWorkspace((s) => s.toggleFileTree)
  return (
    <button
      type="button"
      aria-label="Show menu"
      title="Show menu"
      data-testid="inbox-sidebar-menu-show"
      onClick={toggle}
      className={cn('absolute right-3 z-20 flex h-8 w-8 items-center justify-center text-fg-muted transition-colors hover:text-fg', floatingTop(threadId), CARD)}
    >
      <PanelRightOpen aria-hidden className="h-4 w-4" />
    </button>
  )
}
