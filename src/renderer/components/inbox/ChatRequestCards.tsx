import { useState } from 'react'
import { Bot, LoaderCircle, MessageCircleQuestion, ShieldAlert } from 'lucide-react'
import type { ChatForm, ChatFormField, ChatPermission, ChatRequestSubagent } from '@shared/types'
import { alwaysAllowHint, hasHiddenCharacters, visibleSegments } from '@/lib/saved-permissions'
import { Button } from '@/components/ui/button'
import { formAnswer, initialFormDraft, permissionTitle, type FormDraft } from '@/lib/chat'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { cn } from '@/lib/utils'

function Card({
  icon,
  title,
  subagent,
  children,
  testId,
}: {
  icon: React.ReactNode
  title: string
  /** A subagent of the thread asks, not the thread's own agent. */
  subagent?: ChatRequestSubagent
  children: React.ReactNode
  testId: string
}): JSX.Element {
  const from = subagent ? `Subagent${subagent.title ? ` “${subagent.title}”` : ''}` : null
  return (
    <section
      data-testid={testId}
      data-subagent={subagent?.sessionId}
      className="rounded-lg border border-warn/40 bg-warn/5 px-3.5 py-3"
      aria-label={from ? `${from}: ${title}` : title}
    >
      {from && (
        <p className="mb-1 flex min-w-0 items-center gap-1.5 text-[11.5px] text-fg-muted" data-testid="chat-request-subagent">
          <Bot aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
          <span className="min-w-0 truncate" title={from}>{from} asks</span>
        </p>
      )}
      <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-fg">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  )
}

/** Asks the user to allow or reject something the agent wants to do. */
export function PermissionCard({
  permission,
  onReply,
}: {
  permission: ChatPermission
  onReply: (decision: 'once' | 'always' | 'reject') => Promise<void>
}): JSX.Element {
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const hidden = hasHiddenCharacters(permission.resources, true) || hasHiddenCharacters(permission.save ?? [], false)
  const reply = async (decision: 'once' | 'always' | 'reject'): Promise<void> => {
    setPending(decision)
    setError(null)
    try {
      await onReply(decision)
    } catch (reason) {
      setError(ipcErrorMessage(reason, 'Could not send the answer.'))
      setPending(null)
    }
  }
  return (
    <Card
      testId={`chat-permission-${permission.id}`}
      icon={<ShieldAlert className="h-4 w-4 text-warn" />}
      title={`Permission: ${permissionTitle(permission.action)}`}
      {...(permission.subagent ? { subagent: permission.subagent } : {})}
    >
      {permission.message && <p className="mb-2 text-[13px] text-fg-muted">{permission.message}</p>}
      {permission.incomplete && <p role="alert" className="mb-2 text-[13px] text-warn">MDE cannot read this permission request. Reject it here, or answer it in an OpenCode terminal.</p>}
      {hidden && <p role="alert" data-testid="chat-permission-hidden" className="mb-2 text-[13px] text-warn">This request contains invisible characters. Each one is shown as a marked code such as U+202E.</p>}
      {permission.resources.length > 0 && (
        <ul className={cn('mb-3 flex flex-col gap-0.5', permission.resources.length > 8 && 'max-h-72 overflow-auto')} data-testid="chat-permission-resources">
          {permission.resources.map((resource, index) => (
            <li key={index} className="max-h-48 shrink-0 overflow-auto whitespace-pre-wrap break-all rounded bg-bg px-2 py-1 font-mono text-[12px] text-fg-muted">
              <VisibleText text={resource} multiline />
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" disabled={pending !== null || permission.incomplete} onClick={() => void reply('once')}>
          {pending === 'once' && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
          Allow once
        </Button>
        <Button size="sm" variant="secondary" disabled={pending !== null || permission.incomplete || permission.saveIncomplete} onClick={() => void reply('always')}>
          {pending === 'always' && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
          Always allow
        </Button>
        <Button size="sm" variant="danger" disabled={pending !== null} onClick={() => void reply('reject')}>
          {pending === 'reject' && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
          Reject
        </Button>
      </div>
      {permission.saveIncomplete && !permission.incomplete && (
        <p data-testid="chat-permission-save-unreadable" className="mt-2 text-[12px] leading-snug text-fg-subtle">
          Always allow is off: MDE cannot read what it would save. Allow once still works.
        </p>
      )}
      <AlwaysAllowHint permission={permission} />
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </Card>
  )
}

/** Text with each hidden character shown as a marked `U+XXXX` code. */
function VisibleText({ text, multiline = false }: { text: string; multiline?: boolean }): JSX.Element {
  return (
    <>
      {visibleSegments(text, multiline).map((segment, index) => segment.hidden
        ? <span key={index} title="Invisible character" className="mx-px rounded-sm border border-warn/60 px-0.5 text-[0.85em] text-warn">{segment.code}</span>
        : <span key={index}>{segment.text}</span>)}
    </>
  )
}

/** Up to this many saved patterns are listed inline in the sentence; more get a list of their own. */
const INLINE_PATTERNS = 5

/** What "Always allow" would save, said before it is chosen: it is for the whole project, and may be every such call. */
function AlwaysAllowHint({ permission }: { permission: ChatPermission }): JSX.Element | null {
  const hint = alwaysAllowHint(permission.action, permission.save)
  if (!hint || permission.incomplete || permission.saveIncomplete) return null
  const code = (pattern: string): JSX.Element => (
    <code className="inbox-code-font rounded bg-bg px-1 text-[11.5px] text-fg-muted"><VisibleText text={pattern} /></code>
  )
  if (hint.broad) {
    return (
      <p data-testid="chat-permission-always-hint" data-broad className="mt-2 text-[12px] leading-snug text-warn">
        Always allow covers <strong className="font-semibold">every {hint.noun}</strong> in this project from now on, in all its threads, not just this one.
        {' '}You can remove it under Permissions in the sidebar.
      </p>
    )
  }
  if (hint.patterns.length > INLINE_PATTERNS) {
    return (
      <div data-testid="chat-permission-always-hint" className="mt-2 text-[12px] leading-snug text-fg-subtle">
        <p>Always allow saves these {hint.patterns.length} patterns for this project, in all its threads. You can remove them under Permissions in the sidebar.</p>
        <ul className="mt-1 flex max-h-40 flex-col gap-0.5 overflow-auto" data-testid="chat-permission-always-patterns">
          {hint.patterns.map((pattern, index) => <li key={index} className="break-all">{code(pattern)}</li>)}
        </ul>
      </div>
    )
  }
  return (
    <p data-testid="chat-permission-always-hint" className="mt-2 text-[12px] leading-snug text-fg-subtle">
      Always allow saves{' '}
      {hint.patterns.map((pattern, index) => (
        <span key={index}>
          {index > 0 && ', '}
          {code(pattern)}
        </span>
      ))}{' '}
      for this project, in all its threads.
      {' '}You can remove it under Permissions in the sidebar.
    </p>
  )
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: ChatFormField
  value: FormDraft[string]
  onChange: (value: FormDraft[string]) => void
}): JSX.Element {
  const inputClass = 'h-8 w-full rounded-md border border-line-strong bg-bg px-2.5 text-[13px] text-fg outline-none focus:border-accent/60 placeholder:text-fg-subtle'
  if (field.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-[13px] text-fg">
        <input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
        Yes
      </label>
    )
  }
  if (field.type === 'multiselect') {
    const selected = Array.isArray(value) ? value : []
    return (
      <div className="flex flex-col gap-1">
        {field.options.map((option) => (
          <label key={option.value} className="flex items-start gap-2 text-[13px] text-fg">
            <input
              type="checkbox"
              className="mt-1"
              checked={selected.includes(option.value)}
              onChange={(event) =>
                onChange(event.target.checked ? [...selected, option.value] : selected.filter((item) => item !== option.value))}
            />
            <span>
              <span className="font-medium">{option.label}</span>
              {option.description && <span className="block text-[12px] leading-snug text-fg-muted">{option.description}</span>}
            </span>
          </label>
        ))}
      </div>
    )
  }
  if (field.type === 'number' || field.type === 'integer') {
    return (
      <input
        type="text"
        inputMode={field.type === 'integer' ? 'numeric' : 'decimal'}
        className={inputClass}
        value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
        placeholder={field.placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  }
  const text = typeof value === 'string' ? value : ''
  const chosen = field.options.some((option) => option.value === text)
  // Options that explain themselves are listed as rows so the explanation stays readable.
  const described = field.options.some((option) => option.description)
  return (
    <div className="flex flex-col gap-1.5">
      {field.options.length > 0 && (
        described ? (
          <div role="group" aria-label={field.title ?? field.key} className="flex flex-col gap-1.5">
            {field.options.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={text === option.value}
                data-testid={`chat-option-${option.value}`}
                onClick={() => onChange(option.value)}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left transition-colors',
                  text === option.value
                    ? 'border-accent bg-accent/15'
                    : 'border-line-strong hover:bg-hover',
                )}
              >
                <span className="block text-[13px] font-medium text-fg">{option.label}</span>
                {option.description && (
                  <span className="mt-0.5 block text-[12px] leading-snug text-fg-muted">{option.description}</span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {field.options.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={text === option.value}
                data-testid={`chat-option-${option.value}`}
                onClick={() => onChange(option.value)}
                className={cn(
                  'rounded-full border px-3 py-1 text-[12.5px] transition-colors',
                  text === option.value
                    ? 'border-accent bg-accent/15 text-fg'
                    : 'border-line-strong text-fg-muted hover:bg-hover hover:text-fg',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        )
      )}
      {(field.custom || field.options.length === 0) && (
        <input
          type="text"
          className={inputClass}
          aria-label={field.options.length > 0 ? 'Other answer' : field.title ?? field.key}
          placeholder={field.placeholder ?? (field.options.length > 0 ? 'Or type your own answer' : 'Your answer')}
          value={chosen ? '' : text}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  )
}

/** Shows a question the agent asked and sends the answer. */
export function QuestionCard({
  form,
  onReply,
}: {
  form: ChatForm
  onReply: (answer: Record<string, string | number | boolean | string[]>) => Promise<void>
}): JSX.Element {
  const [draft, setDraft] = useState<FormDraft>(() => initialFormDraft(form))
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (form.unsupported) {
    return (
      <Card testId={`chat-question-${form.id}`} icon={<MessageCircleQuestion className="h-4 w-4 text-warn" />} title={form.title} {...(form.subagent ? { subagent: form.subagent } : {})}>
        <p className="text-[13px] text-fg-muted">
          This question uses fields MDE cannot show yet. Answer it in OpenCode in a terminal.
        </p>
      </Card>
    )
  }

  const submit = async (): Promise<void> => {
    const result = formAnswer(form, draft)
    if ('error' in result) {
      setError(result.error)
      return
    }
    setSending(true)
    setError(null)
    try {
      await onReply(result.answer)
    } catch (reason) {
      setError(ipcErrorMessage(reason, 'Could not send the answer.'))
      setSending(false)
    }
  }

  return (
    <Card testId={`chat-question-${form.id}`} icon={<MessageCircleQuestion className="h-4 w-4 text-warn" />} title={form.title} {...(form.subagent ? { subagent: form.subagent } : {})}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        {form.fields.map((field) => (
          <div key={field.key} className="flex flex-col gap-1.5">
            {(field.title || field.description) && (
              <div>
                {field.title && <p className="text-[13px] font-medium text-fg">{field.title}</p>}
                {field.description && <p className="text-[12.5px] text-fg-muted">{field.description}</p>}
              </div>
            )}
            <FieldInput
              field={field}
              value={draft[field.key]}
              onChange={(value) => setDraft((current) => ({ ...current, [field.key]: value }))}
            />
          </div>
        ))}
        <div className="flex items-center gap-2">
          <Button size="sm" type="submit" disabled={sending}>
            {sending && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
            Send answer
          </Button>
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        </div>
      </form>
    </Card>
  )
}
