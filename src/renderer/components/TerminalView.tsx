import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CircleX,
  LoaderCircle,
  Redo2,
  RefreshCw,
  RotateCw,
  Search,
  Type,
  Undo2
} from 'lucide-react'
import type {
  OpenCodeChatItem,
  OpenCodeContextUsage,
  OpenCodeGenerationState,
  OpenCodeLiveChatItem,
  OpenCodeLivePermissionMessage,
  OpenCodeLiveReasoningMessage,
  OpenCodeLiveToolMessage,
  OpenCodeModelOption,
  OpenCodeModelSelection,
  OpenCodePermissionReply,
  OpenCodeReasoningMessage,
  OpenCodeSlashCommand,
  OpenCodeSubagent,
  OpenCodeToolMessage,
  PtySize,
  Session
} from '@shared/types'
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
import { MarkdownMessage } from '@/components/MarkdownMessage'
import {
  contextUsageMatchesModel,
  contextUsageTone,
  formatContextUsage
} from '@/components/context-usage'
import { GUI_SLASH_COMMANDS, resolveSlashCommand, slashCommandDraft } from '@/components/slash-commands'
import { describeBuiltInTool } from '@/components/tool-summary'
import { formatMetricDuration, formatMetricRate } from '@shared/generation-metrics'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useWorkspace } from '@/store/workspace'
import {
  applyTerminalFontSettings,
  attachSession,
  detachSession,
  fitSession,
  getSession
} from '@/terminal/sessions'
import {
  getTerminalFontSettings,
  listTerminalFonts,
  saveTerminalFontSettings,
  TERMINAL_FONT_SIZES,
  type TerminalFontSettings
} from '@/terminal/font-settings'

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

function TerminalFontControl({ sessionId }: { sessionId: string }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState<TerminalFontSettings>(() => getTerminalFontSettings())
  const [availableFonts] = useState(() => listTerminalFonts())

  const updateSettings = (patch: Partial<TerminalFontSettings>): void => {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveTerminalFontSettings(next)
    applyTerminalFontSettings(next)

    const session = getSession(sessionId)
    const size = session ? fitSession(session) : null
    if (size) void window.api.pty.resize({ sessionId, size })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        aria-label="Change terminal font"
        data-testid="terminal-font-control"
        title="Change terminal font"
        onClick={() => setOpen(true)}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded px-2 text-xs text-fg-subtle hover:bg-hover hover:text-fg"
      >
        <Type className="h-3.5 w-3.5" />
        Font
      </button>

      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Terminal font</DialogTitle>
          <DialogDescription>Changes apply immediately to all terminal sessions and are saved for later.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label className="block text-xs font-medium text-fg-muted">
            Font family
            <Select value={settings.family} onValueChange={(family) => updateSettings({ family })}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableFonts.map((font) => (
                  <SelectItem key={font.family} value={font.family}>
                    {font.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="block text-xs font-medium text-fg-muted">
            Font size
            <Select
              value={String(settings.size)}
              onValueChange={(value) => {
                const size = TERMINAL_FONT_SIZES.find((candidate) => String(candidate) === value)
                if (size !== undefined) updateSettings({ size })
              }}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TERMINAL_FONT_SIZES.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}px
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
      </DialogContent>
    </Dialog>
  )
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
  const summary = describeBuiltInTool(message)

  return (
    <li
      aria-live={live ? 'polite' : undefined}
      className="max-w-[90%] rounded border border-line bg-panel px-3 py-2 text-fg-muted"
    >
      <details open={live ? true : undefined}>
        <summary className="cursor-pointer select-none text-xs">
          <span className="font-medium text-fg" title={summary}>{summary}</span>
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
      className="max-w-[80%] select-text rounded border border-line bg-panel px-3 py-2 text-fg-muted"
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

function RollbackAction({
  mode,
  disabled,
  busy,
  onConfirm
}: {
  mode: 'undo' | 'redo'
  disabled: boolean
  busy: boolean
  onConfirm: () => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const undo = mode === 'undo'
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-fg-subtle hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40"
      >
        {undo ? <Undo2 className="h-3 w-3" /> : <Redo2 className="h-3 w-3" />}
        {busy ? (undo ? 'Undoing…' : 'Redoing…') : undo ? 'Undo' : 'Redo'}
      </button>
      <AlertDialogContent>
        <AlertDialogTitle>{undo ? 'Undo the latest OpenCode turn?' : 'Redo the reverted OpenCode turn?'}</AlertDialogTitle>
        <AlertDialogDescription>
          {undo
            ? 'This removes the latest prompt and its responses from the visible conversation and restores files changed during that turn.'
            : 'This restores the reverted prompt, responses, and file changes to the project.'}
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={undo ? undefined : 'bg-accent text-accent-fg hover:bg-accent-hover'}
            onClick={onConfirm}
          >
            {undo ? 'Undo turn' : 'Redo turn'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function latestCompletedTurnId(messages: OpenCodeChatItem[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || message.role !== 'user' || message.id.startsWith('user-')) continue
    if (messages.slice(index + 1).some((item) => item.role === 'assistant')) return message.id
  }
  return null
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

function ContextUsage({
  usage,
  selectedModel
}: {
  usage: OpenCodeContextUsage | null
  selectedModel: OpenCodeModelSelection | null
}): JSX.Element {
  const current = contextUsageMatchesModel(usage, selectedModel) ? usage : null
  const tone = current ? contextUsageTone(current.percentage) : 'normal'
  const toneClass =
    tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warn' : 'text-fg-subtle'
  const label = formatContextUsage(current)
  const title = current
    ? `Context: ${current.usedTokens.toLocaleString()} of ${current.contextWindow.toLocaleString()} tokens (${current.percentage.toFixed(1)}%)`
    : 'Context usage will appear after OpenCode reports token metadata for this model.'

  return (
    <span
      aria-label={title}
      title={title}
      className={`shrink-0 whitespace-nowrap rounded px-1.5 py-1 text-[10px] ${toneClass}`}
    >
      {label}
    </span>
  )
}

function generationPhaseLabel(phase: NonNullable<OpenCodeGenerationState['live']>['phase']): string {
  if (phase === 'thinking') return 'Thinking'
  if (phase === 'tool') return 'Tool call'
  if (phase === 'response') return 'Responding'
  return 'OpenCode'
}

function GenerationMetrics({
  generation,
  pending
}: {
  generation: OpenCodeGenerationState | null
  pending: boolean
}): JSX.Element | null {
  const [now, setNow] = useState(() => Date.now())
  const live = generation?.live ?? null

  useEffect(() => {
    if (!live) return
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [Boolean(live)])

  if (pending && live) {
    const firstTokenElapsed = live.firstTokenAt ? now - live.firstTokenAt : null
    const rate =
      firstTokenElapsed !== null && firstTokenElapsed > 0
        ? live.estimatedTokens / (firstTokenElapsed / 1000)
        : null
    const stale = live.lastTokenAt !== null && now - live.lastTokenAt > 1_000
    const waiting = live.toolWaiting || stale
    const label =
      live.firstTokenAt === null
        ? `Waiting · TTFT ${formatMetricDuration(now - live.startedAt)}`
        : waiting
          ? `${generationPhaseLabel(live.phase)} · Waiting`
          : `${generationPhaseLabel(live.phase)} · ~${formatMetricRate(rate)} tok/s`
    const title =
      live.firstTokenAt === null
        ? 'Waiting for the first generated token.'
        : `Estimated live rate: ${formatMetricRate(rate)} tokens per second.`

    return (
      <span
        aria-label={title}
        title={title}
        className="shrink-0 whitespace-nowrap rounded px-1.5 py-1 text-[10px] text-fg-subtle"
      >
        {label}
      </span>
    )
  }

  const final = generation?.final
  if (!final) return null
  const label = `TTFT ${formatMetricDuration(final.timeToFirstTokenMs)} · ${formatMetricRate(final.tokensPerSecond)} tok/s`
  const title = `${final.totalTokens.toLocaleString()} generated tokens (${final.outputTokens.toLocaleString()} output + ${final.reasoningTokens.toLocaleString()} reasoning) over ${formatMetricDuration(final.durationMs)}.`
  return (
    <span
      aria-label={title}
      title={title}
      className="shrink-0 whitespace-nowrap rounded px-1.5 py-1 text-[10px] text-fg-subtle"
    >
      {label}
    </span>
  )
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

function formatSubagentDuration(subagent: OpenCodeSubagent, now: number): string {
  const end = subagent.finishedAt ?? now
  const seconds = Math.max(0, Math.round((end - subagent.startedAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function SubagentActivityPanel({ subagents }: { subagents: OpenCodeSubagent[] }): JSX.Element | null {
  const [collapsed, setCollapsed] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const hasActive = subagents.some((subagent) => subagent.status === 'working' || subagent.status === 'waiting')

  useEffect(() => {
    if (!hasActive) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [hasActive])

  if (subagents.length === 0) return null

  const byId = new Map(subagents.map((subagent) => [subagent.id, subagent]))
  const depth = (subagent: OpenCodeSubagent): number => {
    let current = subagent
    let value = 0
    const seen = new Set<string>()
    while (current.parentSubagentId && !seen.has(current.parentSubagentId)) {
      seen.add(current.parentSubagentId)
      const parent = byId.get(current.parentSubagentId)
      if (!parent) break
      value += 1
      current = parent
    }
    return Math.min(value, 3)
  }

  const statusIcon = (status: OpenCodeSubagent['status']): JSX.Element => {
    if (status === 'working') return <LoaderCircle className="h-3.5 w-3.5 animate-spin text-accent" />
    if (status === 'waiting') return <CircleAlert className="h-3.5 w-3.5 text-accent" />
    if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 text-ok" />
    return <CircleX className="h-3.5 w-3.5 text-danger" />
  }

  const statusLabel = (status: OpenCodeSubagent['status']): string => {
    if (status === 'working') return 'Working'
    if (status === 'waiting') return 'Waiting for permission'
    if (status === 'completed') return 'Completed'
    if (status === 'cancelled') return 'Cancelled'
    return 'Failed'
  }

  return (
    <section className="mx-auto mb-2 w-full max-w-4xl rounded-lg border border-line bg-bg/70">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-fg-muted hover:bg-hover hover:text-fg"
      >
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${collapsed ? '' : 'rotate-90'}`} />
        <span className="font-medium text-fg">Subagents</span>
        <span className="text-fg-subtle">{subagents.length}</span>
        {hasActive && <span className="ml-auto text-accent">Active</span>}
      </button>
      {!collapsed && (
        <ul className="space-y-1 border-t border-line px-3 py-2">
          {subagents.map((subagent) => (
            <li
              key={subagent.id}
              className="flex min-w-0 items-center gap-2 text-xs text-fg-muted"
              style={{ paddingLeft: `${depth(subagent) * 16}px` }}
            >
              <span className="shrink-0">{statusIcon(subagent.status)}</span>
              <span className="min-w-0 flex-1 truncate" title={subagent.description}>
                {subagent.agent ? `@${subagent.agent} · ` : ''}
                {subagent.description}
              </span>
              <span className="shrink-0 text-[10px] text-fg-subtle">
                {statusLabel(subagent.status)} · {formatSubagentDuration(subagent, now)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function GuiView({ session }: { session: Session }): JSX.Element {
  const [draft, setDraft] = useState('')
  const [slashError, setSlashError] = useState<string | null>(null)
  const chat = useWorkspace((state) => state.opencodeChats[session.id])
  const sendOpenCodeMessage = useWorkspace((state) => state.sendOpenCodeMessage)
  const executeOpenCodeCommand = useWorkspace((state) => state.executeOpenCodeCommand)
  const loadOpenCodeModels = useWorkspace((state) => state.loadOpenCodeModels)
  const selectOpenCodeModel = useWorkspace((state) => state.selectOpenCodeModel)
  const loadOpenCodeSessions = useWorkspace((state) => state.loadOpenCodeSessions)
  const selectOpenCodeSession = useWorkspace((state) => state.selectOpenCodeSession)
  const createOpenCodeSession = useWorkspace((state) => state.createOpenCodeSession)
  const replyOpenCodePermission = useWorkspace((state) => state.replyOpenCodePermission)
  const undoOpenCodeLastTurn = useWorkspace((state) => state.undoOpenCodeLastTurn)
  const redoOpenCodeLastTurn = useWorkspace((state) => state.redoOpenCodeLastTurn)
  const nativeSession = session.kind === 'native'
  const pending = chat?.pending ?? false
  const compacting = chat?.compacting ?? false
  const error = chat?.error ?? null
  const messages = chat?.messages ?? []
  const liveItems = chat?.liveItems ?? []
  const subagents = chat?.subagents ?? []
  const availableSessions = chat?.availableSessions ?? []
  const openCodeSessionId = chat?.openCodeSessionId ?? null
  const sessionsLoading = chat?.sessionsLoading ?? false
  const modelsLoading = chat?.modelsLoading ?? false
  const availableModels = chat?.availableModels ?? []
  const selectedModel = chat?.selectedModel ?? null
  const contextUsage = chat?.contextUsage ?? null
  const generation = chat?.generation ?? null
  const revert = chat?.revert ?? null
  const undoSupported = chat?.undoSupported ?? false
  const undoing = chat?.undoing ?? false
  const redoing = chat?.redoing ?? false
  const externalBusy = chat?.externalBusy ?? false
  const latestTurnId = latestCompletedTurnId(messages)
  const assistantLabel = selectedModel ? modelLabel(selectedModel, availableModels) : 'OpenCode'
  const logRef = useRef<HTMLOListElement>(null)
  const slashDraft = slashCommandDraft(draft)
  const slashQuery = slashDraft && !slashDraft.hasArguments ? slashDraft.token.toLowerCase() : null
  const slashSuggestions =
    slashQuery === null
      ? []
      : GUI_SLASH_COMMANDS.filter(
          (candidate) =>
            candidate.command.includes(slashQuery) || candidate.aliases.some((alias) => alias.includes(slashQuery))
        )
  const draftRef = useRef<HTMLTextAreaElement>(null)
  const slashSuggestionRefs = useRef<Array<HTMLButtonElement | null>>([])

  const focusSlashSuggestion = (index: number): void => {
    const count = slashSuggestions.length
    if (count === 0) return
    const normalized = (index + count) % count
    slashSuggestionRefs.current[normalized]?.focus()
  }

  const completeSlashCommand = (command: OpenCodeSlashCommand): void => {
    setDraft(`/${command}`)
    setSlashError(null)
    window.requestAnimationFrame(() => draftRef.current?.focus())
  }

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
    if (!nativeSession || pending || externalBusy || !draft.trim()) return
    const message = draft
    setDraft('')
    const slashCommand = resolveSlashCommand(message)
    if (slashCommand?.error) {
      setSlashError(slashCommand.error)
      setDraft(message)
      return
    }
    setSlashError(null)
    if (slashCommand?.command) {
      void executeOpenCodeCommand(session.id, slashCommand.command)
      return
    }
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
        {revert && (
          <li className="mx-auto flex w-full max-w-4xl items-center justify-between rounded border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-fg-muted">
            <span>This turn is undone. A new prompt will commit the rollback.</span>
            <RollbackAction
              mode="redo"
              disabled={!undoSupported || pending || externalBusy}
              busy={redoing}
              onConfirm={() => void redoOpenCodeLastTurn(session.id)}
            />
          </li>
        )}
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
                  ? 'ml-auto max-w-[80%] select-text rounded bg-active px-3 py-2 text-fg'
                  : 'max-w-[80%] select-text rounded border border-line bg-panel px-3 py-2 text-fg-muted'
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
              {message.role === 'user' && message.id === latestTurnId && !revert && (
                <div className="mt-2 flex items-center gap-2 border-t border-white/5 pt-1">
                  {undoSupported ? (
                    <RollbackAction
                      mode="undo"
                      disabled={pending || externalBusy || undoing || redoing}
                      busy={undoing}
                      onConfirm={() => void undoOpenCodeLastTurn(session.id)}
                    />
                  ) : (
                    <span className="text-[10px] text-fg-subtle">
                      Undo unavailable — OpenCode snapshots require a Git repository.
                    </span>
                  )}
                </div>
              )}
            </li>
          )
        )}
        {liveItems.map((item) => (
          <LiveItemView
            key={item.id}
            item={item}
            onPermissionReply={replyPermission}
            assistantLabel={assistantLabel}
          />
        ))}
        {externalBusy && !pending && liveItems.length === 0 && (
          <li className="max-w-[80%] rounded border border-line bg-panel px-3 py-2 text-xs text-fg-subtle">
            OpenCode is busy in another client…
          </li>
        )}
        {compacting && (
          <li
            aria-live="polite"
            className="max-w-[80%] rounded border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-fg-subtle"
          >
            Compacting context…
          </li>
        )}
        {pending && !compacting && liveItems.length === 0 && (
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
        {slashError && (
          <p role="alert" className="mb-2 text-xs text-danger">
            {slashError}
          </p>
        )}
        <SubagentActivityPanel subagents={subagents} />
        <div className="mx-auto w-full max-w-4xl rounded-xl border border-line-strong bg-bg shadow-lg shadow-black/10 transition-colors focus-within:border-accent/70">
          <textarea
            ref={draftRef}
            aria-label="Message"
            rows={2}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
              setSlashError(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Tab' && slashSuggestions.length > 0) {
                event.preventDefault()
                focusSlashSuggestion(0)
                return
              }
              if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey) {
                event.preventDefault()
                send()
              }
            }}
            placeholder="Message OpenCode..."
            disabled={
              !nativeSession || pending || externalBusy || sessionsLoading || modelsLoading || !selectedModel
            }
            className="block min-h-[68px] max-h-48 w-full resize-none overflow-y-auto rounded-t-xl border-0 bg-transparent px-4 pb-2 pt-3 text-[13px] text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-50"
          />

          {slashSuggestions.length > 0 && !pending && !externalBusy && (
            <div className="border-t border-line px-2 py-1.5" role="listbox" aria-label="Slash commands">
              {slashSuggestions.map((candidate, index) => (
                <button
                  type="button"
                  key={candidate.command}
                  role="option"
                  ref={(element) => {
                    slashSuggestionRefs.current[index] = element
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Tab') {
                      event.preventDefault()
                      focusSlashSuggestion(event.shiftKey ? index - 1 : index + 1)
                    } else if (event.key === 'ArrowDown') {
                      event.preventDefault()
                      focusSlashSuggestion(index + 1)
                    } else if (event.key === 'ArrowUp') {
                      event.preventDefault()
                      focusSlashSuggestion(index - 1)
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      draftRef.current?.focus()
                    }
                  }}
                  className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-hover hover:text-fg"
                  onClick={() => {
                    completeSlashCommand(candidate.command)
                  }}
                >
                  <span className="font-medium">/{candidate.command}</span>
                  <span className="text-[10px] text-fg-subtle">{candidate.description}</span>
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <div className="flex min-w-0 items-center gap-1">
              <Select
                value={openCodeSessionId ?? NEW_CONVERSATION_VALUE}
                onValueChange={selectConversation}
                disabled={!nativeSession || pending || externalBusy || sessionsLoading}
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
                disabled={!nativeSession || pending || externalBusy || sessionsLoading}
                onClick={() => void loadOpenCodeSessions(session.id)}
              >
                <RefreshCw className={sessionsLoading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
              </Button>
              <ModelPicker
                models={availableModels}
                selected={selectedModel}
                loading={modelsLoading}
                disabled={!nativeSession || pending || externalBusy || sessionsLoading || modelsLoading}
                onSelect={(model) => void selectOpenCodeModel(session.id, model)}
                onRefresh={() => void loadOpenCodeModels(session.id)}
              />
              <ContextUsage usage={contextUsage} selectedModel={selectedModel} />
              <GenerationMetrics generation={generation} pending={pending} />
            </div>

            <Button
              size="icon"
              aria-label="Send message"
              title="Send message"
              className="h-8 w-8 shrink-0 rounded-lg"
              disabled={
                !nativeSession ||
                pending ||
                externalBusy ||
                sessionsLoading ||
                modelsLoading ||
                !selectedModel ||
                !draft.trim()
              }
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

        {viewMode === 'terminal' && <TerminalFontControl sessionId={selectedSession.id} />}

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
