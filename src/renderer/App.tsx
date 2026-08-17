import { useEffect, useRef, useState } from 'react'
import { Plus, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AddSessionDialog } from '@/components/AddProjectDialog'
import { AboutDialog } from '@/components/AboutDialog'
import { NewProjectDialog } from '@/components/NewProjectDialog'
import { Sidebar } from '@/components/Sidebar'
import { SessionSwitcher } from '@/components/SessionSwitcher'
import { TerminalView } from '@/components/TerminalView'
import { isSessionSwitcherShortcut } from '@/lib/session-switcher'
import { useWorkspace } from '@/store/workspace'
import { disposeSession } from '@/terminal/sessions'
import {
  createSessionTerminalLayout,
  defaultTerminalLayoutSizes,
  layoutForCount,
  terminalCount,
  type SessionTerminalLayout,
  type TerminalLayout,
  type TerminalResizeAxis
} from '@/terminal/layout'

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
  const selectedSessionId = useWorkspace((state) => state.selectedSessionId)
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [sessionSwitcherOpen, setSessionSwitcherOpen] = useState(false)
  const [defaultProjectId, setDefaultProjectId] = useState<string | undefined>(undefined)
  const [terminalLayouts, setTerminalLayouts] = useState<Record<string, SessionTerminalLayout>>({})
  const terminalIdCounter = useRef(0)
  const terminalLayoutsRef = useRef(terminalLayouts)

  useEffect(() => {
    terminalLayoutsRef.current = terminalLayouts
  }, [terminalLayouts])

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        !isSessionSwitcherShortcut(event) ||
        sessionSwitcherOpen ||
        newSessionOpen ||
        newProjectOpen ||
        aboutOpen
      ) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      setSessionSwitcherOpen(true)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [aboutOpen, newProjectOpen, newSessionOpen, sessionSwitcherOpen])

  useEffect(() => {
    const unsubscribe = window.api.pty.onExit((info) => {
      const layout = terminalLayoutsRef.current[info.sessionId]
      const pane = layout?.panes.find((candidate) => candidate.terminalId === info.terminalId)
      if (!layout || !pane) return

      if (layout.panes.length === 1) {
        setTerminalLayouts((current) => {
          const existing = current[info.sessionId]
          if (!existing) return current
          return {
            ...current,
            [info.sessionId]: {
              ...existing,
              layout: 'single',
              panes: existing.panes.map((candidate) =>
                candidate.terminalId === info.terminalId ? { ...candidate, exited: true } : candidate
              )
            }
          }
        })
        return
      }

      disposeSession(info.terminalId)
      void window.api.pty.dispose(info.terminalId)
      setTerminalLayouts((current) => {
        const existing = current[info.sessionId]
        if (!existing) return current
        const panes = existing.panes.filter((candidate) => candidate.terminalId !== info.terminalId)
        return {
          ...current,
          [info.sessionId]: {
            layout: layoutForCount(panes.length),
            panes,
            sizes: defaultTerminalLayoutSizes()
          }
        }
      })
    })
    return unsubscribe
  }, [])

  const selected = sessions.find((session) => session.id === selectedSessionId) ?? null

  const openNewSession = (projectId?: string): void => {
    setDefaultProjectId(projectId)
    setNewSessionOpen(true)
  }

  const disposeRuntimeTerminal = (terminalId: string): void => {
    disposeSession(terminalId)
    void window.api.pty.dispose(terminalId)
  }

  useEffect(() => {
    const activeSessionIds = new Set(sessions.map((session) => session.id))
    const removedLayouts = Object.entries(terminalLayoutsRef.current).filter(
      ([sessionId]) => !activeSessionIds.has(sessionId)
    )
    if (removedLayouts.length === 0) return

    removedLayouts.forEach(([, layout]) => {
      layout.panes.forEach((pane) => disposeRuntimeTerminal(pane.terminalId))
    })
    setTerminalLayouts((current) => {
      const next = { ...current }
      removedLayouts.forEach(([sessionId]) => delete next[sessionId])
      return next
    })
  }, [sessions])

  const changeTerminalLayout = (sessionId: string, layout: TerminalLayout): void => {
    setTerminalLayouts((current) => {
      const existing = current[sessionId] ?? createSessionTerminalLayout(sessionId)
      const targetCount = terminalCount(layout)
      if (targetCount <= existing.panes.length) {
        if (targetCount === existing.panes.length) {
          return {
            ...current,
            [sessionId]: { ...existing, layout, sizes: defaultTerminalLayoutSizes() }
          }
        }
        return current
      }

      const panes = [...existing.panes]
      while (panes.length < targetCount) {
        terminalIdCounter.current += 1
        panes.push({
          terminalId: `${sessionId}:split:${terminalIdCounter.current}`,
          primary: false
        })
      }
      return {
        ...current,
        [sessionId]: { layout, panes, sizes: defaultTerminalLayoutSizes() }
      }
    })
  }

  const reduceTerminalLayout = (
    sessionId: string,
    layout: TerminalLayout,
    paneIds: string[]
  ): void => {
    paneIds.forEach(disposeRuntimeTerminal)
    setTerminalLayouts((current) => {
      const existing = current[sessionId] ?? createSessionTerminalLayout(sessionId)
      const panes = existing.panes.filter((pane) => !paneIds.includes(pane.terminalId))
      return {
        ...current,
        [sessionId]: { layout, panes, sizes: defaultTerminalLayoutSizes() }
      }
    })
  }

  const closeTerminalPane = (sessionId: string, terminalId: string): void => {
    const existing = terminalLayoutsRef.current[sessionId]
    if (!existing) return
    const pane = existing.panes.find((candidate) => candidate.terminalId === terminalId)
    if (!pane || pane.primary || existing.panes.length <= 1) return
    disposeRuntimeTerminal(terminalId)
    setTerminalLayouts((current) => {
      const layout = current[sessionId]
      if (!layout) return current
      const panes = layout.panes.filter((candidate) => candidate.terminalId !== terminalId)
      return {
        ...current,
        [sessionId]: {
          layout: layoutForCount(panes.length),
          panes,
          sizes: defaultTerminalLayoutSizes()
        }
      }
    })
  }

  const resizeTerminalLayout = (
    sessionId: string,
    axis: TerminalResizeAxis,
    ratio: number
  ): void => {
    setTerminalLayouts((current) => {
      const existing = current[sessionId]
      if (!existing) return current
      const sizes = axis === 'column'
        ? { ...existing.sizes, columnRatio: ratio }
        : { ...existing.sizes, rowRatio: ratio }
      return { ...current, [sessionId]: { ...existing, sizes } }
    })
  }

  const restartPrimary = (sessionId: string): void => {
    const existing = terminalLayoutsRef.current[sessionId] ?? createSessionTerminalLayout(sessionId)
    const primary = existing.panes.find((pane) => pane.primary)
    if (primary) {
      setTerminalLayouts((current) => {
        const layout = current[sessionId] ?? existing
        return {
          ...current,
          [sessionId]: {
            ...layout,
            panes: layout.panes.map((pane) =>
              pane.primary ? { ...pane, exited: false } : pane
            )
          }
        }
      })
      return
    }

    const removable = [...existing.panes].reverse().find((pane) => !pane.primary)
    if (existing.panes.length >= 4 && removable) disposeRuntimeTerminal(removable.terminalId)
    const panes = existing.panes.filter((pane) => pane.terminalId !== removable?.terminalId)
    panes.push({ terminalId: sessionId, primary: true })
    setTerminalLayouts((current) => ({
      ...current,
      [sessionId]: {
        layout: layoutForCount(panes.length),
        panes,
        sizes: defaultTerminalLayoutSizes()
      }
    }))
  }

  const layoutForSession = selected
    ? terminalLayouts[selected.id] ?? createSessionTerminalLayout(selected.id)
    : undefined

  return (
    <div className="flex h-full w-full overflow-hidden bg-bg">
      <Sidebar
        onNewProject={() => setNewProjectOpen(true)}
        onNewSession={openNewSession}
        onAbout={() => setAboutOpen(true)}
      />

      <main className="h-full min-w-0 flex-1">
        {!ready ? null : selected ? (
          // Keyed so switching sessions mounts a fresh view; the xterm instance
          // behind it is kept alive by the session registry, not by React.
          <TerminalView
            key={selected.id}
            session={selected}
            terminalLayout={layoutForSession!}
            onLayoutChange={(layout) => changeTerminalLayout(selected.id, layout)}
            onLayoutResize={(axis, ratio) => resizeTerminalLayout(selected.id, axis, ratio)}
            onReduceLayout={(layout, paneIds) => reduceTerminalLayout(selected.id, layout, paneIds)}
            onClosePane={(terminalId) => closeTerminalPane(selected.id, terminalId)}
            onRestartPrimary={() => restartPrimary(selected.id)}
          />
        ) : (
          <EmptyState onNewSession={() => openNewSession()} />
        )}
      </main>

      <AddSessionDialog
        open={newSessionOpen}
        onOpenChange={setNewSessionOpen}
        defaultProjectId={defaultProjectId}
      />
      <NewProjectDialog open={newProjectOpen} onOpenChange={setNewProjectOpen} />
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
      <SessionSwitcher open={sessionSwitcherOpen} onOpenChange={setSessionSwitcherOpen} />
    </div>
  )
}
