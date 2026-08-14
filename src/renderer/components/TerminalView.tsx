import { useCallback, useEffect, useRef } from 'react'
import { RotateCw } from 'lucide-react'
import type { PtySize, Session } from '@shared/types'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/store/workspace'
import { attachSession, detachSession, fitSession, getSession } from '@/terminal/sessions'

const FALLBACK_SIZE: PtySize = { cols: 80, rows: 24 }
const RESIZE_DEBOUNCE_MS = 100

interface TerminalViewProps {
  session: Session
}

export function TerminalView({ session: selectedSession }: TerminalViewProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const setStatus = useWorkspace((state) => state.setStatus)
  const clearExit = useWorkspace((state) => state.clearExit)
  const exit = useWorkspace((state) => state.exits[selectedSession.id])

  const restart = useCallback(async () => {
    const session = getSession(selectedSession.id)
    session?.term.reset()
    const size = (session && fitSession(session)) || FALLBACK_SIZE
    clearExit(selectedSession.id)
    const status = await window.api.pty.restart({ sessionId: selectedSession.id, size })
    setStatus(selectedSession.id, status)
    session?.term.focus()
  }, [selectedSession.id, clearExit, setStatus])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    // Re-parents the existing terminal, or builds it on first view of this session.
    const session = attachSession(selectedSession.id, host)
    let cancelled = false

    const frame = requestAnimationFrame(() => {
      const size = fitSession(session) ?? FALLBACK_SIZE
      void window.api.pty.ensure({ sessionId: selectedSession.id, size }).then((status) => {
        if (cancelled) return
        setStatus(selectedSession.id, status)
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
        if (size) void window.api.pty.resize({ sessionId: selectedSession.id, size })
      }, RESIZE_DEBOUNCE_MS)
    })
    observer.observe(host)

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      window.clearTimeout(debounce)
      observer.disconnect()
      // Detach only: the process, its scrollback and its cursor all stay alive.
      detachSession(selectedSession.id)
    }
  }, [selectedSession.id, setStatus])

  const location =
    selectedSession.kind === 'wsl'
      ? `${selectedSession.distro ?? 'WSL'} · ${selectedSession.path}`
      : selectedSession.path

  return (
    <div className="flex h-full min-w-0 flex-col bg-bg">
      <header className="flex h-9 shrink-0 items-center gap-3 border-b border-line px-3">
        <span className="shrink-0 text-[13px] font-medium text-fg">{selectedSession.name}</span>
        <span className="truncate font-mono text-xs text-fg-subtle" title={location}>
          {location}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto shrink-0"
          onClick={() => void restart()}
          title="Restart the shell for this session"
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
