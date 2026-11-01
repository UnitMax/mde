import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowUp, Bot, ChevronDown, Hammer, ListChecks, LoaderCircle, Search, Sparkles, Square } from 'lucide-react'
import type { ChatAgent, ChatModel, OpenCodeModelRef } from '@shared/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { groupModels, modelKey, modelName, orderAgents, sameModelRef } from '@/lib/chat'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { cn } from '@/lib/utils'
import type { OptionsState } from '@/store/inbox-chat'

const MAX_TEXTAREA_HEIGHT = 240

function AgentIcon({ id, className }: { id: string; className?: string }): JSX.Element {
  if (id === 'build') return <Hammer className={className} />
  if (id === 'plan') return <ListChecks className={className} />
  return <Bot className={className} />
}

/** Agent colors are hex values or theme names; only hex is used, everything else falls back. */
function agentColor(agent: ChatAgent | undefined): string | undefined {
  return agent?.color && /^#[0-9a-fA-F]{3,8}$/.test(agent.color) ? agent.color : undefined
}

const pickerButton =
  'flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-fg-muted transition-colors ' +
  'hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-hover data-[state=open]:text-fg'

export function ModelPicker({
  models,
  value,
  onChange,
  disabled,
}: {
  models: ChatModel[]
  value: OpenCodeModelRef | null
  onChange: (model: OpenCodeModelRef) => void
  disabled?: boolean
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const groups = useMemo(() => groupModels(models, query), [models, query])

  return (
    <DropdownMenu open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery('') }}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button type="button" className={pickerButton} aria-label="Model" data-testid="chat-model-picker">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="max-w-[16rem] truncate">{modelName(models, value)}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 p-0">
        <div className="relative border-b border-line p-1.5">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" />
          <input
            autoFocus
            aria-label="Search models"
            placeholder="Search models"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            // Typing must reach the field, not the menu's type-ahead.
            onKeyDown={(event) => {
              if (event.key !== 'Escape' && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') event.stopPropagation()
            }}
            className="h-7 w-full rounded bg-panel pl-7 pr-2 text-xs text-fg outline-none placeholder:text-fg-subtle"
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-1" data-testid="chat-model-list">
          {groups.length === 0 && <p className="px-2 py-1.5 text-xs text-fg-subtle">No models match.</p>}
          {groups.map((group) => (
            <div key={group.providerId} role="group" aria-label={group.providerName}>
              <p className="px-2 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                {group.providerName}
              </p>
              {group.models.map((model) => (
                <DropdownMenuItem
                  key={modelKey(model)}
                  onSelect={() => onChange({ id: model.id, providerId: model.providerId })}
                  className={cn(sameModelRef(value, model) && 'bg-active')}
                  title={modelKey(model)}
                >
                  <span className="min-w-0 truncate">{model.name}</span>
                </DropdownMenuItem>
              ))}
            </div>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AgentPicker({
  agents,
  value,
  onChange,
  disabled,
}: {
  agents: ChatAgent[]
  value: string | null
  onChange: (agent: string) => void
  disabled?: boolean
}): JSX.Element {
  const ordered = useMemo(() => orderAgents(agents), [agents])
  const current = ordered.find((agent) => agent.id === value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button type="button" className={pickerButton} aria-label="Agent" data-testid="chat-agent-picker">
          <AgentIcon id={value ?? ''} className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate" style={{ color: agentColor(current) }}>{current?.name ?? value ?? 'Agent'}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {ordered.map((agent) => (
          <DropdownMenuItem
            key={agent.id}
            onSelect={() => onChange(agent.id)}
            className={cn('items-start', agent.id === value && 'bg-active')}
          >
            <AgentIcon id={agent.id} className="mt-0.5 h-3.5 w-3.5" />
            <span className="min-w-0">
              <span className="block" style={{ color: agentColor(agent) }}>{agent.name}</span>
              {agent.description && (
                <span className="line-clamp-2 block text-[11px] text-fg-muted">{agent.description}</span>
              )}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export interface ChatComposerProps {
  options: OptionsState | undefined
  agent: string | null
  model: OpenCodeModelRef | null
  onAgentChange: (agent: string) => void
  onModelChange: (model: OpenCodeModelRef) => void
  /** Sends the text; a rejection keeps the text and shows the error. */
  onSend: (text: string) => Promise<void>
  /** Shown as a Stop button while the agent is working. */
  running?: boolean
  onStop?: () => void
  onRetryOptions?: () => void
  placeholder?: string
  autoFocus?: boolean
  disabled?: boolean
}

/** The prompt box with model and agent pickers and a round send (or stop) button. */
export function ChatComposer({
  options,
  agent,
  model,
  onAgentChange,
  onModelChange,
  onSend,
  running = false,
  onStop,
  onRetryOptions,
  placeholder = 'Ask for changes or send follow-ups',
  autoFocus = false,
  disabled = false,
}: ChatComposerProps): JSX.Element {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const ready = options?.status === 'ready'
  const canSend = ready && !disabled && !sending && text.trim().length > 0 && Boolean(agent) && Boolean(model)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
  }, [text])

  const send = async (): Promise<void> => {
    if (!canSend) return
    setSending(true)
    setError(null)
    try {
      await onSend(text)
      setText('')
    } catch (reason) {
      setError(ipcErrorMessage(reason, 'Could not send the message.'))
    } finally {
      setSending(false)
      textareaRef.current?.focus()
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void send()
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div
        data-testid="chat-composer"
        className="rounded-2xl border border-line-strong bg-elevated shadow-lg shadow-black/20 focus-within:border-accent/60"
      >
        <textarea
          ref={textareaRef}
          aria-label="Message"
          rows={3}
          autoFocus={autoFocus}
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          className="block max-h-60 min-h-[4.5rem] w-full resize-none bg-transparent px-4 pt-3 text-[14px] leading-relaxed text-fg outline-none placeholder:text-fg-subtle"
        />
        <div className="flex min-w-0 items-center gap-1 px-2 pb-2">
          {options?.status === 'ready' ? (
            <>
              <ModelPicker models={options.value.models} value={model} onChange={onModelChange} disabled={disabled} />
              <span aria-hidden className="h-4 w-px bg-line-strong" />
              <AgentPicker agents={options.value.agents} value={agent} onChange={onAgentChange} disabled={disabled} />
            </>
          ) : options?.status === 'error' ? (
            <span className="flex min-w-0 items-center gap-2 px-2 text-[12px] text-danger">
              <span className="min-w-0 truncate" title={options.error}>{options.error}</span>
              {onRetryOptions && (
                <button type="button" className="shrink-0 text-accent hover:underline" onClick={onRetryOptions}>
                  Retry
                </button>
              )}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-2 text-[12px] text-fg-subtle">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              Connecting to OpenCode…
            </span>
          )}
          <span className="flex-1" />
          {running && onStop && !text.trim() ? (
            <button
              type="button"
              aria-label="Stop"
              title="Stop"
              onClick={onStop}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-fg text-bg transition-opacity hover:opacity-90"
            >
              <Square className="h-3 w-3 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              aria-label="Send"
              title="Send (Enter)"
              disabled={!canSend}
              onClick={() => void send()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-35"
            >
              {sending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>
      {error && <p role="alert" className="px-2 text-xs text-danger">{error}</p>}
    </div>
  )
}
