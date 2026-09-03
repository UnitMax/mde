import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AddSessionDialog } from '@/components/AddProjectDialog'
import { GitDialog } from '@/components/GitDialog'
import { GitLaneView, type GitSessionDefaults } from '@/components/GitLaneView'
import { NewProjectDialog } from '@/components/NewProjectDialog'
import { NewTodoProjectDialog } from '@/components/NewTodoProjectDialog'
import { Sidebar } from '@/components/Sidebar'
import { SessionSwitcher } from '@/components/SessionSwitcher'
import { TerminalView } from '@/components/TerminalView'
import { TodoProjectView } from '@/components/TodoProjectView'
import { TodoProjectSettingsDialog } from '@/components/TodoProjectSettingsDialog'
import { TodoTaskDialog } from '@/components/TodoTaskDialog'
import {
  TerminalTaskLinkDialog,
  type TerminalTaskLinkTarget
} from '@/components/TerminalTaskLinkDialog'
import { isSessionSwitcherShortcut } from '@/lib/session-switcher'
import { useWorkspace } from '@/store/workspace'
import { disposeSession, getSession } from '@/terminal/sessions'
import {
  activeSessionTab,
  createRuntimeLayout,
  nextPaneId,
  persistRuntimeLayout,
  sessionTabs,
  terminalIdForPane
} from '@/terminal/tabs'
import {
  defaultTerminalLayoutSizes,
  orderTerminalPanes,
  removeTerminalPane,
  terminalCount,
  type SessionTerminalLayout,
  type TerminalLayout,
  type TerminalColumnIndex,
  type TerminalResizeAxis
} from '@/terminal/layout'
import type { PersistedTerminalLayout, Session, TodoTask } from '@shared/types'
import {
  liveTerminalDescriptors,
  type LiveTerminalDescriptor
} from '@/lib/terminal-task-links'

type RuntimeLayouts = Record<string, Record<string, SessionTerminalLayout>>

function EmptyState({ onNewSession }: { onNewSession: () => void }): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <Terminal className="h-6 w-6 text-fg-subtle" />
      <div>
        <p className="text-[13px] text-fg-muted">No session selected</p>
        <p className="mt-1 text-xs text-fg-subtle">
          Pick a session in the sidebar, or add a folder to work in.
        </p>
      </div>
      <Button size="sm" onClick={onNewSession}>
        <Plus className="h-3.5 w-3.5" />
        New session
      </Button>
    </div>
  )
}

export function App(): JSX.Element {
  const init = useWorkspace((state) => state.init)
  const ready = useWorkspace((state) => state.ready)
  const sessions = useWorkspace((state) => state.sessions)
  const todoProjects = useWorkspace((state) => state.todoProjects)
  const todoTasks = useWorkspace((state) => state.todoTasks)
  const terminalStatuses = useWorkspace((state) => state.statuses)
  const opencodeTuiInstances = useWorkspace((state) => state.opencodeTuiInstances)
  const selectedSessionId = useWorkspace((state) => state.selectedSessionId)
  const selectedTodoProjectId = useWorkspace((state) => state.selectedTodoProjectId)
  const activeWorkspaceView = useWorkspace((state) => state.activeWorkspaceView)
  const selectSession = useWorkspace((state) => state.selectSession)
  const addTabAction = useWorkspace((state) => state.addTab)
  const selectTabAction = useWorkspace((state) => state.selectTab)
  const renameTabAction = useWorkspace((state) => state.renameTab)
  const updateTabLayoutAction = useWorkspace((state) => state.updateTabLayout)
  const removeTabAction = useWorkspace((state) => state.removeTab)
  const clearExit = useWorkspace((state) => state.clearExit)
  const setStatus = useWorkspace((state) => state.setStatus)
  const unlinkTerminalTask = useWorkspace((state) => state.unlinkTerminalTask)
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [newTodoProjectOpen, setNewTodoProjectOpen] = useState(false)
  const [todoProjectSettingsOpen, setTodoProjectSettingsOpen] = useState(false)
  const [todoTaskDialogOpen, setTodoTaskDialogOpen] = useState(false)
  const [todoTaskDialogTaskId, setTodoTaskDialogTaskId] = useState<string | null>(null)
  const [todoTaskDialogColumnId, setTodoTaskDialogColumnId] = useState<string | null>(null)
  const [gitSessionId, setGitSessionId] = useState<string | null>(null)
  const [sessionSwitcherOpen, setSessionSwitcherOpen] = useState(false)
  const [terminalTaskLinkTarget, setTerminalTaskLinkTarget] = useState<TerminalTaskLinkTarget | null>(null)
  const [defaultProjectId, setDefaultProjectId] = useState<string | undefined>(undefined)
  const [gitSessionDefaults, setGitSessionDefaults] = useState<GitSessionDefaults | null>(null)
  const [terminalLayouts, setTerminalLayouts] = useState<RuntimeLayouts>({})
  const [pendingTerminalFocus, setPendingTerminalFocus] = useState<{
    sessionId: string
    tabId: string
    terminalId: string
  } | null>(null)
  const terminalFocusRequestId = useRef(0)
  const terminalLayoutsRef = useRef<RuntimeLayouts>({})
  const sessionsRef = useRef(sessions)
  const pendingLayoutPersistence = useRef<Record<string, PersistedTerminalLayout>>({})
  const layoutPersistenceTimers = useRef<Record<string, number>>({})

  const liveTerminals = useMemo<LiveTerminalDescriptor[]>(
    () => liveTerminalDescriptors({
      sessions,
      terminalLayouts,
      statuses: terminalStatuses,
      opencodeTuiInstances
    }),
    [opencodeTuiInstances, sessions, terminalLayouts, terminalStatuses]
  )

  useEffect(() => {
    terminalLayoutsRef.current = terminalLayouts
  }, [terminalLayouts])

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  useEffect(() => {
    void init()
  }, [init])

  const flushLayoutPersistence = (key: string): void => {
    const layout = pendingLayoutPersistence.current[key]
    if (!layout) return
    delete pendingLayoutPersistence.current[key]
    const timer = layoutPersistenceTimers.current[key]
    if (timer !== undefined) {
      window.clearTimeout(timer)
      delete layoutPersistenceTimers.current[key]
    }
    const separator = key.indexOf('|')
    if (separator < 0) return
    const sessionId = key.slice(0, separator)
    const tabId = key.slice(separator + 1)
    void updateTabLayoutAction(sessionId, tabId, layout)
  }

  const queueLayoutPersistence = (
    sessionId: string,
    tabId: string,
    layout: SessionTerminalLayout,
    immediate = false
  ): void => {
    const key = `${sessionId}|${tabId}`
    pendingLayoutPersistence.current[key] = persistRuntimeLayout(layout)
    if (immediate) {
      flushLayoutPersistence(key)
      return
    }

    const currentTimer = layoutPersistenceTimers.current[key]
    if (currentTimer !== undefined) window.clearTimeout(currentTimer)
    layoutPersistenceTimers.current[key] = window.setTimeout(() => {
      flushLayoutPersistence(key)
    }, 180)
  }

  useEffect(() => {
    return () => {
      Object.keys(pendingLayoutPersistence.current).forEach(flushLayoutPersistence)
    }
  }, [])

  const disposeRuntimeTerminal = (terminalId: string): void => {
    clearExit(terminalId)
    setStatus(terminalId, 'none')
    unlinkTerminalTask(terminalId)
    disposeSession(terminalId)
    void window.api.pty.dispose(terminalId)
  }

  const setRuntimeLayout = (
    sessionId: string,
    tabId: string,
    layout: SessionTerminalLayout
  ): void => {
    const next: RuntimeLayouts = {
      ...terminalLayoutsRef.current,
      [sessionId]: {
        ...(terminalLayoutsRef.current[sessionId] ?? {}),
        [tabId]: layout
      }
    }
    terminalLayoutsRef.current = next
    setTerminalLayouts(next)
  }

  const layoutForTab = (session: Session, tabId: string): SessionTerminalLayout => {
    const tab = sessionTabs(session).find((candidate) => candidate.id === tabId) ?? activeSessionTab(session)
    return terminalLayoutsRef.current[session.id]?.[tabId] ?? createRuntimeLayout(session.id, tab)
  }

  useEffect(() => {
    const activeSessionIds = new Set(sessions.map((session) => session.id))
    const next: RuntimeLayouts = {}

    Object.entries(terminalLayoutsRef.current).forEach(([sessionId, layouts]) => {
      if (activeSessionIds.has(sessionId)) return
      Object.values(layouts).forEach((layout) => {
        layout.panes.forEach((pane) => disposeRuntimeTerminal(pane.terminalId))
      })
    })

    sessions.forEach((session) => {
      const existing = terminalLayoutsRef.current[session.id] ?? {}
      const validTabIds = new Set(sessionTabs(session).map((tab) => tab.id))
      Object.entries(existing).forEach(([tabId, layout]) => {
        if (!validTabIds.has(tabId)) {
          layout.panes.forEach((pane) => disposeRuntimeTerminal(pane.terminalId))
        }
      })
      next[session.id] = {}
      sessionTabs(session).forEach((tab) => {
        next[session.id]![tab.id] = existing[tab.id] ?? createRuntimeLayout(session.id, tab)
      })
    })

    terminalLayoutsRef.current = next
    setTerminalLayouts(next)
  }, [sessions])

  useEffect(() => {
    const unsubscribe = window.api.pty.onExit((info) => {
      const session = sessionsRef.current.find((candidate) => candidate.id === info.sessionId)
      if (!session) return
      const layouts = terminalLayoutsRef.current[session.id]
      const tabId = Object.entries(layouts ?? {}).find(([, layout]) =>
        layout.panes.some((pane) => pane.terminalId === info.terminalId)
      )?.[0]
      if (!tabId) return
      const layout = layouts?.[tabId]
      if (!layout) return
      const pane = layout.panes.find((candidate) => candidate.terminalId === info.terminalId)
      if (!pane) return

      if (layout.panes.length === 1) {
        setRuntimeLayout(session.id, tabId, {
          ...layout,
          panes: layout.panes.map((candidate) =>
            candidate.terminalId === info.terminalId ? { ...candidate, exited: true } : candidate
          )
        })
        return
      }

      const next = removeTerminalPane(layout, info.terminalId)
      if (!next) return
      disposeRuntimeTerminal(info.terminalId)
      setRuntimeLayout(session.id, tabId, next)
      queueLayoutPersistence(session.id, tabId, next, true)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!pendingTerminalFocus) return
    const selected = sessionsRef.current.find((session) => session.id === pendingTerminalFocus.sessionId)
    if (
      !selected ||
      selectedSessionId !== pendingTerminalFocus.sessionId ||
      activeSessionTab(selected).id !== pendingTerminalFocus.tabId
    ) {
      return
    }

    let frame: number | undefined
    let attempts = 0
    const focus = (): void => {
      const terminal = getSession(pendingTerminalFocus.terminalId)
      if (terminal?.container.isConnected) {
        terminal.term.focus()
        setPendingTerminalFocus(null)
        return
      }
      attempts += 1
      if (attempts < 8) frame = window.requestAnimationFrame(focus)
      else setPendingTerminalFocus(null)
    }
    frame = window.requestAnimationFrame(focus)
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame)
    }
  }, [pendingTerminalFocus, selectedSessionId, sessions])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        !isSessionSwitcherShortcut(event) ||
        sessionSwitcherOpen ||
        newSessionOpen ||
        newProjectOpen ||
        newTodoProjectOpen ||
        todoProjectSettingsOpen ||
        todoTaskDialogOpen
      ) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      setSessionSwitcherOpen(true)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [
    newProjectOpen,
    newSessionOpen,
    newTodoProjectOpen,
    sessionSwitcherOpen,
    todoProjectSettingsOpen,
    todoTaskDialogOpen
  ])

  const selected = sessions.find((session) => session.id === selectedSessionId) ?? null
  const selectedTodoProject =
    todoProjects.find((project) => project.id === selectedTodoProjectId) ?? null
  const selectedTodoTasks = selectedTodoProject
    ? todoTasks.filter((task) => task.todoProjectId === selectedTodoProject.id)
    : []
  const selectedTodoTask =
    todoTasks.find((task) => task.id === todoTaskDialogTaskId) ?? null
  const activeTab = selected ? activeSessionTab(selected) : null
  const gitSession = sessions.find((session) => session.id === gitSessionId) ?? null

  const openNewSession = (projectId?: string): void => {
    setDefaultProjectId(projectId)
    setGitSessionDefaults(null)
    setNewSessionOpen(true)
  }

  const openGitSession = (defaults: GitSessionDefaults): void => {
    setDefaultProjectId(defaults.projectId)
    setGitSessionDefaults(defaults)
    setNewSessionOpen(true)
  }

  const closeNewSession = (open: boolean): void => {
    setNewSessionOpen(open)
    if (!open) setGitSessionDefaults(null)
  }

  const openNewTodoTask = (columnId?: string): void => {
    if (!selectedTodoProject) return
    const defaultColumnId = columnId ?? selectedTodoProject.columns[0]?.id
    if (!defaultColumnId) return
    setTodoTaskDialogTaskId(null)
    setTodoTaskDialogColumnId(defaultColumnId)
    setTodoTaskDialogOpen(true)
  }

  const openTodoTask = (task: TodoTask): void => {
    setTodoTaskDialogTaskId(task.id)
    setTodoTaskDialogColumnId(task.columnId)
    setTodoTaskDialogOpen(true)
  }

  useEffect(() => {
    setTodoTaskDialogOpen(false)
    setTodoTaskDialogTaskId(null)
    setTodoTaskDialogColumnId(null)
  }, [selectedTodoProjectId])

  const cancelTerminalFocus = (): void => {
    terminalFocusRequestId.current += 1
    setPendingTerminalFocus(null)
  }

  const focusTerminal = (sessionId: string, tabId: string, terminalId: string): void => {
    terminalFocusRequestId.current += 1
    selectSession(sessionId)
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId)
    if (session && activeSessionTab(session).id !== tabId) void selectTabAction(sessionId, tabId)
    setPendingTerminalFocus({ sessionId, tabId, terminalId })
  }

  const focusLiveTerminal = (terminal: LiveTerminalDescriptor): void => {
    focusTerminal(terminal.sessionId, terminal.tabId, terminal.terminalId)
  }

  const selectTab = (sessionId: string, tabId: string): void => {
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId)
    if (!session || !sessionTabs(session).some((tab) => tab.id === tabId)) return
    const focusRequestId = ++terminalFocusRequestId.current
    void selectTabAction(sessionId, tabId).then((updated) => {
      if (!updated || terminalFocusRequestId.current !== focusRequestId) return
      const tab = activeSessionTab(updated)
      const pane = tab.layout.panes[0]
      if (pane) {
        setPendingTerminalFocus({
          sessionId,
          tabId: tab.id,
          terminalId: terminalIdForPane(sessionId, tab.id, pane.id)
        })
      }
    })
  }

  const addTab = (sessionId: string): void => {
    const focusRequestId = ++terminalFocusRequestId.current
    void addTabAction(sessionId).then((updated) => {
      if (!updated || terminalFocusRequestId.current !== focusRequestId) return
      const tab = activeSessionTab(updated)
      const pane = tab.layout.panes[0]
      if (pane) {
        setPendingTerminalFocus({
          sessionId,
          tabId: tab.id,
          terminalId: terminalIdForPane(sessionId, tab.id, pane.id)
        })
      }
    })
  }

  const renameTab = (sessionId: string, tabId: string, name: string): void => {
    void renameTabAction(sessionId, tabId, name)
  }

  const renameTerminalPane = (
    sessionId: string,
    tabId: string,
    terminalId: string,
    title: string | null
  ): void => {
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId)
    if (!session) return

    const existing = layoutForTab(session, tabId)
    if (!existing.panes.some((pane) => pane.terminalId === terminalId)) return

    const normalizedTitle = title?.trim()
    const next = {
      ...existing,
      panes: existing.panes.map((pane) => {
        if (pane.terminalId !== terminalId) return pane

        const updatedPane = { ...pane }
        if (normalizedTitle) {
          updatedPane.title = normalizedTitle
        } else {
          delete updatedPane.title
        }
        return updatedPane
      })
    }

    setRuntimeLayout(sessionId, tabId, next)
    queueLayoutPersistence(sessionId, tabId, next, true)
  }

  const closeTab = (sessionId: string, tabId: string): void => {
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId)
    if (!session || sessionTabs(session).length <= 1) return
    const focusRequestId = ++terminalFocusRequestId.current
    void removeTabAction(sessionId, tabId).then((updated) => {
      if (!updated) return
      terminalLayoutsRef.current[sessionId]?.[tabId]?.panes.forEach((pane) => {
        disposeRuntimeTerminal(pane.terminalId)
      })
      if (
        updated.id === selectedSessionId &&
        terminalFocusRequestId.current === focusRequestId
      ) {
        const tab = activeSessionTab(updated)
        const pane = tab.layout.panes[0]
        if (pane) {
          setPendingTerminalFocus({
            sessionId,
            tabId: tab.id,
            terminalId: terminalIdForPane(sessionId, tab.id, pane.id)
          })
        }
      }
    })
  }

  const changeTerminalLayout = (sessionId: string, tabId: string, layout: TerminalLayout): void => {
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId)
    if (!session) return
    const existing = layoutForTab(session, tabId)
    const targetCount = terminalCount(layout)
    if (targetCount <= existing.panes.length) {
      if (targetCount === existing.panes.length) {
        const next = { ...existing, layout, sizes: defaultTerminalLayoutSizes(layout) }
        setRuntimeLayout(sessionId, tabId, next)
        queueLayoutPersistence(sessionId, tabId, next, true)
      }
      return
    }

    const panes = [...existing.panes]
    while (panes.length < targetCount) {
      const paneId = nextPaneId(panes)
      panes.push({
        terminalId: terminalIdForPane(sessionId, tabId, paneId),
        paneId
      })
    }
    const next = { layout, panes, sizes: defaultTerminalLayoutSizes(layout) }
    setRuntimeLayout(sessionId, tabId, next)
    queueLayoutPersistence(sessionId, tabId, next, true)
  }

  const reduceTerminalLayout = (
    sessionId: string,
    tabId: string,
    layout: TerminalLayout,
    paneIds: string[]
  ): void => {
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId)
    if (!session) return
    const existing = layoutForTab(session, tabId)
    paneIds.forEach(disposeRuntimeTerminal)
    const next = {
      layout,
      panes: existing.panes.filter((pane) => !paneIds.includes(pane.terminalId)),
      sizes: defaultTerminalLayoutSizes(layout)
    }
    setRuntimeLayout(sessionId, tabId, next)
    queueLayoutPersistence(sessionId, tabId, next, true)
  }

  const closeTerminalPane = (sessionId: string, tabId: string, terminalId: string): void => {
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId)
    if (!session) return
    const existing = layoutForTab(session, tabId)
    const next = removeTerminalPane(existing, terminalId)
    if (!next) return
    disposeRuntimeTerminal(terminalId)
    setRuntimeLayout(sessionId, tabId, next)
    queueLayoutPersistence(sessionId, tabId, next, true)
  }

  const resizeTerminalLayout = (
    sessionId: string,
    tabId: string,
    axis: TerminalResizeAxis,
    ratio: number,
    columnIndex?: TerminalColumnIndex
  ): void => {
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId)
    if (!session) return
    const existing = layoutForTab(session, tabId)
    const sizes = axis === 'column'
      ? columnIndex === 1
        ? { ...existing.sizes, secondColumnRatio: ratio }
        : { ...existing.sizes, columnRatio: ratio }
      : { ...existing.sizes, rowRatio: ratio }
    const next = { ...existing, sizes }
    setRuntimeLayout(sessionId, tabId, next)
    queueLayoutPersistence(sessionId, tabId, next)
  }

  const reorderTerminalPanes = (sessionId: string, tabId: string, terminalIds: readonly string[]): void => {
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId)
    if (!session) return
    const existing = layoutForTab(session, tabId)
    const panes = orderTerminalPanes(existing.panes, terminalIds)
    if (!panes) return
    const next = { ...existing, panes }
    setRuntimeLayout(sessionId, tabId, next)
    queueLayoutPersistence(sessionId, tabId, next, true)
  }

  const layoutForSession = selected && activeTab
    ? layoutForTab(selected, activeTab.id)
    : undefined
  const terminalLayoutsForSidebar = terminalLayouts

  return (
    <div className="flex h-full w-full overflow-hidden bg-bg">
      <Sidebar
        onNewProject={() => setNewProjectOpen(true)}
        onNewTodoProject={() => setNewTodoProjectOpen(true)}
        onNewTodoTask={() => openNewTodoTask()}
        onNewSession={openNewSession}
        onOpenGit={setGitSessionId}
        terminalLayouts={terminalLayoutsForSidebar}
        onFocusTerminal={focusTerminal}
      />

      <main className="h-full min-w-0 flex-1">
        {!ready ? null : activeWorkspaceView === 'todo' ? (
          <TodoProjectView
            project={selectedTodoProject}
            tasks={selectedTodoTasks}
            terminalCatalog={liveTerminals}
            onNewTask={openNewTodoTask}
            onEditTask={openTodoTask}
            onFocusTerminal={focusLiveTerminal}
            onOpenSettings={() => setTodoProjectSettingsOpen(true)}
          />
        ) : activeWorkspaceView === 'git' ? (
          <GitLaneView onCreateSession={openGitSession} />
        ) : selected && activeTab && layoutForSession ? (
          <TerminalView
            key={selected.id}
            session={selected}
            activeTab={activeTab}
            terminalLayout={layoutForSession}
            onSelectTab={(tabId) => selectTab(selected.id, tabId)}
            onAddTab={() => addTab(selected.id)}
            onTabRenameStart={cancelTerminalFocus}
            onRenameTab={(tabId, name) => renameTab(selected.id, tabId, name)}
            onCloseTab={(tabId) => closeTab(selected.id, tabId)}
            onLayoutChange={(layout) => changeTerminalLayout(selected.id, activeTab.id, layout)}
            onLayoutResize={(axis, ratio, columnIndex) => resizeTerminalLayout(selected.id, activeTab.id, axis, ratio, columnIndex)}
            onPaneOrderChange={(terminalIds) => reorderTerminalPanes(selected.id, activeTab.id, terminalIds)}
            onReduceLayout={(layout, paneIds) => reduceTerminalLayout(selected.id, activeTab.id, layout, paneIds)}
            onClosePane={(terminalId) => closeTerminalPane(selected.id, activeTab.id, terminalId)}
            onPaneTitleChange={(terminalId, title) =>
              renameTerminalPane(selected.id, activeTab.id, terminalId, title)
            }
            onLinkTask={(terminalId) => setTerminalTaskLinkTarget({ type: 'terminal', terminalId })}
          />
        ) : (
          <EmptyState onNewSession={() => openNewSession()} />
        )}
      </main>

      <AddSessionDialog
        open={newSessionOpen}
        onOpenChange={closeNewSession}
        defaultProjectId={defaultProjectId}
        initialValues={gitSessionDefaults ?? undefined}
      />
      <NewProjectDialog open={newProjectOpen} onOpenChange={setNewProjectOpen} />
      <NewTodoProjectDialog
        open={newTodoProjectOpen}
        onOpenChange={setNewTodoProjectOpen}
      />
      {selectedTodoProject && (
        <>
          <TodoProjectSettingsDialog
            project={selectedTodoProject}
            open={todoProjectSettingsOpen}
            onOpenChange={setTodoProjectSettingsOpen}
          />
          <TodoTaskDialog
            project={selectedTodoProject}
            task={selectedTodoTask}
            terminalCatalog={liveTerminals}
            defaultColumnId={
              todoTaskDialogColumnId ?? selectedTodoProject.columns[0]?.id ?? 'todo'
            }
            open={todoTaskDialogOpen}
            onOpenChange={setTodoTaskDialogOpen}
            onManageTerminalLink={(taskId) => setTerminalTaskLinkTarget({ type: 'task', taskId })}
          />
        </>
      )}
      <GitDialog
        open={gitSession !== null}
        session={gitSession}
        onOpenChange={(open) => {
          if (!open) setGitSessionId(null)
        }}
      />
      <SessionSwitcher open={sessionSwitcherOpen} onOpenChange={setSessionSwitcherOpen} />
      <TerminalTaskLinkDialog
        target={terminalTaskLinkTarget}
        terminals={liveTerminals}
        onOpenChange={(open) => {
          if (!open) setTerminalTaskLinkTarget(null)
        }}
      />
    </div>
  )
}
