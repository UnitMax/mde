import { useState } from 'react'
import { LoaderCircle, MessageCircleQuestion, ShieldAlert } from 'lucide-react'
import type { ChatForm, ChatFormField, ChatPermission } from '@shared/types'
import { Button } from '@/components/ui/button'
import { formAnswer, initialFormDraft, permissionTitle, type FormDraft } from '@/lib/chat'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { cn } from '@/lib/utils'

function Card({
  icon,
  title,
  children,
  testId,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
  testId: string
}): JSX.Element {
  return (
    <section
      data-testid={testId}
      className="rounded-lg border border-warn/40 bg-warn/5 px-3.5 py-3"
      aria-label={title}
    >
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
    <Card testId={`chat-permission-${permission.id}`} icon={<ShieldAlert className="h-4 w-4 text-warn" />} title={`Permission: ${permissionTitle(permission.action)}`}>
      {permission.message && <p className="mb-2 text-[13px] text-fg-muted">{permission.message}</p>}
      {permission.incomplete && <p role="alert" className="mb-2 text-[13px] text-warn">MDE cannot show this permission request completely. Review it in an OpenCode terminal, or reject it here.</p>}
      {permission.resources.length > 0 && (
        <ul className="mb-3 flex flex-col gap-0.5">
          {permission.resources.map((resource) => (
            <li key={resource} className="truncate rounded bg-bg px-2 py-1 font-mono text-[12px] text-fg-muted" title={resource}>
              {resource}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" disabled={pending !== null || permission.incomplete} onClick={() => void reply('once')}>
          {pending === 'once' && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
          Allow once
        </Button>
        <Button size="sm" variant="secondary" disabled={pending !== null || permission.incomplete} onClick={() => void reply('always')}>
          {pending === 'always' && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
          Always allow
        </Button>
        <Button size="sm" variant="danger" disabled={pending !== null} onClick={() => void reply('reject')}>
          {pending === 'reject' && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
          Reject
        </Button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </Card>
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
      <Card testId={`chat-question-${form.id}`} icon={<MessageCircleQuestion className="h-4 w-4 text-warn" />} title={form.title}>
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
    <Card testId={`chat-question-${form.id}`} icon={<MessageCircleQuestion className="h-4 w-4 text-warn" />} title={form.title}>
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
