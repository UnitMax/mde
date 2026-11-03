import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Paperclip, X, File as FileIcon, ArrowUp, Bot, ChevronDown, Hammer, ListChecks, LoaderCircle, Search, Sparkles, Square } from 'lucide-react'
import { readFileTreeDrop, isFileDrop } from '@/terminal/drop'
import type { ChatDraft, ChatDraftKey, ChatDraftRequest, ChatAgent, ChatModel, ChatSkill, OpenCodeModelRef } from '@shared/types'
import { skillTriggerAt } from '@shared/skills'
import { applySkill, filterSkills } from '@/lib/skills'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ContextMeter } from '@/components/inbox/ContextMeter'
import { findModel, groupModels, modelKey, modelName, orderAgents, sameModelRef, type ContextUsage } from '@/lib/chat'
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
  const current = findModel(models, value)

  return (
    <DropdownMenu open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery('') }}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button type="button" className={pickerButton} aria-label="Model" data-testid="chat-model-picker">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="max-w-[16rem] truncate" title={value ? modelKey(value) : undefined}>
            {value && <span className="text-fg-subtle">{current?.providerName ?? value.providerId} / </span>}
            {modelName(models, value)}
          </span>
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

const NO_SKILLS: ChatSkill[] = []

/**
 * The skills that fit what is being typed after a `$`, as a list above the box. It never takes focus
 * (the caret stays in the text), so the box handles the keys and tells the list which row is active.
 */
function SkillPicker({
  id,
  skills,
  active,
  onActive,
  onPick,
}: {
  id: string
  skills: ChatSkill[]
  active: number
  onActive: (index: number) => void
  onPick: (skill: ChatSkill) => void
}): JSX.Element {
  useEffect(() => {
    document.getElementById(`${id}-${active}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [id, active])
  return (
    <div
      id={id}
      role="listbox"
      aria-label="Skills"
      data-testid="skill-picker"
      className="absolute inset-x-0 bottom-full z-30 mb-1.5 max-h-64 overflow-y-auto rounded-xl border border-line-strong bg-elevated p-1 shadow-lg shadow-black/30"
    >
      {skills.map((skill, index) => (
        <div
          key={skill.id}
          id={`${id}-${index}`}
          role="option"
          aria-selected={index === active}
          data-testid={`skill-option-${skill.id}`}
          // Keeps the caret in the text: a click on the list must not move focus out of the box.
          onMouseDown={(event) => event.preventDefault()}
          onMouseMove={() => { if (index !== active) onActive(index) }}
          onClick={() => onPick(skill)}
          className={cn('flex min-w-0 cursor-pointer items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-[13px]', index === active ? 'bg-active' : 'hover:bg-hover')}
        >
          <span className="shrink-0 font-medium text-fg">${skill.id}</span>
          {skill.description && <span className="min-w-0 truncate text-[12px] text-fg-muted">{skill.description}</span>}
        </div>
      ))}
    </div>
  )
}

export interface ChatComposerProps {
  draftKey?: ChatDraftKey
  /**
   * Set when text was added to the draft from outside: the box reads the draft again, takes focus and
   * puts the caret at `caret`. It is applied whenever it is seen, including when the box appears
   * after it was set, and `onDraftReloaded` then lets go of it.
   */
  draftReload?: { id: number; caret: number }
  onDraftReloaded?: (id: number) => void
  options: OptionsState | undefined
  agent: string | null
  model: OpenCodeModelRef | null
  onAgentChange: (agent: string) => void
  onModelChange: (model: OpenCodeModelRef) => void
  /** Sends the text; a rejection keeps the text and shows the error. */
  onSend: (text: string, attachments?: { attachmentIds: string[]; draftRevision: number }) => Promise<void>
  /** Shown as a Stop button while the agent is working. */
  running?: boolean
  onStop?: () => void
  onRetryOptions?: () => void
  /** How full the model's context window is; the pill is left out when there is nothing to show. */
  context?: ContextUsage | null
  placeholder?: string
  autoFocus?: boolean
  disabled?: boolean
  /** True while something outside the box makes sending impossible (the Git bar's branch name is invalid). */
  sendBlocked?: boolean
  /** Shown directly under the box, above any error; the new-thread page puts its Git bar here. */
  footer?: ReactNode
}

/** The prompt box with model and agent pickers and a round send (or stop) button. */
export function ChatComposer({
  draftKey,
  draftReload,
  onDraftReloaded,
  options,
  agent,
  model,
  onAgentChange,
  onModelChange,
  onSend,
  running = false,
  onStop,
  onRetryOptions,
  context = null,
  placeholder = 'Ask for changes or send follow-ups',
  autoFocus = false,
  disabled = false,
  sendBlocked = false,
  footer,
}: ChatComposerProps): JSX.Element {
  const [text, setText] = useState('')
  const [draft, setDraft] = useState<ChatDraft>({ text: '', revision: 0, attachments: [] })
  const [loaded, setLoaded] = useState(!draftKey)
  const [adding, setAdding] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const currentKey = useRef(draftKey)
  currentKey.current = draftKey
  const mutate = (request: ChatDraftRequest): Promise<ChatDraft> => {
    return window.api.chat.draft(request)
  }
  useEffect(() => {
    setLoaded(!draftKey)
    setText('')
    setDraft({ text: '', revision: 0, attachments: [] })
    setError(null)
    if (!draftKey) return
    void mutate({ key: draftKey, action: 'load' }).then((value) => {
      if (currentKey.current !== draftKey) return
      setDraft(value)
      setText(value.text)
      setLoaded(true)
    }).catch((reason) => setError(ipcErrorMessage(reason, 'Could not restore the draft.')))
  }, [draftKey])
  const addFiles = async (files: File[], notice?: string): Promise<void> => {
    if (!draftKey || disabled || !loaded || sending || adding) return
    setAdding(true)
    setError(null)
    const errors: string[] = notice ? [notice] : []
    for (const file of files) {
      try {
        if (file.size > 20 * 1024 * 1024) throw new Error('File exceeds 20 MiB.')
        const value = await mutate({ key: draftKey, action: 'add', name: file.name || 'Clipboard image.png', mime: file.type || 'application/octet-stream', data: new Uint8Array(await file.arrayBuffer()) })
        if (currentKey.current === draftKey) setDraft(value)
      } catch (reason) { errors.push(`${file.name}: ${ipcErrorMessage(reason, 'Could not add file.')}`) }
    }
    setAdding(false)
    if (errors.length) setError(errors.join(' '))
  }
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const appliedReload = useRef(0)
  useEffect(() => {
    // Once it is let go of the next one may start counting again.
    if (!draftReload) appliedReload.current = 0
    if (!draftKey || !draftReload || draftReload.id === appliedReload.current) return
    appliedReload.current = draftReload.id
    onDraftReloaded?.(draftReload.id)
    void mutate({ key: draftKey, action: 'load' }).then((value) => {
      if (currentKey.current !== draftKey) return
      setDraft(value)
      setText(value.text)
      // The added text is at the top; the caret goes to its end, ready for changes.
      setFocusAt(Math.min(draftReload.caret, value.text.length))
    }).catch((reason) => setError(ipcErrorMessage(reason, 'Could not restore the draft.')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftReload, draftKey])
  // Asked for focus and a caret position. The box is switched off until the draft has loaded, and a
  // box that is off cannot take focus, so this waits for the render that switches it on.
  const [focusAt, setFocusAt] = useState<number | null>(null)
  useEffect(() => {
    if (focusAt === null || !loaded) return
    const textarea = textareaRef.current
    if (!textarea || textarea.disabled) return
    textarea.focus()
    const caret = Math.min(focusAt, textarea.value.length)
    textarea.setSelectionRange(caret, caret)
    setFocusAt(null)
  }, [focusAt, loaded, disabled, sending, text])
  const ready = options?.status === 'ready'
  const canSend = ready && !disabled && !sendBlocked && !sending && !adding && loaded && (text.trim().length > 0 || draft.attachments.length > 0) && Boolean(agent) && Boolean(model)

  // Skills: a `$word` at the caret offers the skills that fit it. Where the caret is only counts for
  // the text it was measured in, so text put there from outside (a loaded draft) never opens the list.
  const listId = useId()
  const skills = options?.status === 'ready' ? options.value.skills : NO_SKILLS
  const [cursor, setCursor] = useState<{ text: string; at: number } | null>(null)
  const [activeSkill, setActiveSkill] = useState(0)
  // The `$` of a list the user closed with Escape; it stays closed until that word is gone.
  const [dismissed, setDismissed] = useState<number | null>(null)
  const trigger = useMemo(
    () => (skills.length > 0 && cursor?.text === text ? skillTriggerAt(text, cursor.at) : null),
    [skills, cursor, text],
  )
  useEffect(() => { if (!trigger) setDismissed(null) }, [trigger])
  const matches = useMemo(() => (trigger ? filterSkills(skills, trigger.query) : NO_SKILLS), [skills, trigger])
  const pickerOpen = Boolean(trigger) && matches.length > 0 && trigger?.start !== dismissed && !disabled && !sending && loaded
  const activeIndex = Math.min(activeSkill, Math.max(matches.length - 1, 0))

  const persist = (next: string): void => {
    if (draftKey) void mutate({ key: draftKey, action: 'text', text: next }).catch((reason) => setError(ipcErrorMessage(reason, 'Could not save the draft.')))
  }
  // Where the caret goes once the chosen skill is in the box. This is a ref applied right after the
  // text lands, not the `focusAt` state above: that is cleared by a later render, and a key pressed
  // before then is drawn with the old value still set, which put the caret back where it had been.
  const pendingCaret = useRef<number | null>(null)
  useLayoutEffect(() => {
    const at = pendingCaret.current
    if (at === null) return
    pendingCaret.current = null
    const textarea = textareaRef.current
    if (!textarea || textarea.disabled) return
    textarea.focus()
    const caret = Math.min(at, textarea.value.length)
    textarea.setSelectionRange(caret, caret)
  })
  const pickSkill = (skill: ChatSkill): void => {
    if (!trigger) return
    const next = applySkill(text, trigger, skill)
    pendingCaret.current = next.caret
    setText(next.text)
    persist(next.text)
    // A new object each time, so the box renders and puts the caret in place even when the text is unchanged.
    setCursor({ text: next.text, at: next.caret })
  }

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
      let value: ChatDraft | undefined
      if (draftKey) {
        value = await mutate({ key: draftKey, action: 'text', text })
      }
      await onSend(text, value ? { attachmentIds: value.attachments.map((file) => file.id), draftRevision: value.revision } : undefined)
      setText('')
      setDraft({ text: '', revision: 0, attachments: [] })
    } catch (reason) {
      setError(ipcErrorMessage(reason, 'Could not send the message.'))
    } finally {
      setSending(false)
      textareaRef.current?.focus()
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // The open list gets the keys first, so Enter chooses the skill instead of sending half a message.
    if (pickerOpen && trigger && !event.nativeEvent.isComposing) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveSkill((activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length)
        return
      }
      if ((event.key === 'Enter' && !event.shiftKey) || (event.key === 'Tab' && !event.shiftKey)) {
        event.preventDefault()
        const skill = matches[activeIndex]
        if (skill) pickSkill(skill)
        return
      }
      if (event.key === 'Escape') {
        // Closing the list is all Escape does here; it must not also close whatever else Escape closes.
        event.preventDefault()
        event.stopPropagation()
        setDismissed(trigger.start)
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void send()
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div
        data-testid="chat-composer"
        onDragOver={(event) => { if (isFileDrop(event.dataTransfer)) { event.preventDefault(); setDragging(true) } }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false) }}
        onDrop={(event) => {
          if (!isFileDrop(event.dataTransfer)) return
          event.preventDefault()
          setDragging(false)
          if (!draftKey || sending || adding || !loaded) return
          const entry = readFileTreeDrop(event.dataTransfer)
          if (entry) {
            setAdding(true)
            void mutate({ key: draftKey, action: 'tree', ...entry }).then(setDraft).catch((reason) => setError(ipcErrorMessage(reason, 'Could not add file.'))).finally(() => setAdding(false))
          } else {
            const items = Array.from(event.dataTransfer.items)
            const files = items.length ? items.filter((item) => !item.webkitGetAsEntry?.()?.isDirectory).flatMap((item) => { const file = item.getAsFile(); return file ? [file] : [] }) : Array.from(event.dataTransfer.files)
            const notice = items.some((item) => item.webkitGetAsEntry?.()?.isDirectory)
              ? 'Folders cannot be attached. Choose individual files.' : undefined
            if (files.length) void addFiles(files, notice)
            else if (notice) setError(notice)
          }
        }}
        style={dragging ? { outline: '2px solid var(--color-accent)' } : undefined}
        className="@container relative rounded-2xl border border-line-strong bg-elevated shadow-lg shadow-black/20 focus-within:border-accent/60"
      >
        {pickerOpen && <SkillPicker id={listId} skills={matches} active={activeIndex} onActive={setActiveSkill} onPick={pickSkill} />}
        <input ref={inputRef} type="file" multiple hidden aria-label="Choose attachments" onChange={(event) => { void addFiles(Array.from(event.target.files ?? [])); event.target.value = '' }} />
        {draft.attachments.length > 0 && <div className="flex flex-wrap gap-2 px-4 pt-3" aria-label="Attachments">
          {draft.attachments.map((file) => <div key={file.id} className="relative flex max-w-48 items-center gap-2 rounded-lg border border-line p-2 text-xs" title={`${file.name} (${file.size.toLocaleString()} bytes)`}>
            {file.thumbnail ? <img src={file.thumbnail} alt={file.name} className="h-16 w-20 rounded object-contain" /> : <FileIcon className="h-5 w-5 shrink-0" />}
            <span className="truncate">{file.name}<span className="block text-fg-subtle">{Math.ceil(file.size / 1024)} KB</span></span>
            <button type="button" disabled={sending || adding} aria-label={`Remove ${file.name}`} onClick={() => { if (draftKey) void mutate({ key: draftKey, action: 'remove', attachmentId: file.id }).then(setDraft).catch((reason) => setError(ipcErrorMessage(reason, 'Could not remove file.'))) }}><X className="h-3.5 w-3.5" /></button>
          </div>)}
        </div>}
        {adding && <p role="status" className="px-4 pt-2 text-xs text-fg-muted">Adding attachments…</p>}
        <textarea
          ref={textareaRef}
          aria-label="Message"
          rows={3}
          autoFocus={autoFocus}
          value={text}
          disabled={disabled || sending || !loaded}
          placeholder={placeholder}
          onChange={(event) => {
            const next = event.target.value
            setText(next)
            setCursor({ text: next, at: event.target.selectionStart === event.target.selectionEnd ? event.target.selectionStart : -1 })
            setActiveSkill(0)
            persist(next)
          }}
          // Moving the caret with the keys or the mouse changes which word it is in.
          onSelect={(event) => {
            const box = event.currentTarget
            setCursor({ text: box.value, at: box.selectionStart === box.selectionEnd ? box.selectionStart : -1 })
          }}
          aria-controls={pickerOpen ? listId : undefined}
          aria-activedescendant={pickerOpen ? `${listId}-${activeIndex}` : undefined}
          onPaste={(event) => {
            const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'))
            if (images.length) { event.preventDefault(); void addFiles(images) }
          }}
          onKeyDown={onKeyDown}
          className="block max-h-60 min-h-[4.5rem] w-full resize-none bg-transparent px-4 pt-3 text-[14px] leading-relaxed text-fg outline-none placeholder:text-fg-subtle"
        />
        <div className="flex min-w-0 items-center gap-1 px-2 pb-2">
          {draftKey && <button type="button" aria-label="Attach files" title="Attach files" disabled={disabled || sending || adding || !loaded} className={pickerButton} onClick={() => inputRef.current?.click()}><Paperclip className="h-4 w-4" /></button>}
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
          {context && <ContextMeter usage={context} running={running} />}
          {running && onStop && !text.trim() && draft.attachments.length === 0 ? (
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
      {footer}
      {error && <p role="alert" className="px-2 text-xs text-danger">
        {error}
        {!loaded && draftKey && <button type="button" className="ml-2 text-accent hover:underline" onClick={() => {
          void mutate({ key: draftKey, action: 'load' }).then((value) => {
            setDraft(value)
            setText(value.text)
            setLoaded(true)
            setError(null)
          }).catch((reason) => setError(ipcErrorMessage(reason, 'Could not restore the draft.')))
        }}>Retry</button>}
      </p>}
    </div>
  )
}
