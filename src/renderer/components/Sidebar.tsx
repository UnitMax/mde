import {
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent
} from 'react'
import {
  ChevronDown,
  ChevronRight,
  Check,
  CircleAlert,
  Code,
  Copy,
  Folder,
  FolderOpen,
  FolderPlus,
  GripVertical,
  LoaderCircle,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Terminal,
  Trash2
} from 'lucide-react'
import type { Project, PtyStatus, Session } from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useWorkspace, type OpenCodeChatState, type OpenCodeTuiStatusState } from '@/store/workspace'
import {
  DEFAULT_SESSION_COLOR,
  SESSION_COLORS,
  sessionColorHex
} from '@shared/session-colors'

const STATUS_STYLE: Record<PtyStatus, { dot: string; label: string }> = {
  none: { dot: 'bg-fg-subtle', label: 'No shell running' },
  running: { dot: 'bg-ok', label: 'Shell running' },
  exited: { dot: 'bg-danger', label: 'Shell exited' }
}

type OpenCodeIndicatorStatus = 'idle' | 'working' | 'attention' | 'completed' | 'error'

interface SessionIndicator {
  status: PtyStatus | OpenCodeIndicatorStatus
  dot: string
  label: string
  row?: string
}

const OPENCODE_STATUS_STYLE: Record<OpenCodeIndicatorStatus, Omit<SessionIndicator, 'status'>> = {
  idle: { dot: 'bg-fg-subtle', label: 'OpenCode idle' },
  working: { dot: 'text-accent', label: 'OpenCode is working' },
  attention: { dot: 'text-accent', label: 'OpenCode needs input', row: 'bg-accent/10' },
  completed: { dot: 'bg-ok', label: 'OpenCode finished', row: 'bg-ok/10' },
  error: { dot: 'bg-danger', label: 'OpenCode request failed', row: 'bg-danger/10' }
}

function attentionIndicator(reason: 'permission' | 'question'): SessionIndicator {
  return {
    status: 'attention',
    dot: 'text-accent',
    label: reason === 'question' ? 'OpenCode is asking a question' : 'OpenCode is waiting for permission',
    row: 'bg-accent/10'
  }
}

function sessionIndicator(
  status: PtyStatus,
  chat?: OpenCodeChatState,
  tuiStatus?: OpenCodeTuiStatusState
): SessionIndicator {
  if (chat) {
    const waitingForQuestion = chat.liveItems.some(
      (item) => item.role === 'question' && !item.responding
    )
    if (waitingForQuestion) return attentionIndicator('question')
    const activeSubagent = chat.subagents.some(
      (subagent) => subagent.status === 'working' || subagent.status === 'waiting'
    )
    if (chat.pending || activeSubagent) {
      const waitingForPermission = chat.liveItems.some(
        (item) => item.role === 'permission' && !item.responding
      ) || chat.subagents.some((subagent) => subagent.status === 'waiting')
      if (waitingForPermission) return attentionIndicator('permission')
      return { status: 'working', ...OPENCODE_STATUS_STYLE.working }
    }
    if (chat.unreadCompletion) {
      const guiStatus = chat.error ? 'error' : 'completed'
      return { status: guiStatus, ...OPENCODE_STATUS_STYLE[guiStatus] }
    }
    return { status: 'idle', ...OPENCODE_STATUS_STYLE.idle }
  }
  if (tuiStatus) {
    if ((tuiStatus.status === 'completed' || tuiStatus.status === 'error') && !tuiStatus.unread) {
      return { status: 'idle', ...OPENCODE_STATUS_STYLE.idle }
    }
    if (tuiStatus.status === 'attention') {
      return attentionIndicator(tuiStatus.attentionReason ?? 'permission')
    }
    return { status: tuiStatus.status, ...OPENCODE_STATUS_STYLE[tuiStatus.status] }
  }
  return { status, ...STATUS_STYLE[status] }
}

function customSessionColor(color: Session['color']): Session['color'] {
  return color && color !== DEFAULT_SESSION_COLOR ? color : undefined
}

function sessionStatusTint(status: SessionIndicator['status']): string | undefined {
  switch (status) {
    case 'attention':
      return 'linear-gradient(rgba(91, 140, 255, 0.12), rgba(91, 140, 255, 0.12))'
    case 'completed':
      return 'linear-gradient(rgba(63, 185, 80, 0.12), rgba(63, 185, 80, 0.12))'
    case 'error':
      return 'linear-gradient(rgba(240, 87, 79, 0.14), rgba(240, 87, 79, 0.14))'
    default:
      return undefined
  }
}

function customSessionStatusRing(status: SessionIndicator['status']): string | undefined {
  switch (status) {
    case 'attention':
      return 'ring-1 ring-accent/70'
    case 'completed':
      return 'ring-1 ring-ok/70'
    case 'error':
      return 'ring-1 ring-danger/70'
    default:
      return undefined
  }
}

function sessionBackgroundStyle(
  color: Session['color'],
  indicator: SessionIndicator
): { backgroundColor: string; backgroundImage?: string } | undefined {
  const customColor = customSessionColor(color)
  if (!customColor) return undefined
  const tint = sessionStatusTint(indicator.status)
  return {
    backgroundColor: sessionColorHex(customColor),
    ...(tint ? { backgroundImage: tint } : {})
  }
}

function StatusDot({
  indicator,
  className
}: {
  indicator: SessionIndicator
  className?: string
}): JSX.Element {
  const sharedProps = {
    'data-testid': 'session-status',
    'data-status': indicator.status,
    title: indicator.label
  }

  if (indicator.status === 'working' || indicator.status === 'attention') {
    const Icon = indicator.status === 'attention' ? CircleAlert : LoaderCircle
    return (
      <Icon
        {...sharedProps}
        className={cn(
          'h-2.5 w-2.5 shrink-0 text-accent',
          indicator.status === 'working' && 'animate-spin',
          className
        )}
      />
    )
  }

  return (
    <span
      {...sharedProps}
      className={cn('h-1.5 w-1.5 shrink-0 rounded-full', indicator.dot, className)}
    />
  )
}

function SessionModeIcon({ mode, className }: { mode: Session['mode']; className?: string }): JSX.Element {
  const Icon = mode === 'terminal' ? Terminal : MessageSquare
  const label = mode === 'terminal' ? 'Terminal session' : 'GUI session'
  return (
    <Icon
      aria-label={label}
      data-testid="session-mode"
      data-mode={mode}
      className={cn('h-3.5 w-3.5 shrink-0 text-fg-subtle', className)}
    >
      <title>{label}</title>
    </Icon>
  )
}

interface SessionRowProps {
  session: Session
  status: PtyStatus
  chat?: OpenCodeChatState
  tuiStatus?: OpenCodeTuiStatusState
  selected: boolean
  onSelect: () => void
  dragging: boolean
  dragDisabled: boolean
  dropPosition: 'before' | 'after' | null
  onDragStart: () => void
  onDragEnd: () => void
  onDragOver: (event: ReactDragEvent<HTMLDivElement>) => void
  onDrop: (event: ReactDragEvent<HTMLDivElement>) => void
}

function SessionRow({
  session,
  status,
  chat,
  tuiStatus,
  selected,
  onSelect,
  dragging,
  dragDisabled,
  dropPosition,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop
}: SessionRowProps): JSX.Element {
  const renameSession = useWorkspace((state) => state.renameSession)
  const duplicateSession = useWorkspace((state) => state.duplicateSession)
  const setSessionColor = useWorkspace((state) => state.setSessionColor)
  const moveSession = useWorkspace((state) => state.moveSession)
  const removeSession = useWorkspace((state) => state.removeSession)
  const revealSession = useWorkspace((state) => state.revealSession)
  const openSessionInVsCode = useWorkspace((state) => state.openSessionInVsCode)
  const projects = useWorkspace((state) => state.projects)
  const platform = useWorkspace((state) => state.platform)
  const wslAvailable = useWorkspace((state) => state.wslAvailable)

  const rowRef = useRef<HTMLDivElement>(null)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(session.name)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [moving, setMoving] = useState(false)
  const [targetProjectId, setTargetProjectId] = useState(session.projectId)

  const startRename = (): void => {
    setDraftName(session.name)
    setRenaming(true)
  }

  const commitRename = (): void => {
    setRenaming(false)
    const name = draftName.trim()
    if (name && name !== session.name) void renameSession(session.id, name)
    else setDraftName(session.name)
  }

  const openMenuFromButton = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    rowRef.current?.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        clientX: rect.left,
        clientY: rect.bottom
      })
    )
  }

  const move = async (): Promise<void> => {
    if (!targetProjectId || targetProjectId === session.projectId) {
      setMoving(false)
      return
    }
    await moveSession(session.id, targetProjectId)
    setMoving(false)
  }

  const location = session.kind === 'wsl' ? `${session.distro ?? 'WSL'} · ${session.path}` : session.path
  const indicator = sessionIndicator(status, chat, tuiStatus)
  const sessionColor = session.color ?? DEFAULT_SESSION_COLOR
  const customColor = customSessionColor(session.color)
  const backgroundStyle = sessionBackgroundStyle(session.color, indicator)
  const canOpenInVsCode =
    platform?.isWindows === true && wslAvailable && session.kind === 'wsl' && Boolean(session.distro)
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={rowRef}
            role="button"
            tabIndex={0}
            data-testid="session-row"
            onClick={onSelect}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onKeyDown={(event) => {
              if (event.key === 'F2' && event.target === event.currentTarget) {
                event.preventDefault()
                startRename()
                return
              }
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelect()
              }
            }}
            className={cn(
              'group ml-3 flex w-[calc(100%-0.75rem)] cursor-default items-center gap-2 rounded px-2 py-1.5 text-left',
              customColor
                ? cn('text-fg transition-[filter] hover:brightness-110', customSessionStatusRing(indicator.status))
                : selected
                  ? cn(
                      'bg-active text-fg',
                      indicator.status === 'attention' && 'ring-1 ring-accent/60'
                    )
                  : cn('text-fg-muted hover:bg-hover hover:text-fg', indicator.row),
              dragging && 'opacity-60',
              dropPosition === 'before' && 'border-t-2 border-accent',
              dropPosition === 'after' && 'border-b-2 border-accent'
            )}
            style={backgroundStyle}
          >
            <button
              type="button"
              draggable={!dragDisabled}
              disabled={dragDisabled}
              aria-label={`Drag to reorder ${session.name}`}
              title="Drag to reorder"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onDragStart={(event) => {
                event.stopPropagation()
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', session.id)
                onDragStart()
              }}
              onDragEnd={(event) => {
                event.stopPropagation()
                onDragEnd()
              }}
              className="shrink-0 cursor-grab rounded text-fg-subtle hover:text-fg active:cursor-grabbing disabled:cursor-default disabled:opacity-50"
            >
              <GripVertical className="h-3.5 w-3.5" />
            </button>
            <StatusDot indicator={indicator} />

            <div className="min-w-0 flex-1">
              {renaming ? (
                <input
                  autoFocus
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitRename()
                    if (event.key === 'Escape') {
                      setDraftName(session.name)
                      setRenaming(false)
                    }
                    event.stopPropagation()
                  }}
                  onClick={(event) => event.stopPropagation()}
                  className="h-5 w-full rounded-sm border border-accent bg-bg px-1 text-[13px] text-fg outline-none"
                />
              ) : (
                <div data-testid="session-name" className="truncate text-[13px] leading-tight">
                  {session.name}
                </div>
              )}
              <div
                className="flex min-w-0 items-center gap-1.5 text-[11px] leading-tight text-fg-subtle"
                title={location}
              >
                <SessionModeIcon mode={session.mode} />
                <span className="min-w-0 truncate">{location}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={openMenuFromButton}
              title="Session actions"
              className={cn(
                'shrink-0 rounded p-0.5 text-fg-subtle opacity-0 transition-opacity',
                'hover:bg-elevated hover:text-fg focus:opacity-100 group-hover:opacity-100'
              )}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
          <ContextMenuItem
            onSelect={startRename}
          >
            <Pencil className="h-3.5 w-3.5" />
            Rename
          </ContextMenuItem>
          {session.mode === 'terminal' && (
            <ContextMenuItem onSelect={() => void duplicateSession(session.id)}>
              <Copy className="h-3.5 w-3.5" />
              Duplicate session
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <span
                aria-hidden="true"
                className="h-3 w-3 shrink-0 rounded-full border border-white/20"
                style={{ backgroundColor: sessionColorHex(sessionColor) }}
              />
              <span className="flex-1">Session color</span>
              <ChevronRight className="h-3.5 w-3.5 text-fg-subtle" />
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {SESSION_COLORS.map((option) => (
                <ContextMenuItem
                  key={option.id}
                  onSelect={() => void setSessionColor(session.id, option.id)}
                >
                  <span
                    aria-hidden="true"
                    className="h-3 w-3 shrink-0 rounded-full border border-white/20"
                    style={{ backgroundColor: option.hex }}
                  />
                  <span className="flex-1">{option.label}</span>
                  {sessionColor === option.id && <Check className="h-3.5 w-3.5" />}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem onSelect={() => void revealSession(session.id)}>
            <FolderOpen className="h-3.5 w-3.5" />
            Reveal in file manager
          </ContextMenuItem>
          {canOpenInVsCode && (
            <ContextMenuItem onSelect={() => void openSessionInVsCode(session.id)}>
              <Code className="h-3.5 w-3.5" />
              Open in VS Code
            </ContextMenuItem>
          )}
          <ContextMenuItem
            onSelect={() => {
              setTargetProjectId(session.projectId)
              setMoving(true)
            }}
          >
            <Folder className="h-3.5 w-3.5" />
            Move to project
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem destructive onSelect={() => setConfirmingRemove(true)}>
            <Trash2 className="h-3.5 w-3.5" />
            Remove session
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={moving} onOpenChange={setMoving}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move session</DialogTitle>
            <DialogDescription>Choose the project label for “{session.name}”.</DialogDescription>
          </DialogHeader>
          <Select value={targetProjectId} onValueChange={setTargetProjectId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setMoving(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={targetProjectId === session.projectId}
              onClick={() => void move()}
            >
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmingRemove} onOpenChange={setConfirmingRemove}>
        <AlertDialogContent>
          <AlertDialogTitle>Remove “{session.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The session and its terminal process are removed from mde. Nothing on disk is deleted.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void removeSession(session.id)}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

interface SessionDropTarget {
  sessionId: string
  position: 'before' | 'after'
}

interface ProjectGroupProps {
  project: Project
  sessions: Session[]
  statuses: Record<string, PtyStatus>
  opencodeChats: Record<string, OpenCodeChatState>
  opencodeTuiStatuses: Record<string, OpenCodeTuiStatusState>
  selectedSessionId: string | null
  onSelectSession: (id: string) => void
  onNewSession: (projectId: string) => void
}

function ProjectGroup({
  project,
  sessions,
  statuses,
  opencodeChats,
  opencodeTuiStatuses,
  selectedSessionId,
  onSelectSession,
  onNewSession
}: ProjectGroupProps): JSX.Element {
  const renameProject = useWorkspace((state) => state.renameProject)
  const removeProject = useWorkspace((state) => state.removeProject)
  const reorderSession = useWorkspace((state) => state.reorderSession)
  const [collapsed, setCollapsed] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(project.name)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [draggingSessionId, setDraggingSessionId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<SessionDropTarget | null>(null)
  const [reordering, setReordering] = useState(false)

  const resetDragState = (): void => {
    setDraggingSessionId(null)
    setDropTarget(null)
  }

  const handleDragStart = (sessionId: string): void => {
    if (reordering) return
    setDraggingSessionId(sessionId)
    setDropTarget(null)
  }

  const handleDragEnd = (): void => {
    resetDragState()
  }

  const handleDragOver = (event: ReactDragEvent<HTMLDivElement>, sessionId: string): void => {
    if (!draggingSessionId || reordering || sessionId === draggingSessionId) {
      if (sessionId === draggingSessionId) setDropTarget(null)
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setDropTarget((current) =>
      current?.sessionId === sessionId && current.position === position
        ? current
        : { sessionId, position }
    )
  }

  const commitDrop = async (
    sourceId: string,
    targetId: string,
    position: 'before' | 'after'
  ): Promise<void> => {
    const source = sessions.find((session) => session.id === sourceId)
    const remaining = sessions.filter((session) => session.id !== sourceId)
    const targetIndex = remaining.findIndex((session) => session.id === targetId)
    if (!source || targetIndex < 0) {
      resetDragState()
      return
    }

    const insertionIndex = position === 'before' ? targetIndex : targetIndex + 1
    const beforeId = remaining[insertionIndex]?.id ?? null
    const nextOrder = [...remaining]
    nextOrder.splice(insertionIndex, 0, source)
    if (nextOrder.every((session, index) => session.id === sessions[index]?.id)) {
      resetDragState()
      return
    }

    setReordering(true)
    resetDragState()
    try {
      await reorderSession(sourceId, beforeId)
    } finally {
      setReordering(false)
    }
  }

  const handleDrop = (event: ReactDragEvent<HTMLDivElement>, targetId: string): void => {
    event.preventDefault()
    if (reordering) {
      resetDragState()
      return
    }

    const sourceId = draggingSessionId ?? event.dataTransfer.getData('text/plain')
    if (!sourceId || sourceId === targetId) {
      resetDragState()
      return
    }

    const rect = event.currentTarget.getBoundingClientRect()
    const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    void commitDrop(sourceId, targetId, position)
  }

  const commitRename = (): void => {
    setRenaming(false)
    const name = draftName.trim()
    if (name && name !== project.name) void renameProject(project.id, name)
    else setDraftName(project.name)
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="group flex w-full items-center gap-1 rounded px-2 py-1 text-left text-fg-muted hover:bg-hover hover:text-fg">
            {renaming ? (
              <input
                autoFocus
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onBlur={commitRename}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitRename()
                  if (event.key === 'Escape') {
                    setDraftName(project.name)
                    setRenaming(false)
                  }
                  event.stopPropagation()
                }}
                className="h-6 min-w-0 flex-1 rounded-sm border border-accent bg-bg px-1 text-[13px] text-fg outline-none"
              />
            ) : (
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                onClick={() => setCollapsed((value) => !value)}
                title={collapsed ? 'Expand project' : 'Collapse project'}
              >
                {collapsed ? (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                )}
                <Folder className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate text-[13px] font-medium">{project.name}</span>
                <span className="text-[11px] text-fg-subtle">{sessions.length}</span>
              </button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto shrink-0 opacity-0 group-hover:opacity-100"
              onClick={(event) => {
                event.stopPropagation()
                onNewSession(project.id)
              }}
              title="New session in this project"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
          <ContextMenuItem
            onSelect={() => {
              setDraftName(project.name)
              setRenaming(true)
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
            Rename project
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem destructive onSelect={() => setConfirmingRemove(true)}>
            <Trash2 className="h-3.5 w-3.5" />
            Remove project
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {!collapsed &&
        sessions.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            status={statuses[session.id] ?? 'none'}
            chat={opencodeChats[session.id]}
            tuiStatus={opencodeTuiStatuses[session.id]}
            selected={session.id === selectedSessionId}
            onSelect={() => onSelectSession(session.id)}
            dragging={session.id === draggingSessionId}
            dragDisabled={reordering}
            dropPosition={
              dropTarget?.sessionId === session.id ? dropTarget.position : null
            }
            onDragStart={() => handleDragStart(session.id)}
            onDragEnd={handleDragEnd}
            onDragOver={(event) => handleDragOver(event, session.id)}
            onDrop={(event) => handleDrop(event, session.id)}
          />
        ))}

      <AlertDialog open={confirmingRemove} onOpenChange={setConfirmingRemove}>
        <AlertDialogContent>
          <AlertDialogTitle>Remove “{project.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the project label, all of its sessions, and their terminal processes.
            Nothing on disk is deleted.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void removeProject(project.id)}>
              Remove project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

interface SidebarProps {
  onNewProject: () => void
  onNewSession: (projectId?: string) => void
  onAbout: () => void
}

export function Sidebar({ onNewProject, onNewSession, onAbout }: SidebarProps): JSX.Element {
  const projects = useWorkspace((state) => state.projects)
  const sessions = useWorkspace((state) => state.sessions)
  const statuses = useWorkspace((state) => state.statuses)
  const opencodeChats = useWorkspace((state) => state.opencodeChats)
  const opencodeTuiStatuses = useWorkspace((state) => state.opencodeTuiStatuses)
  const selectedSessionId = useWorkspace((state) => state.selectedSessionId)
  const selectSession = useWorkspace((state) => state.selectSession)
  const collapsed = useWorkspace((state) => state.sidebarCollapsed)
  const toggleSidebar = useWorkspace((state) => state.toggleSidebar)

  if (collapsed) {
    return (
      <aside className="flex h-full min-h-0 w-11 shrink-0 flex-col items-center overflow-hidden border-r border-line bg-panel py-2">
        <Button variant="ghost" size="icon" onClick={toggleSidebar} title="Expand sidebar">
          <PanelLeftOpen className="h-4 w-4" />
        </Button>
        <div className="mt-2 min-h-0 w-full flex-1 overflow-y-auto">
          <div className="flex flex-col items-center gap-1">
            {projects.map((project) => {
              const projectSessions = sessions.filter((session) => session.projectId === project.id)
              return projectSessions.length > 0 ? (
                projectSessions.map((session) => {
                  const indicator = sessionIndicator(
                    statuses[session.id] ?? 'none',
                    opencodeChats[session.id],
                    opencodeTuiStatuses[session.id]
                  )
                  const customColor = customSessionColor(session.color)
                  return (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => selectSession(session.id)}
                      title={`${project.name} · ${session.name} · ${session.mode === 'terminal' ? 'Terminal' : 'GUI'}`}
                      className={cn(
                        'relative flex h-7 w-7 items-center justify-center rounded text-[11px] font-medium uppercase',
                        customColor
                          ? cn(
                              'text-fg transition-[filter] hover:brightness-110',
                              customSessionStatusRing(indicator.status)
                            )
                          : session.id === selectedSessionId
                            ? cn(
                                'bg-active text-fg',
                                indicator.status === 'attention' && 'ring-1 ring-accent/60'
                              )
                            : cn('text-fg-muted hover:bg-hover hover:text-fg', indicator.row)
                      )}
                      style={sessionBackgroundStyle(session.color, indicator)}
                    >
                      {session.name.slice(0, 2)}
                      <StatusDot
                        indicator={indicator}
                        className="absolute -bottom-0.5 right-0.5 ring-2 ring-panel"
                      />
                    </button>
                  )
                })
              ) : (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => onNewSession(project.id)}
                  title={`${project.name} · New session`}
                  className="flex h-7 w-7 items-center justify-center rounded text-[11px] font-medium uppercase text-fg-muted hover:bg-hover hover:text-fg"
                >
                  {project.name.slice(0, 2)}
                </button>
              )
            })}
          </div>
        </div>
        <div className="mt-auto flex shrink-0 flex-col gap-1">
          <Button variant="ghost" size="icon" onClick={() => onNewSession()} title="New session">
            <Plus className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onNewProject} title="New project">
            <FolderPlus className="h-4 w-4" />
          </Button>
        </div>
      </aside>
    )
  }

  return (
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
        <button
          type="button"
          onClick={onAbout}
          title="About MDE"
          aria-label="About MDE"
          data-testid="about-mde"
          className="rounded text-[13px] font-semibold tracking-tight text-fg hover:text-accent focus:outline-none focus:ring-1 focus:ring-accent"
        >
          mde
        </button>
        <span className="text-[11px] text-fg-subtle">agentic dev environment</span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          onClick={toggleSidebar}
          title="Collapse sidebar"
        >
          <PanelLeftClose className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex items-center px-3 pb-1 pt-3">
        <span className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
          Projects
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          onClick={onNewProject}
          title="New project"
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {projects.length === 0 ? (
          <p className="px-2 py-1 text-xs text-fg-subtle">No projects yet.</p>
        ) : (
          projects.map((project) => (
            <ProjectGroup
              key={project.id}
              project={project}
              sessions={sessions.filter((session) => session.projectId === project.id)}
              statuses={statuses}
              opencodeChats={opencodeChats}
              opencodeTuiStatuses={opencodeTuiStatuses}
              selectedSessionId={selectedSessionId}
              onSelectSession={selectSession}
              onNewSession={(projectId) => onNewSession(projectId)}
            />
          ))
        )}
      </div>

      <div className="shrink-0 border-t border-line p-2">
        <Button variant="secondary" size="sm" className="w-full" onClick={() => onNewSession()}>
          <Plus className="h-3.5 w-3.5" />
          New session
        </Button>
      </div>
    </aside>
  )
}
