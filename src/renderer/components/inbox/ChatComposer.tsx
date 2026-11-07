import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ForwardedRef, type ReactNode } from 'react'
import { Paperclip, PenLine, X, File as FileIcon, Bot, ChevronDown, Hammer, ListChecks, LoaderCircle, Square } from 'lucide-react'
import { readFileTreeDrop, isFileDrop } from '@/terminal/drop'
import type { ChatDelivery, ChatDraft, ChatDraftChoice, ChatDraftKey, ChatDraftRequest, ChatAgent, ChatSkill, OpenCodeModelRef } from '@shared/types'
import { skillTriggerAt } from '@shared/skills'
import { addQuote, joinQuotes, leadingQuotes, MESSAGE_TEXT_LIMIT } from '@/lib/chat-quote'
import { applySkill, filterSkills } from '@/lib/skills'
import { applyCommand, filterCommands, parseInvocation, slashTriggerAt, type SlashCommand, type SlashInvocation } from '@/lib/slash-commands'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CompletionPicker, type CompletionItem } from '@/components/inbox/CompletionPicker'
import { ContextMeter, type ContextCompact } from '@/components/inbox/ContextMeter'
import { ChatInput, type ChatInputHandle } from '@/components/inbox/ChatInput'
import { ChatQuoteCard } from '@/components/inbox/ChatQuoteCard'
import { ModelPicker } from '@/components/inbox/ModelPicker'
import { ChatSendButton } from '@/components/inbox/ChatSendButton'
import { SlashCommandIcon } from '@/components/inbox/SlashCommandIcon'
import { orderAgents, type ContextUsage } from '@/lib/chat'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { cn } from '@/lib/utils'
import type { OptionsState } from '@/store/inbox-chat'
import { useWorkspace } from '@/store/workspace'

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

/** Names the word at the caret that a list would open for, as `dismissed` remembers a list that was closed. */
function completionKey(text: string, caret: number, hasCommands: boolean): string | null {
  if (hasCommands && slashTriggerAt(text, caret)) return 'command'
  const skill = skillTriggerAt(text, caret)
  return skill ? `skill:${skill.start}` : null
}

const NO_SKILLS: ChatSkill[] = []
const NO_COMMANDS: readonly SlashCommand[] = []
const NO_ITEMS: CompletionItem[] = []

export interface ChatComposerProps {
  draftKey?: ChatDraftKey
  /**
   * What a new thread's draft (`draft:` key) is written for: its folder, and how it would start (the
   * agent, the model, a worktree) once that is known. Every change to the draft carries it, and a change
   * to it is told to the draft, so the draft can be listed and reopened with the same choices.
   */
  draftMeta?: { folderId: string; choice?: ChatDraftChoice }
  /**
   * Offers Save as draft (a button, and Cmd/Ctrl+S) where what is typed is a new thread: the page then
   * sets it aside and starts blank. Only offered with something typed or attached.
   */
  onSaveDraft?: () => void
  /** The preceding nonempty user message in this thread; older pages are loaded as needed. */
  onPreviousMessage?: (beforeId?: string) => Promise<{ id: string; text: string } | null>
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
  /**
   * Sends the text; a rejection keeps the text and shows the error. `delivery` is set while the agent is
   * working: how the message should reach it. `background` starts a new thread without opening it.
   */
  onSend: (text: string, options?: { attachmentIds?: string[]; draftRevision?: number; delivery?: ChatDelivery; background?: boolean }) => Promise<void>
  /** On the new-thread page, Ctrl+Enter (also Cmd+Enter on macOS) starts a thread and keeps the page open. */
  allowBackgroundSend?: boolean
  /** Shown as a Stop button while the agent is working and the box is empty; the send button then says how it will send. */
  running?: boolean
  onStop?: () => void
  onRetryOptions?: () => void
  /** How full the model's context window is; the pill is left out when there is nothing to show. */
  context?: ContextUsage | null
  /** Offers compacting in the context pill's menu; without it the menu only shows the breakdown. */
  compact?: ContextCompact
  placeholder?: string
  autoFocus?: boolean
  disabled?: boolean
  /** True while something outside the box makes sending impossible (the Git bar's branch name is invalid). */
  sendBlocked?: boolean
  /** Shown directly under the box, above any error; the new-thread page puts its Git bar here. */
  footer?: ReactNode
  /** More pills for the toolbar, after the model and agent pickers; the MCP servers go here. */
  extraPickers?: ReactNode
  /**
   * The slash commands the box offers: a message that starts with `/` and one of their names is that
   * command, not a message to send. The new-thread page has none, because a command acts on a thread.
   */
  commands?: readonly SlashCommand[]
  /** Escape was pressed in the box and nothing in the box used it; return true when the page did (it closed something). */
  onEscape?: () => boolean
}

/** What the page around the box can ask of it. */
export interface ChatComposerHandle {
  /**
   * Attaches text from the conversation to the message as a quote, and gives the box the focus. While the
   * draft is still loading or a send is under way, the quote waits for the box to be ready for it.
   */
  quote: (text: string) => void
}

/** A quote attached to the message; the id keeps a card's state with it when another is taken off. */
interface Quote {
  id: number
  text: string
}

/** The prompt box with model and agent pickers and a round send (or stop) button. */
export const ChatComposer = forwardRef(function ChatComposer({
  draftKey,
  draftMeta,
  onSaveDraft,
  onPreviousMessage,
  draftReload,
  onDraftReloaded,
  options,
  agent,
  model,
  onAgentChange,
  onModelChange,
  onSend,
  allowBackgroundSend = false,
  running = false,
  onStop,
  onRetryOptions,
  context = null,
  compact,
  placeholder = 'Ask for changes or send follow-ups',
  autoFocus = false,
  disabled = false,
  sendBlocked = false,
  footer,
  extraPickers,
  commands = NO_COMMANDS,
  onEscape,
}: ChatComposerProps, ref: ForwardedRef<ChatComposerHandle>): JSX.Element {
  // What is typed. The quotes attached to the message are kept apart from it, as cards above the box, and are
  // joined to it as block quotes where the draft is kept and where the message is sent.
  const [text, setText] = useState('')
  const [quotes, setQuotes] = useState<Quote[]>([])
  const quoteIds = useRef(0)
  // The cards scroll when there are many; a quote just added is brought into view, a draft just loaded starts at the top.
  const quotesRegion = useRef<HTMLDivElement>(null)
  const revealQuote = useRef(false)
  useLayoutEffect(() => {
    const region = quotesRegion.current
    if (!revealQuote.current || !region) return
    revealQuote.current = false
    region.scrollTop = region.scrollHeight
  }, [quotes])
  const asQuotes = (texts: readonly string[]): Quote[] => texts.map((quote) => ({ id: (quoteIds.current += 1), text: quote }))
  const [draft, setDraft] = useState<ChatDraft>({ text: '', revision: 0, attachments: [] })
  const [loaded, setLoaded] = useState(!draftKey)
  const [adding, setAdding] = useState(false)
  const [dragging, setDragging] = useState(false)
  // Newest to oldest, with an identity that lets an edit cancel a pending history read.
  const recalled = useRef<{ messages: { id: string; text: string }[]; loading: boolean }>({ messages: [], loading: false })
  const resetHistory = (): void => { recalled.current = { messages: [], loading: false } }
  const inputRef = useRef<HTMLInputElement>(null)
  const currentKey = useRef(draftKey)
  currentKey.current = draftKey
  const mutate = (request: ChatDraftRequest): Promise<ChatDraft> => {
    if (!draftMeta || !request.key.startsWith('draft:')) return window.api.chat.draft(request)
    return window.api.chat.draft({ ...request, folderId: draftMeta.folderId, ...(draftMeta.choice ? { choice: draftMeta.choice } : {}) })
  }
  // The page was given another folder, or the choices were changed: the draft follows, with nothing else changed.
  const writtenFor = useRef(JSON.stringify(draftMeta))
  useEffect(() => {
    const now = JSON.stringify(draftMeta)
    if (writtenFor.current === now) return
    writtenFor.current = now
    if (draftKey && draftMeta) void mutate({ key: draftKey, action: 'flush' }).catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftMeta])
  const mac = useWorkspace((state) => state.platform?.platform === 'darwin')
  useEffect(() => {
    resetHistory()
    return resetHistory
  }, [draftKey, disabled])
  // Takes the draft as it was kept: the quotes it starts with become cards and the rest is the text. Gives how
  // much of the start was taken, which moves a place in the draft to the same place in the text.
  const applyDraft = (value: ChatDraft): number => {
    const { quotes: found, body } = leadingQuotes(value.text)
    setDraft(value)
    setQuotes(asQuotes(found))
    setText(body)
    return value.text.length - body.length
  }
  useEffect(() => {
    setLoaded(!draftKey)
    setText('')
    setQuotes([])
    setDraft({ text: '', revision: 0, attachments: [] })
    setError(null)
    if (!draftKey) return
    void mutate({ key: draftKey, action: 'load' }).then((value) => {
      if (currentKey.current !== draftKey) return
      applyDraft(value)
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
  // How a message reaches an agent that is working. It holds for the rest of the run and starts as steering again with the next.
  const [delivery, setDelivery] = useState<ChatDelivery>('steer')
  useEffect(() => { if (!running) setDelivery('steer') }, [running])
  const messageRef = useRef<ChatInputHandle>(null)
  const appliedReload = useRef(0)
  useEffect(() => {
    // Once it is let go of the next one may start counting again.
    if (!draftReload) appliedReload.current = 0
    if (!draftKey || !draftReload || draftReload.id === appliedReload.current) return
    resetHistory()
    appliedReload.current = draftReload.id
    onDraftReloaded?.(draftReload.id)
    void mutate({ key: draftKey, action: 'load' }).then((value) => {
      if (currentKey.current !== draftKey) return
      const taken = applyDraft(value)
      // The added text is at the top; the caret goes to its end, ready for changes.
      setFocusAt(Math.max(0, Math.min(draftReload.caret - taken, value.text.length - taken)))
    }).catch((reason) => setError(ipcErrorMessage(reason, 'Could not restore the draft.')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftReload, draftKey])
  // Asked for focus and a caret position. The box is switched off until the draft has loaded, and a
  // box that is off cannot take focus, so this waits for the render that switches it on.
  const [focusAt, setFocusAt] = useState<number | null>(null)
  useEffect(() => {
    if (focusAt === null || !loaded) return
    if (disabled || sending) return
    messageRef.current?.focus(focusAt)
    setFocusAt(null)
  }, [focusAt, loaded, disabled, sending, text])
  const ready = options?.status === 'ready'
  const canSend = ready && !disabled && !sendBlocked && !sending && !adding && loaded && (text.trim().length > 0 || draft.attachments.length > 0 || quotes.length > 0) && Boolean(agent) && Boolean(model)
  // Saving as a draft needs no agent or model, since nothing is started: only something to keep.
  const canSave = Boolean(onSaveDraft) && !disabled && !sending && !adding && loaded && (text.trim().length > 0 || draft.attachments.length > 0 || quotes.length > 0)

  // Completion: a `/word` at the very start of the message offers the commands that fit it, and a `$word`
  // at the caret the skills that fit it. Where the caret is only counts for the text it was measured in,
  // so text put there from outside (a loaded draft) never opens a list.
  const listId = useId()
  const skills = options?.status === 'ready' ? options.value.skills : NO_SKILLS
  const [cursor, setCursor] = useState<{ text: string; at: number } | null>(null)
  const [activeItem, setActiveItem] = useState(0)
  // The word of a list the user closed with Escape; it stays closed until that word is gone.
  const [dismissed, setDismissed] = useState<string | null>(null)
  const slashTrigger = useMemo(
    () => (commands.length > 0 && cursor?.text === text ? slashTriggerAt(text, cursor.at) : null),
    [commands, cursor, text],
  )
  const trigger = useMemo(
    () => (!slashTrigger && skills.length > 0 && cursor?.text === text ? skillTriggerAt(text, cursor.at) : null),
    [slashTrigger, skills, cursor, text],
  )
  const completionWord = slashTrigger ? 'command' : trigger ? `skill:${trigger.start}` : null
  useEffect(() => { if (!completionWord) setDismissed(null) }, [completionWord])
  const commandMatches = useMemo(() => (slashTrigger ? filterCommands(commands, slashTrigger.query) : NO_COMMANDS), [commands, slashTrigger])
  const matches = useMemo(() => (trigger ? filterSkills(skills, trigger.query) : NO_SKILLS), [skills, trigger])
  const listLength = slashTrigger ? commandMatches.length : matches.length
  const pickerOpen = completionWord !== null && listLength > 0 && completionWord !== dismissed && !disabled && !sending && loaded
  const activeIndex = Math.min(activeItem, Math.max(listLength - 1, 0))
  // The message as a command, when it starts with the name of one.
  const invocation = useMemo(() => parseInvocation(commands, text), [commands, text])
  const commandToken = useCallback((value: string) => {
    const found = parseInvocation(commands, value)
    return found ? { from: 0, to: found.nameEnd } : null
  }, [commands])
  const canRun = !disabled && !sending && !adding && loaded
  const missingArgument = Boolean(invocation?.command.argument?.required && !invocation.args)
  // Text after a command that takes none: Enter says so instead of running it.
  const strayArgument = Boolean(invocation && !invocation.command.argument && invocation.args)

  // Keeps the text with the quotes attached to it, as the draft.
  const persist = (next: string, attached: readonly Quote[] = quotes): void => {
    if (draftKey) {
      const kept = joinQuotes(attached.map((quote) => quote.text), next)
      void mutate({ key: draftKey, action: 'text', text: kept }).catch((reason) => setError(ipcErrorMessage(reason, 'Could not save the draft.')))
    }
  }
  // A quote is attached once the draft is in the box and no send is under way: a send empties the box when it
  // ends, and a quote attached before then would go with it.
  const boxReady = loaded && !sending && !disabled
  const waitingQuotes = useRef<string[]>([])
  const attachQuotes = (selections: readonly string[]): void => {
    const texts = selections.reduce<readonly string[]>(addQuote, quotes.map((quote) => quote.text))
    if (texts.length > quotes.length) {
      if (joinQuotes(texts, text).length > MESSAGE_TEXT_LIMIT) {
        setError('That is too much text to attach as a quote.')
      } else {
        const next = [...quotes, ...asQuotes(texts.slice(quotes.length))]
        revealQuote.current = true
        setQuotes(next)
        persist(text, next)
      }
    }
    messageRef.current?.focus()
  }
  useImperativeHandle(ref, () => ({
    quote: (selection) => {
      if (disabled) return
      if (boxReady) attachQuotes([selection])
      else waitingQuotes.current.push(selection)
    },
  }))
  useEffect(() => {
    if (!boxReady || waitingQuotes.current.length === 0) return
    attachQuotes(waitingQuotes.current.splice(0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxReady])
  const removeQuote = (id: number): void => {
    const next = quotes.filter((quote) => quote.id !== id)
    setQuotes(next)
    persist(text, next)
    messageRef.current?.focus()
  }
  // Where the caret goes once the chosen skill is in the box. This is a ref applied right after the
  // text lands, not the `focusAt` state above: that is cleared by a later render, and a key pressed
  // before then is drawn with the old value still set, which put the caret back where it had been.
  const pendingCaret = useRef<number | null>(null)
  useLayoutEffect(() => {
    const at = pendingCaret.current
    if (at === null) return
    pendingCaret.current = null
    messageRef.current?.focus(at)
  })
  const pickSkill = (skill: ChatSkill): void => {
    if (!trigger) return
    resetHistory()
    const next = applySkill(text, trigger, skill)
    pendingCaret.current = next.caret
    setText(next.text)
    persist(next.text)
    // A new object each time, so the box renders and puts the caret in place even when the text is unchanged.
    setCursor({ text: next.text, at: next.caret })
  }
  const completeCommand = (command: SlashCommand): void => {
    if (!slashTrigger) return
    resetHistory()
    const next = applyCommand(text, slashTrigger, command)
    pendingCaret.current = next.caret
    setText(next.text)
    persist(next.text)
    setCursor({ text: next.text, at: next.caret })
  }
  // The box empties at once and the command works on its own: the person can go on typing while it does.
  // A command that fails gives the text back, with the reason under it.
  const runCommand = async ({ command, args }: SlashInvocation): Promise<void> => {
    if (!canRun) return
    if (command.argument?.required && !args) {
      setError(`Add ${command.argument.hint} after /${command.name}.`)
      return
    }
    if (!command.argument && args) {
      setError(`/${command.name} takes nothing after it.`)
      return
    }
    resetHistory()
    setError(null)
    const written = text
    setText('')
    setCursor({ text: '', at: 0 })
    persist('')
    try {
      await command.run(args)
    } catch (reason) {
      setText(written)
      setCursor({ text: written, at: written.length })
      persist(written)
      setError(ipcErrorMessage(reason, `Could not run /${command.name}.`))
    } finally {
      setFocusAt(0)
    }
  }
  // Enter, a click and Tab on a row of the open list. A command that takes an argument is written into the
  // box to be finished; one that takes nothing runs, unless it is only being completed (Tab).
  const choose = (index: number, completeOnly = false): void => {
    if (!slashTrigger) {
      const skill = matches[index]
      if (skill) pickSkill(skill)
      return
    }
    const command = commandMatches[index]
    if (!command) return
    if (command.argument || completeOnly) completeCommand(command)
    else void runCommand({ command, args: '', nameEnd: slashTrigger.end })
  }

  // A recalled message comes back as it was: its quotes are cards again, and the rest is the text.
  const recallText = (full: string): void => {
    const { quotes: found, body } = leadingQuotes(full)
    const attached = asQuotes(found)
    pendingCaret.current = body.length
    setQuotes(attached)
    setText(body)
    setCursor({ text: body, at: body.length })
    // A recalled message that ends in a $word, or is one slash word, is ready to edit or send, without opening a list.
    setDismissed(completionKey(body, body.length, commands.length > 0))
    persist(body, attached)
  }
  const recallMessage = (event: KeyboardEvent): void => {
    const history = recalled.current
    if (event.key === 'ArrowDown') {
      if (history.messages.length === 0 && !history.loading) return
      event.preventDefault()
      const messages = history.messages.slice(0, -1)
      recalled.current = { messages, loading: false }
      recallText(messages[messages.length - 1]?.text ?? '')
      return
    }
    if (!onPreviousMessage || (history.messages.length === 0 && (text !== '' || quotes.length > 0))) return
    event.preventDefault()
    if (history.loading) return
    history.loading = true
    void onPreviousMessage(history.messages[history.messages.length - 1]?.id).then((message) => {
      if (recalled.current !== history) return
      history.loading = false
      if (!message) return
      history.messages.push(message)
      recallText(message.text)
    }).catch((reason) => {
      if (recalled.current !== history) return
      history.loading = false
      setError(ipcErrorMessage(reason, 'Could not recall the message.'))
    })
  }

  const send = async (background = false): Promise<void> => {
    if (!canSend) return
    resetHistory()
    setSending(true)
    setError(null)
    try {
      const message = joinQuotes(quotes.map((quote) => quote.text), text)
      let value: ChatDraft | undefined
      if (draftKey) {
        value = await mutate({ key: draftKey, action: 'text', text: message })
      }
      const options = {
        ...(value ? { attachmentIds: value.attachments.map((file) => file.id), draftRevision: value.revision } : {}),
        ...(running ? { delivery } : {}),
        ...(background ? { background: true } : {}),
      }
      await onSend(message, Object.keys(options).length > 0 ? options : undefined)
      setText('')
      setQuotes([])
      setDraft({ text: '', revision: 0, attachments: [] })
    } catch (reason) {
      setError(ipcErrorMessage(reason, 'Could not send the message.'))
    } finally {
      setSending(false)
      setFocusAt(text.length)
    }
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing) return
    if (onSaveDraft && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 's') {
      event.preventDefault()
      if (canSave) onSaveDraft()
      return
    }
    if (allowBackgroundSend && event.key === 'Enter' && (event.ctrlKey || (mac && event.metaKey)) && !event.shiftKey && !event.altKey) {
      event.preventDefault()
      void send(true)
      return
    }
    // Plain Enter chooses from the open list instead of sending half a message.
    if (pickerOpen && completionWord) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveItem((activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + listLength) % listLength)
        return
      }
      if ((event.key === 'Enter' && !event.shiftKey) || (event.key === 'Tab' && !event.shiftKey)) {
        event.preventDefault()
        choose(activeIndex, event.key === 'Tab')
        return
      }
      if (event.key === 'Escape') {
        // Closing the list is all Escape does here; it must not also close whatever else Escape closes.
        event.preventDefault()
        event.stopPropagation()
        setDismissed(completionWord)
        return
      }
    }
    // With no list to close, Escape belongs to the page: it closes the side question shown above the box.
    if (event.key === 'Escape' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && onEscape?.()) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      recallMessage(event)
      if (event.defaultPrevented) return
    }
    if ((event.key === 'Enter' && event.shiftKey) || (event.key.toLowerCase() === 'j' && event.ctrlKey && !event.shiftKey && !event.metaKey && !event.altKey)) {
      event.preventDefault()
      messageRef.current?.insertNewline()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (invocation) void runCommand(invocation)
      else void send()
    }
  }

  const items: CompletionItem[] = !pickerOpen ? NO_ITEMS
    : slashTrigger
      ? commandMatches.map((command) => ({
        key: command.name,
        label: `/${command.name}`,
        hint: command.argument ? (command.argument.required ? command.argument.hint : `[${command.argument.hint}]`) : undefined,
        description: command.description,
        icon: <SlashCommandIcon name={command.name} className="h-3.5 w-3.5" />,
        testId: `slash-option-${command.name}`,
      }))
      : matches.map((skill) => ({
        key: skill.id,
        label: `$${skill.id}`,
        description: skill.description,
        testId: `skill-option-${skill.id}`,
      }))

  return (
    <div className="flex flex-col gap-1.5">
      <div
        data-testid="chat-composer"
        onDragOver={(event) => { if (isFileDrop(event.dataTransfer)) { event.preventDefault(); setDragging(true) } }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false) }}
        onDropCapture={(event) => {
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
        {pickerOpen && (
          <CompletionPicker
            id={listId}
            label={slashTrigger ? 'Commands' : 'Skills'}
            testId={slashTrigger ? 'slash-picker' : 'skill-picker'}
            heading={slashTrigger ? 'Commands' : undefined}
            items={items}
            active={activeIndex}
            onActive={setActiveItem}
            onPick={(index) => choose(index)}
          />
        )}
        <input ref={inputRef} type="file" multiple hidden aria-label="Choose attachments" onChange={(event) => { void addFiles(Array.from(event.target.files ?? [])); event.target.value = '' }} />
        {draft.attachments.length > 0 && <div className="flex flex-wrap gap-2 px-4 pt-3" aria-label="Attachments">
          {draft.attachments.map((file) => <div key={file.id} className="relative flex max-w-48 items-center gap-2 rounded-lg border border-line p-2 text-xs" title={`${file.name} (${file.size.toLocaleString()} bytes)`}>
            {file.thumbnail ? <img src={file.thumbnail} alt={file.name} className="h-16 w-20 rounded object-contain" /> : <FileIcon className="h-5 w-5 shrink-0" />}
            <span className="truncate">{file.name}<span className="block text-fg-subtle">{Math.ceil(file.size / 1024)} KB</span></span>
            <button type="button" disabled={sending || adding} aria-label={`Remove ${file.name}`} onClick={() => { if (draftKey) void mutate({ key: draftKey, action: 'remove', attachmentId: file.id }).then(setDraft).catch((reason) => setError(ipcErrorMessage(reason, 'Could not remove file.'))) }}><X className="h-3.5 w-3.5" /></button>
          </div>)}
        </div>}
        {adding && <p role="status" className="px-4 pt-2 text-xs text-fg-muted">Adding attachments…</p>}
        {quotes.length > 0 && (
          <div ref={quotesRegion} role="group" aria-label="Quotes" data-testid="chat-quotes" className="flex max-h-44 flex-col gap-1.5 overflow-y-auto px-3 pt-3">
            {quotes.map((quote) => (
              <ChatQuoteCard key={quote.id} text={quote.text} disabled={sending} onRemove={() => removeQuote(quote.id)} />
            ))}
          </div>
        )}
        <ChatInput
          key={draftKey}
          ref={messageRef}
          autoFocus={autoFocus}
          value={text}
          disabled={disabled || sending || !loaded}
          placeholder={placeholder}
          onChange={(next, caret) => {
            resetHistory()
            setText(next)
            setCursor({ text: next, at: caret })
            setActiveItem(0)
            persist(next)
          }}
          // Moving the caret with the keys or the mouse changes which word it is in.
          onSelect={(next, caret) => setCursor({ text: next, at: caret })}
          commandToken={commandToken}
          controls={pickerOpen ? listId : undefined}
          activeDescendant={pickerOpen ? `${listId}-${activeIndex}` : undefined}
          onPaste={(event) => {
            const images = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'))
            if (images.length) { event.preventDefault(); void addFiles(images) }
          }}
          onKeyDown={onKeyDown}
        />
        <div className="flex min-w-0 items-center gap-1 px-2 pb-2">
          {draftKey && <button type="button" aria-label="Attach files" title="Attach files" disabled={disabled || sending || adding || !loaded} className={pickerButton} onClick={() => inputRef.current?.click()}><Paperclip className="h-4 w-4" /></button>}
          {options?.status === 'ready' ? (
            <>
              <ModelPicker models={options.value.models} value={model} onChange={onModelChange} onMenuClosed={() => messageRef.current?.focus()} disabled={disabled} />
              <span aria-hidden className="h-4 w-px bg-line-strong" />
              <AgentPicker agents={options.value.agents} value={agent} onChange={onAgentChange} disabled={disabled} />
              {extraPickers}
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
          {context && <ContextMeter usage={context} running={running} compact={compact} />}
          {onSaveDraft && (
            <button
              type="button"
              data-testid="chat-save-draft"
              aria-label="Save as draft"
              title={`Save as draft (${mac ? 'Cmd' : 'Ctrl'}+S)`}
              disabled={!canSave}
              onClick={onSaveDraft}
              className={cn(pickerButton, 'w-7 justify-center px-0')}
            >
              <PenLine aria-hidden="true" className="h-4 w-4" />
            </button>
          )}
          {running && onStop && !text.trim() && draft.attachments.length === 0 && quotes.length === 0 ? (
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
            <ChatSendButton
              running={running}
              delivery={delivery}
              onDeliveryChange={setDelivery}
              disabled={invocation ? !canRun || missingArgument || strayArgument : !canSend}
              sending={sending}
              backgroundShortcut={allowBackgroundSend ? `${mac ? 'Cmd' : 'Ctrl'}+Enter` : undefined}
              command={invocation ? { name: invocation.command.name, icon: <SlashCommandIcon name={invocation.command.name} className="h-4 w-4" /> } : undefined}
              onSend={() => void (invocation ? runCommand(invocation) : send())}
              onMenuClosed={() => messageRef.current?.focus()}
            />
          )}
        </div>
      </div>
      {footer}
      {error && <p role="alert" className="px-2 text-xs text-danger">
        {error}
        {!loaded && draftKey && <button type="button" className="ml-2 text-accent hover:underline" onClick={() => {
          void mutate({ key: draftKey, action: 'load' }).then((value) => {
            applyDraft(value)
            setLoaded(true)
            setError(null)
          }).catch((reason) => setError(ipcErrorMessage(reason, 'Could not restore the draft.')))
        }}>Retry</button>}
      </p>}
    </div>
  )
})
