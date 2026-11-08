import { useMemo, useState } from 'react'
import { ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  isProviderPattern,
  newCustomProvider,
  type CustomProvider,
  type OpenCodeConfigDraft,
  type OpenCodeConfigSnapshot,
} from '@shared/opencode-config'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { OpenCodeConfigProviderForm } from '@/components/inbox/OpenCodeConfigProviderForm'

type View = { kind: 'list' } | { kind: 'add' } | { kind: 'edit'; id: string }

interface ProviderEntry {
  id: string
  name: string
  /** Why the switch cannot be used, when it cannot. */
  locked: string | null
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

/**
 * Every provider the switches list: the ones the running service reports, the custom ones in the draft, and the
 * ones the file already disables (a disabled provider no longer shows up in the service's own list).
 */
function providerEntries(snapshot: OpenCodeConfigSnapshot, draft: OpenCodeConfigDraft): ProviderEntry[] {
  const entries = new Map<string, ProviderEntry>()
  const add = (id: string, name: string, locked: string | null = null): void => {
    const existing = entries.get(id)
    entries.set(id, { id, name: existing && existing.name !== existing.id ? existing.name : name || id, locked: existing?.locked ?? locked })
  }
  for (const provider of snapshot.knownProviders) add(provider.id, provider.name)
  for (const provider of draft.customProviders) add(provider.id, provider.name)
  for (const id of snapshot.draft.disabledProviders) add(id, id)
  for (const id of draft.disabledProviders) add(id, id)
  for (const id of snapshot.legacy.disabledProviders) {
    add(id, id, 'Disabled by disabled_providers in the file. Remove it there to enable the provider.')
  }
  return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

function CustomProviderRow({
  provider,
  readOnly,
  onEdit,
  onRemove,
}: {
  provider: CustomProvider
  readOnly: boolean
  onEdit: () => void
  onRemove: () => void
}): JSX.Element {
  const label = provider.name || provider.id
  return (
    <li data-testid="opencode-provider-row" className="flex items-center gap-2 rounded-md border border-line bg-panel px-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-fg">{label}</span>
        <span className="block truncate font-mono text-[11px] text-fg-subtle" title={provider.baseUrl}>
          {provider.id} · {provider.baseUrl} · {plural(provider.models.length, 'model')}
        </span>
      </span>
      <Button type="button" variant="ghost" size="icon" disabled={readOnly} aria-label={`Edit ${label}`} title="Edit" data-testid="opencode-provider-edit" onClick={onEdit}>
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={readOnly}
        aria-label={`Remove ${label}`}
        title="Remove from the configuration"
        className="hover:text-danger"
        data-testid="opencode-provider-remove"
        onClick={onRemove}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </li>
  )
}

function DisableProviders({
  snapshot,
  draft,
  readOnly,
  onChange,
}: {
  snapshot: OpenCodeConfigSnapshot
  draft: OpenCodeConfigDraft
  readOnly: boolean
  onChange: (disabled: string[]) => void
}): JSX.Element {
  const [typed, setTyped] = useState('')
  const entries = useMemo(() => providerEntries(snapshot, draft), [snapshot, draft])
  const disabled = new Set(draft.disabledProviders)
  const candidate = typed.trim()
  const problem =
    candidate === '' ? null : !isProviderPattern(candidate) ? 'Use a provider id; * and ? match several.' : disabled.has(candidate) ? `${candidate} is already disabled.` : null
  const canAdd = candidate !== '' && problem === null && !readOnly

  const toggle = (id: string, enabled: boolean): void => {
    onChange(enabled ? draft.disabledProviders.filter((existing) => existing !== id) : [...draft.disabledProviders, id])
  }
  const add = (): void => {
    if (!canAdd) return
    onChange([...draft.disabledProviders, candidate])
    setTyped('')
  }

  return (
    <section className="flex flex-col gap-2" data-testid="opencode-disable-providers">
      <div>
        <h3 className="text-[13px] font-medium text-fg">Disable providers</h3>
        <p className="mt-0.5 text-xs text-fg-muted">
          A disabled provider and its models disappear from OpenCode’s model list.
          {snapshot.knownProviders.length === 0 && ' OpenCode is not running, so only providers named in the file are listed; type an id below to add another.'}
        </p>
      </div>
      {snapshot.legacy.enabledProviders.length > 0 && (
        <p data-testid="opencode-enabled-providers-note" className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-fg-muted">
          The file has an enabled_providers list ({snapshot.legacy.enabledProviders.join(', ')}). OpenCode then offers only those providers, whatever is switched on here.
        </p>
      )}
      {entries.length > 0 && (
        <ul className="flex flex-col gap-1">
          {entries.map((entry) => {
            const isDisabled = disabled.has(entry.id) || entry.locked !== null
            const pattern = /[*?]/.test(entry.id)
            return (
              <li key={entry.id} data-testid="opencode-provider-switch-row" className="flex items-center gap-3 rounded-md border border-line bg-panel px-3 py-1.5">
                <span className="min-w-0 flex-1">
                  <span data-testid="opencode-provider-switch-name" className="block truncate text-[13px] text-fg">{entry.name}</span>
                  <span className="block truncate text-[11px] text-fg-subtle">
                    <span className="font-mono">{entry.id}</span>
                    {pattern && ' · matches several providers'}
                    {entry.locked && ` · ${entry.locked}`}
                  </span>
                </span>
                <span className="w-14 text-right text-[11px] text-fg-subtle">{isDisabled ? 'Disabled' : 'Enabled'}</span>
                <Switch
                  checked={!isDisabled}
                  disabled={readOnly || entry.locked !== null}
                  aria-label={`${entry.name} enabled`}
                  data-testid="opencode-provider-switch"
                  onCheckedChange={(enabled) => toggle(entry.id, enabled)}
                />
              </li>
            )
          })}
        </ul>
      )}
      <form
        className="flex items-start gap-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          add()
        }}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Input
            value={typed}
            disabled={readOnly}
            spellCheck={false}
            autoComplete="off"
            placeholder="Another provider id, e.g. openrouter or ac*"
            aria-label="Provider id to disable"
            data-testid="opencode-disable-input"
            className="font-mono text-xs"
            onChange={(event) => setTyped(event.target.value)}
          />
          {problem && <p className="text-[11px] text-fg-muted">{problem}</p>}
        </div>
        <Button type="submit" size="default" variant="secondary" disabled={!canAdd} data-testid="opencode-disable-add">
          Disable
        </Button>
      </form>
    </section>
  )
}

/** What the file holds that the editor leaves alone, so that nothing in it is a surprise. */
function LeftAlone({ snapshot }: { snapshot: OpenCodeConfigSnapshot }): JSX.Element | null {
  const { legacy, foreignProviders } = snapshot
  if (legacy.keys.length === 0 && foreignProviders.length === 0) return null
  return (
    <section className="flex flex-col gap-2" data-testid="opencode-left-alone">
      {foreignProviders.length > 0 && (
        <div>
          <h3 className="text-[13px] font-medium text-fg">Other providers in the file</h3>
          <p className="mt-0.5 text-xs text-fg-muted">
            These are not OpenAI-compatible providers made here. They stay exactly as they are; edit them by hand.
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {foreignProviders.map((provider) => (
              <li key={provider.id} data-testid="opencode-foreign-provider" className="rounded-md border border-line px-3 py-1.5 text-[13px] text-fg-muted">
                {provider.name} <span className="font-mono text-[11px] text-fg-subtle">{provider.id}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {legacy.keys.length > 0 && (
        <p data-testid="opencode-legacy-note" className="rounded-md border border-line px-3 py-2 text-xs text-fg-muted">
          The file also has older settings ({legacy.keys.join(', ')}). OpenCode still applies them, and MDE leaves them as they are.
          {legacy.providers.length > 0 && ` Providers there: ${legacy.providers.join(', ')}.`}
        </p>
      )}
    </section>
  )
}

/** Custom OpenAI-compatible providers, and which providers are switched off. */
export function OpenCodeConfigProviders({
  snapshot,
  draft,
  readOnly,
  onChange,
}: {
  snapshot: OpenCodeConfigSnapshot
  draft: OpenCodeConfigDraft
  readOnly: boolean
  onChange: (change: (draft: OpenCodeConfigDraft) => OpenCodeConfigDraft) => void
}): JSX.Element {
  const [view, setView] = useState<View>({ kind: 'list' })
  const back = (): void => setView({ kind: 'list' })

  // Ids a new provider cannot take: they would collide with a provider the editor does not manage.
  const taken = useMemo(
    () => new Set([...snapshot.foreignProviders.map((provider) => provider.id), ...snapshot.legacy.providers]),
    [snapshot]
  )

  const editing = view.kind === 'edit' ? draft.customProviders.find((provider) => provider.id === view.id) : undefined
  if (view.kind === 'add' || (view.kind === 'edit' && editing)) {
    const creating = view.kind === 'add'
    return (
      <div className="flex flex-col gap-3" data-testid="opencode-provider-editor">
        <div>
          <Button type="button" variant="ghost" size="sm" className="-ml-2 mb-1 text-fg-muted" data-testid="opencode-provider-back" onClick={back}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Providers
          </Button>
          <h3 className="text-[13px] font-medium text-fg">{creating ? 'Add a provider' : `Edit ${editing?.name || editing?.id}`}</h3>
          <p className="mt-0.5 text-xs text-fg-muted">
            Any server with an OpenAI-compatible API: llama.cpp, Ollama, LM Studio, vLLM and others.
          </p>
        </div>
        <OpenCodeConfigProviderForm
          key={view.kind === 'edit' ? view.id : 'new'}
          initial={creating ? newCustomProvider() : (editing as CustomProvider)}
          creating={creating}
          taken={creating ? new Set([...taken, ...draft.customProviders.map((provider) => provider.id)]) : taken}
          onCancel={back}
          onDone={(provider) => {
            onChange((current) => ({
              ...current,
              customProviders: creating
                ? [...current.customProviders, provider]
                : current.customProviders.map((existing) => (existing.id === provider.id ? provider : existing)),
            }))
            back()
          }}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6" data-testid="opencode-providers">
      <section className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[13px] font-medium text-fg">Custom providers</h3>
            <p className="mt-0.5 text-xs text-fg-muted">
              Servers with an OpenAI-compatible API, such as llama.cpp, Ollama or LM Studio. Their models join OpenCode’s model list.
            </p>
          </div>
          <Button type="button" size="sm" disabled={readOnly} data-testid="opencode-provider-add" onClick={() => setView({ kind: 'add' })}>
            <Plus className="h-3.5 w-3.5" />
            Add provider
          </Button>
        </div>
        {draft.customProviders.length === 0 ? (
          <p data-testid="opencode-providers-empty" className="rounded-md border border-dashed border-line px-3 py-5 text-center text-[13px] text-fg-muted">
            No custom providers yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {draft.customProviders.map((provider) => (
              <CustomProviderRow
                key={provider.id}
                provider={provider}
                readOnly={readOnly}
                onEdit={() => setView({ kind: 'edit', id: provider.id })}
                onRemove={() =>
                  onChange((current) => ({
                    ...current,
                    customProviders: current.customProviders.filter((existing) => existing.id !== provider.id),
                  }))
                }
              />
            ))}
          </ul>
        )}
      </section>
      <DisableProviders
        snapshot={snapshot}
        draft={draft}
        readOnly={readOnly}
        onChange={(disabledProviders) => onChange((current) => ({ ...current, disabledProviders }))}
      />
      <LeftAlone snapshot={snapshot} />
    </div>
  )
}
