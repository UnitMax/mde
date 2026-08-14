import { useCallback, useEffect, useRef } from 'react'
import { RotateCw } from 'lucide-react'
import type { Project, PtySize } from '@shared/types'
import { Button } from '@/components/ui/button'
import { useProjects } from '@/store/projects'
import { attachSession, detachSession, fitSession, getSession } from '@/terminal/sessions'

const FALLBACK_SIZE: PtySize = { cols: 80, rows: 24 }
const RESIZE_DEBOUNCE_MS = 100

interface TerminalViewProps {
  project: Project
}

export function TerminalView({ project }: TerminalViewProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const setStatus = useProjects((state) => state.setStatus)
  const clearExit = useProjects((state) => state.clearExit)
  const exit = useProjects((state) => state.exits[project.id])

  const restart = useCallback(async () => {
    const session = getSession(project.id)
    session?.term.reset()
    const size = (session && fitSession(session)) || FALLBACK_SIZE
    clearExit(project.id)
    const status = await window.api.pty.restart({ projectId: project.id, size })
    setStatus(project.id, status)
    session?.term.focus()
  }, [project.id, clearExit, setStatus])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    // Re-parents the existing terminal, or builds it on first view of this project.
    const session = attachSession(project.id, host)
    let cancelled = false

    const frame = requestAnimationFrame(() => {
      const size = fitSession(session) ?? FALLBACK_SIZE
      void window.api.pty.ensure({ projectId: project.id, size }).then((status) => {
        if (cancelled) return
        setStatus(project.id, status)
        session.term.focus()
      })
    })

    let debounce: number | undefined
    const observer = new ResizeObserver(() => {
      window.clearTimeout(debounce)
      // Resizing on every observer callback would flood the PTY with SIGWINCH
      // and leave TUIs redrawing against a stale geometry.
      debounce = window.setTimeout(() => {
        const size = fitSession(session)
        if (size) void window.api.pty.resize({ projectId: project.id, size })
      }, RESIZE_DEBOUNCE_MS)
    })
    observer.observe(host)

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      window.clearTimeout(debounce)
      observer.disconnect()
      // Detach only: the process, its scrollback and its cursor all stay alive.
      detachSession(project.id)
    }
  }, [project.id, setStatus])

  const location =
    project.kind === 'wsl' ? `${project.distro ?? 'WSL'} · ${project.path}` : project.path

  return (
    <div className="flex h-full min-w-0 flex-col bg-bg">
      <header className="flex h-9 shrink-0 items-center gap-3 border-b border-line px-3">
        <span className="shrink-0 text-[13px] font-medium text-fg">{project.name}</span>
        <span className="truncate font-mono text-xs text-fg-subtle" title={location}>
          {location}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto shrink-0"
          onClick={() => void restart()}
          title="Restart the shell for this project"
        >
          <RotateCw className="h-3.5 w-3.5" />
          Restart
        </Button>
      </header>

      {exit && (
        <div className="flex shrink-0 items-center gap-3 border-b border-danger/30 bg-danger/10 px-3 py-1.5">
          <span className="text-xs text-danger">
            Process exited (code {exit.exitCode}
            {exit.signal ? `, signal ${exit.signal}` : ''})
          </span>
          <Button variant="secondary" size="sm" className="ml-auto" onClick={() => void restart()}>
            Restart
          </Button>
        </div>
      )}

      <div ref={hostRef} className="terminal-host relative min-h-0 flex-1 overflow-hidden" />
    </div>
  )
}
