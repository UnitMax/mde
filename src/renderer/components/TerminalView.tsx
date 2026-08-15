import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, ChevronRight, RefreshCw, RotateCw, Search } from 'lucide-react'
import type {
  OpenCodeLiveChatItem,
  OpenCodeLivePermissionMessage,
  OpenCodeLiveReasoningMessage,
  OpenCodeLiveToolMessage,
  OpenCodeModelOption,
  OpenCodeModelSelection,
  OpenCodePermissionReply,
  OpenCodeReasoningMessage,
  OpenCodeToolMessage,
  PtySize,
  Session
} from '@shared/types'
import { Button } from '@/components/ui/button'
import { MarkdownMessage } from '@/components/MarkdownMessage'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useWorkspace } from '@/store/workspace'
import { attachSession, detachSession, fitSession, getSession } from '@/terminal/sessions'

const FALLBACK_SIZE: PtySize = { cols: 80, rows: 24 }
const RESIZE_DEBOUNCE_MS = 100
const NEW_CONVERSATION_VALUE = '__new-opencode-conversation__'

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

function ToolMessageView({
  message,
  live = false
}: {
  message: OpenCodeToolMessage | OpenCodeLiveToolMessage
  live?: boolean
}): JSX.Element {
  const statusClass = message.status === 'error' ? 'text-danger' : 'text-fg-subtle'

  return (
    <li
      aria-live={live ? 'polite' : undefined}
      className="max-w-[90%] rounded border border-line bg-panel px-3 py-2 text-fg-muted"
    >
      <details open={live ? true : undefined}>
        <summary className="cursor-pointer select-none text-xs">
          <span className="font-medium text-fg">{message.tool}</span>
          <span className={`ml-2 ${statusClass}`}>{message.status}</span>
        </summary>
        <div className="mt-2 space-y-2 border-t border-line pt-2 text-xs">
          {message.title && <p className="text-fg-subtle">{message.title}</p>}
          <div>
            <p className="mb-1 font-medium text-fg-subtle">Input</p>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-bg p-2 text-[11px] text-fg-muted">
              {'rawInput' in message && message.rawInput && Object.keys(message.input).length === 0
                ? message.rawInput
                : formatToolInput(message.input)}
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

function formatThinkingDuration(durationMs: number): string {
  const seconds = durationMs / 1000
  if (seconds < 10) return `${Math.round(seconds * 10) / 10}s`
  if (seconds < 60) return `${Math.round(seconds)}s`
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

function formatConversationDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function ReasoningMessageView({
  message,
  live = false
}: {
  message: OpenCodeReasoningMessage | OpenCodeLiveReasoningMessage
  live?: boolean
}): JSX.Element {
  return (
    <li aria-live={live ? 'polite' : undefined} className="max-w-[90%] text-fg-subtle">
      <details className="group" open={live ? true : undefined}>
        <summary className="inline-flex cursor-pointer select-none items-center gap-1 text-xs text-fg-subtle hover:text-fg-muted">
          <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
          <span>
            {message.durationMs === undefined
              ? 'Thinking'
              : `Thought for ${formatThinkingDuration(message.durationMs)}`}
          </span>
        </summary>
        <MarkdownMessage
          text={message.text}
          className="ml-4 mt-1.5 border-l border-line pl-3 text-[12px] italic text-fg-subtle"
        />
      </details>
    </li>
  )
}

function LiveTextMessageView({ text, assistantLabel }: { text: string; assistantLabel: string }): JSX.Element {
  return (
    <li
      aria-live="polite"
      className="max-w-[80%] rounded border border-line bg-panel px-3 py-2 text-fg-muted"
    >
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">{assistantLabel}</p>
      <MarkdownMessage text={text} streaming />
    </li>
  )
}

function PermissionMessageView({
  message,
  onReply
}: {
  message: OpenCodeLivePermissionMessage
  onReply: (reply: OpenCodePermissionReply) => void
}): JSX.Element {
  return (
    <li
      aria-live="polite"
      className="max-w-[90%] rounded border border-warn/40 bg-panel px-3 py-2 text-fg-muted"
    >
      <p className="text-xs font-medium text-fg">Permission requested</p>
      <p className="mt-1 text-xs text-fg-subtle">
        OpenCode needs permission for <span className="font-medium text-fg">{message.permission}</span>.
      </p>
      {message.title && <p className="mt-1 text-xs text-fg-subtle">{message.title}</p>}
      {message.patterns.length > 0 && (
        <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-bg p-2 text-[11px] text-fg-muted">
          {message.patterns.join('\n')}
        </pre>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" disabled={message.responding} onClick={() => onReply('once')}>
          Once
        </Button>
        <Button size="sm" variant="secondary" disabled={message.responding} onClick={() => onReply('always')}>
          Always
        </Button>
        <Button size="sm" variant="danger" disabled={message.responding} onClick={() => onReply('reject')}>
          Reject
        </Button>
      </div>
    </li>
  )
}

function LiveItemView({
  item,
  onPermissionReply,
  assistantLabel
}: {
  item: OpenCodeLiveChatItem
  onPermissionReply: (requestId: string, reply: OpenCodePermissionReply) => void
  assistantLabel: string
}): JSX.Element {
  if (item.role === 'tool') return <ToolMessageView message={item} live />
  if (item.role === 'reasoning') return <ReasoningMessageView message={item} live />
  if (item.role === 'permission') {
    return <PermissionMessageView message={item} onReply={(reply) => onPermissionReply(item.id, reply)} />
  }
  return <LiveTextMessageView text={item.text} assistantLabel={assistantLabel} />
}

function modelLabel(model: OpenCodeModelSelection | null, models: OpenCodeModelOption[]): string {
  if (!model) return 'Select a model'
  const option = models.find(
    (candidate) =>
      candidate.providerID === model.providerID &&
      candidate.modelID === model.modelID &&
      candidate.variant === model.variant
  )
  if (option) return `${option.modelName} · ${option.providerName}`
  return `${model.modelID} · ${model.providerID}`
}

function ModelPicker({
  models,
  selected,
  loading,
  disabled,
  onSelect,
  onRefresh
}: {
  models: OpenCodeModelOption[]
  selected: OpenCodeModelSelection | null
  loading: boolean
  disabled: boolean
  onSelect: (model: OpenCodeModelSelection) => void
  onRefresh: () => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const filtered = models.filter((model) =>
    `${model.providerName} ${model.providerID} ${model.modelName} ${model.modelID} ${model.variant ?? ''}`
      .toLowerCase()
      .includes(normalizedQuery)
  )
  const grouped = filtered.reduce<Record<string, OpenCodeModelOption[]>>((groups, model) => {
    const group = groups[model.providerName] ?? []
    group.push(model)
    groups[model.providerName] = group
    return groups
  }, {})

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) setQuery('')
      }}
    >
      <button
        type="button"
        aria-label="Model"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="flex h-7 max-w-[260px] min-w-0 items-center gap-1 rounded px-2 text-xs text-fg-muted hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40"
      >
        <span className="truncate">{loading ? 'Loading models…' : modelLabel(selected, models)}</span>
        <span className="text-fg-subtle">⌄</span>
      </button>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Select an OpenCode model</DialogTitle>
          <DialogDescription>Choose the model used for future prompts in this conversation.</DialogDescription>
        </DialogHeader>
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-fg-subtle" />
          <Input
            autoFocus
            aria-label="Search models"
            placeholder="Search providers and models"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-8"
          />
        </div>
        <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
          {loading && <p className="py-6 text-center text-xs text-fg-subtle">Loading models…</p>}
          {!loading && filtered.length === 0 && (
            <p className="py-6 text-center text-xs text-fg-subtle">
              {models.length === 0 ? 'No models were returned by OpenCode.' : 'No matching models.'}
            </p>
          )}
          {!loading &&
            Object.entries(grouped).map(([provider, providerModels]) => (
              <section key={provider}>
                <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
                  {provider}
                </p>
                <div className="space-y-0.5">
                  {providerModels.map((model) => {
                    const isSelected =
                      selected?.providerID === model.providerID &&
                      selected.modelID === model.modelID &&
                      selected.variant === model.variant
                    return (
                      <button
                        type="button"
                        key={model.key}
                        className="flex w-full items-center justify-between rounded px-2 py-2 text-left text-xs text-fg hover:bg-hover"
                        onClick={() => {
                          onSelect(model)
                          setOpen(false)
                        }}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-fg">{model.modelName}</span>
                          <span className="block truncate text-[10px] text-fg-subtle">{model.modelID}</span>
                        </span>
                        {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
                      </button>
                    )
                  })}
                </div>
              </section>
            ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" size="sm" disabled={loading} onClick={onRefresh}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh models
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function GuiView({ session }: { session: Session }): JSX.Element {
  const [draft, setDraft] = useState('')
  const chat = useWorkspace((state) => state.opencodeChats[session.id])
  const sendOpenCodeMessage = useWorkspace((state) => state.sendOpenCodeMessage)
  const loadOpenCodeModels = useWorkspace((state) => state.loadOpenCodeModels)
  const selectOpenCodeModel = useWorkspace((state) => state.selectOpenCodeModel)
  const loadOpenCodeSessions = useWorkspace((state) => state.loadOpenCodeSessions)
  const selectOpenCodeSession = useWorkspace((state) => state.selectOpenCodeSession)
  const createOpenCodeSession = useWorkspace((state) => state.createOpenCodeSession)
  const replyOpenCodePermission = useWorkspace((state) => state.replyOpenCodePermission)
  const nativeSession = session.kind === 'native'
  const pending = chat?.pending ?? false
  const error = chat?.error ?? null
  const messages = chat?.messages ?? []
  const liveItems = chat?.liveItems ?? []
  const availableSessions = chat?.availableSessions ?? []
  const openCodeSessionId = chat?.openCodeSessionId ?? null
  const sessionsLoading = chat?.sessionsLoading ?? false
  const modelsLoading = chat?.modelsLoading ?? false
  const availableModels = chat?.availableModels ?? []
  const selectedModel = chat?.selectedModel ?? null
  const assistantLabel = selectedModel ? modelLabel(selectedModel, availableModels) : 'OpenCode'
  const logRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    if (nativeSession) {
      void loadOpenCodeModels(session.id)
      void loadOpenCodeSessions(session.id)
    }
  }, [loadOpenCodeModels, loadOpenCodeSessions, nativeSession, session.id])

  useEffect(() => {
    const log = logRef.current
    if (!log) return
    // Streaming appends below the fold; keep the newest text in view.
    log.scrollTop = log.scrollHeight
  }, [messages, liveItems, pending])

  const send = (): void => {
    if (!nativeSession || pending || !draft.trim()) return
    const message = draft
    setDraft('')
    void sendOpenCodeMessage(session.id, message)
  }

  const replyPermission = (requestId: string, reply: OpenCodePermissionReply): void => {
    void replyOpenCodePermission(session.id, requestId, reply)
  }

  const selectConversation = (value: string): void => {
    if (value === NEW_CONVERSATION_VALUE) {
      void createOpenCodeSession(session.id)
      return
    }
    void selectOpenCodeSession(session.id, value)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <ol
        ref={logRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3"
        aria-label="OpenCode conversation"
      >
        {messages.map((message) =>
          message.role === 'tool' ? (
            <ToolMessageView key={message.id} message={message} />
          ) : message.role === 'reasoning' ? (
            <ReasoningMessageView key={message.id} message={message} />
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
                {message.role === 'user' ? 'You' : assistantLabel}
              </p>
              {message.role === 'assistant' ? (
                <MarkdownMessage text={message.text} />
              ) : (
                <p className="whitespace-pre-wrap text-[13px]">{message.text}</p>
              )}
            </li>
          )
        )}
        {pending &&
          liveItems.map((item) => (
            <LiveItemView
              key={item.id}
              item={item}
              onPermissionReply={replyPermission}
              assistantLabel={assistantLabel}
            />
          ))}
        {pending && liveItems.length === 0 && (
            <li className="max-w-[80%] rounded border border-line bg-panel px-3 py-2 text-xs text-fg-subtle">
            OpenCode is responding…
          </li>
        )}
        {!pending && sessionsLoading && messages.length === 0 && (
          <li className="max-w-[80%] rounded border border-line bg-panel px-3 py-2 text-xs text-fg-subtle">
            Loading OpenCode conversations…
          </li>
        )}
      </ol>

      <div className="shrink-0 border-t border-line bg-panel px-3 py-3">
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
        <div className="mx-auto w-full max-w-4xl rounded-xl border border-line-strong bg-bg shadow-lg shadow-black/10 transition-colors focus-within:border-accent/70">
          <textarea
            aria-label="Message"
            rows={2}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                send()
              }
            }}
            placeholder="Message OpenCode..."
            disabled={!nativeSession || pending || sessionsLoading || modelsLoading || !selectedModel}
            className="block min-h-[68px] max-h-48 w-full resize-none overflow-y-auto rounded-t-xl border-0 bg-transparent px-4 pb-2 pt-3 text-[13px] text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-50"
          />

          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <div className="flex min-w-0 items-center gap-1">
              <Select
                value={openCodeSessionId ?? NEW_CONVERSATION_VALUE}
                onValueChange={selectConversation}
                disabled={!nativeSession || pending || sessionsLoading}
              >
                <SelectTrigger
                  aria-label="OpenCode conversation"
                  className="h-7 w-[220px] min-w-0 border-0 bg-transparent px-2 text-xs text-fg-muted shadow-none hover:bg-hover hover:text-fg"
                >
                  <SelectValue placeholder="New conversation" />
                </SelectTrigger>
                <SelectContent>
                  {availableSessions.map((conversation) => (
                    <SelectItem key={conversation.id} value={conversation.id}>
                      <span className="flex max-w-[260px] items-center gap-2">
                        <span className="truncate">{conversation.title}</span>
                        <span className="shrink-0 text-[10px] text-fg-subtle">
                          {formatConversationDate(conversation.updatedAt)}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW_CONVERSATION_VALUE}>New conversation</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Refresh OpenCode conversations"
                title="Refresh OpenCode conversations"
                disabled={!nativeSession || pending || sessionsLoading}
                onClick={() => void loadOpenCodeSessions(session.id)}
              >
                <RefreshCw className={sessionsLoading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
              </Button>
              <ModelPicker
                models={availableModels}
                selected={selectedModel}
                loading={modelsLoading}
                disabled={!nativeSession || pending || sessionsLoading || !openCodeSessionId}
                onSelect={(model) => void selectOpenCodeModel(session.id, model)}
                onRefresh={() => void loadOpenCodeModels(session.id)}
              />
            </div>

            <Button
              size="icon"
              aria-label="Send message"
              title="Send message"
              className="h-8 w-8 shrink-0 rounded-lg"
              disabled={!nativeSession || pending || sessionsLoading || modelsLoading || !selectedModel || !draft.trim()}
              onClick={send}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          </div>
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
