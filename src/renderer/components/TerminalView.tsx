import { useCallback, useEffect, useRef, useState } from 'react'
import { RotateCw } from 'lucide-react'
import type { OpenCodeToolMessage, PtySize, Session } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useWorkspace } from '@/store/workspace'
import { attachSession, detachSession, fitSession, getSession } from '@/terminal/sessions'

const FALLBACK_SIZE: PtySize = { cols: 80, rows: 24 }
const RESIZE_DEBOUNCE_MS = 100

interface TerminalViewProps {
  session: Session
  viewMode: SessionViewMode
  onViewModeChange: (mode: SessionViewMode) => void
}

export type SessionViewMode = 'terminal' | 'gui'

interface TerminalSurfaceProps {
  session: Session
}

function TerminalSurface({ session: selectedSession }: TerminalSurfaceProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const setStatus = useWorkspace((state) => state.setStatus)

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

  return <div ref={hostRef} className="terminal-host relative min-h-0 flex-1 overflow-hidden" />
}

function formatToolInput(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input, null, 2) ?? '{}'
  } catch {
    return '{}'
  }
}

function ToolMessageView({ message }: { message: OpenCodeToolMessage }): JSX.Element {
  const statusClass = message.status === 'error' ? 'text-danger' : 'text-fg-subtle'

  return (
    <li className="max-w-[90%] rounded border border-line bg-panel px-3 py-2 text-fg-muted">
      <details>
        <summary className="cursor-pointer select-none text-xs">
          <span className="font-medium text-fg">{message.tool}</span>
          <span className={`ml-2 ${statusClass}`}>{message.status}</span>
        </summary>
        <div className="mt-2 space-y-2 border-t border-line pt-2 text-xs">
          {message.title && <p className="text-fg-subtle">{message.title}</p>}
          <div>
            <p className="mb-1 font-medium text-fg-subtle">Input</p>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-bg p-2 text-[11px] text-fg-muted">
              {formatToolInput(message.input)}
            </pre>
          </div>
          {message.output && (
            <div>
              <p className="mb-1 font-medium text-fg-subtle">Output</p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-bg p-2 text-[11px] text-fg-muted">
                {message.output}
              </pre>
            </div>
          )}
          {message.error && <p className="whitespace-pre-wrap text-danger">{message.error}</p>}
        </div>
      </details>
    </li>
  )
}

function GuiView({ session }: { session: Session }): JSX.Element {
  const [draft, setDraft] = useState('')
  const chat = useWorkspace((state) => state.opencodeChats[session.id])
  const sendOpenCodeMessage = useWorkspace((state) => state.sendOpenCodeMessage)
  const nativeSession = session.kind === 'native'
  const pending = chat?.pending ?? false
  const error = chat?.error ?? null
  const messages = chat?.messages ?? []

  const send = (): void => {
    if (!nativeSession || pending || !draft.trim()) return
    const message = draft
    setDraft('')
    void sendOpenCodeMessage(session.id, message)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <ol className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" aria-label="OpenCode conversation">
        {messages.map((message) =>
          message.role === 'tool' ? (
            <ToolMessageView key={message.id} message={message} />
          ) : (
            <li
              key={message.id}
              className={
                message.role === 'user'
                  ? 'ml-auto max-w-[80%] rounded bg-active px-3 py-2 text-fg'
                  : 'max-w-[80%] rounded border border-line bg-panel px-3 py-2 text-fg-muted'
              }
            >
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                {message.role === 'user' ? 'You' : 'Big Pickle'}
              </p>
              <p className="whitespace-pre-wrap text-[13px]">{message.text}</p>
            </li>
          )
        )}
        {pending && (
          <li className="max-w-[80%] rounded border border-line bg-panel px-3 py-2 text-xs text-fg-subtle">
            Big Pickle is responding…
          </li>
        )}
      </ol>

      <div className="shrink-0 border-t border-line bg-panel p-3">
        {!nativeSession && (
          <p role="alert" className="mb-2 text-xs text-warn">
            OpenCode GUI integration currently supports native sessions only.
          </p>
        )}
        {error && (
          <p role="alert" className="mb-2 text-xs text-danger">
            {error}
          </p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            aria-label="Message"
            rows={3}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                send()
              }
            }}
            placeholder="Type a message..."
            disabled={!nativeSession || pending}
            className="min-h-[72px] min-w-0 flex-1 resize-none rounded border border-line-strong bg-bg px-2.5 py-2 text-[13px] text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />

          <Select value="opencode/big-pickle" disabled>
            <SelectTrigger aria-label="Model" className="w-48 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="opencode/big-pickle">Big Pickle · OpenCode Zen</SelectItem>
            </SelectContent>
          </Select>

          <Button
            size="sm"
            className="shrink-0"
            disabled={!nativeSession || pending || !draft.trim()}
            onClick={send}
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}

export function TerminalView({
  session: selectedSession,
  viewMode,
  onViewModeChange
}: TerminalViewProps): JSX.Element {
  const clearExit = useWorkspace((state) => state.clearExit)
  const setStatus = useWorkspace((state) => state.setStatus)
  const exit = useWorkspace((state) => state.exits[selectedSession.id])

  const restart = useCallback(async () => {
    const session = getSession(selectedSession.id)
    session?.term.reset()
    const size = (session && fitSession(session)) || FALLBACK_SIZE
    clearExit(selectedSession.id)
    const status = await window.api.pty.restart({ sessionId: selectedSession.id, size })
    setStatus(selectedSession.id, status)
    if (viewMode === 'terminal') session?.term.focus()
  }, [selectedSession.id, clearExit, setStatus, viewMode])

  const location =
    selectedSession.kind === 'wsl'
      ? `${selectedSession.distro ?? 'WSL'} · ${selectedSession.path}`
      : selectedSession.path

  return (
    <div className="flex h-full min-w-0 flex-col bg-bg">
      <header className="flex h-9 shrink-0 items-center gap-3 border-b border-line px-3">
        <span className="shrink-0 text-[13px] font-medium text-fg">{selectedSession.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-subtle" title={location}>
          {location}
        </span>

        <div
          aria-label="Session view"
          role="tablist"
          className="flex shrink-0 items-center gap-0.5 rounded border border-line bg-panel p-0.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'terminal'}
            data-testid="session-tab-terminal"
            onClick={() => onViewModeChange('terminal')}
            className={
              viewMode === 'terminal'
                ? 'rounded-sm bg-active px-2 py-0.5 text-xs text-fg'
                : 'rounded-sm px-2 py-0.5 text-xs text-fg-subtle hover:bg-hover hover:text-fg'
            }
          >
            Terminal
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'gui'}
            data-testid="session-tab-gui"
            onClick={() => onViewModeChange('gui')}
            className={
              viewMode === 'gui'
                ? 'rounded-sm bg-active px-2 py-0.5 text-xs text-fg'
                : 'rounded-sm px-2 py-0.5 text-xs text-fg-subtle hover:bg-hover hover:text-fg'
            }
          >
            GUI
          </button>
        </div>

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

      {viewMode === 'terminal' ? (
        <TerminalSurface session={selectedSession} />
      ) : (
        <GuiView session={selectedSession} />
      )}
    </div>
  )
}
