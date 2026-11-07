import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import {
  customProviderProblem,
  newCustomModel,
  OPENCODE_CONFIG_LIMITS,
  type CustomModel,
  type CustomProvider,
} from '@shared/opencode-config'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** Digits only; an empty box means the limit is not set. */
function countFrom(raw: string): number | null {
  const digits = raw.replace(/\D/g, '').slice(0, 10)
  return digits === '' ? null : Number(digits)
}

/** The provider as it will be written: no stray spaces around the text the person typed. */
function tidy(provider: CustomProvider): CustomProvider {
  return {
    ...provider,
    id: provider.id.trim(),
    name: provider.name.trim(),
    baseUrl: provider.baseUrl.trim(),
    apiKeyEnv: provider.apiKeyEnv.trim(),
    models: provider.models.map((model) => ({ ...model, id: model.id.trim(), name: model.name.trim() })),
  }
}

const CHECKBOX = 'h-3.5 w-3.5 cursor-pointer accent-accent disabled:cursor-not-allowed'
const MODEL_COLUMNS = 'grid grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_5.5rem_5.5rem_3rem_3.5rem_1.75rem] items-center gap-1.5'

function ModelRow({
  model,
  index,
  providerId,
  canRemove,
  onChange,
  onRemove,
}: {
  model: CustomModel
  index: number
  providerId: string
  canRemove: boolean
  onChange: (model: CustomModel) => void
  onRemove: () => void
}): JSX.Element {
  const number = index + 1
  return (
    <li data-testid="opencode-model-row" className={MODEL_COLUMNS}>
      <Input
        value={model.id}
        spellCheck={false}
        autoComplete="off"
        placeholder="model-id"
        aria-label={`Model ${number} id`}
        data-testid="opencode-model-id"
        className="font-mono text-xs"
        onChange={(event) => onChange({ ...model, id: event.target.value })}
      />
      <Input
        value={model.name}
        autoComplete="off"
        placeholder="Display name"
        aria-label={`Model ${number} name`}
        data-testid="opencode-model-name"
        onChange={(event) => onChange({ ...model, name: event.target.value })}
      />
      <Input
        value={model.context ?? ''}
        inputMode="numeric"
        autoComplete="off"
        placeholder="128000"
        aria-label={`Model ${number} context tokens`}
        data-testid="opencode-model-context"
        className="text-right text-xs tabular-nums"
        onChange={(event) => onChange({ ...model, context: countFrom(event.target.value) })}
      />
      <Input
        value={model.output ?? ''}
        inputMode="numeric"
        autoComplete="off"
        placeholder="8192"
        aria-label={`Model ${number} output tokens`}
        data-testid="opencode-model-output"
        className="text-right text-xs tabular-nums"
        onChange={(event) => onChange({ ...model, output: countFrom(event.target.value) })}
      />
      <input
        type="checkbox"
        checked={model.tools}
        aria-label={`Model ${number} supports tools`}
        data-testid="opencode-model-tools"
        className={`${CHECKBOX} justify-self-center`}
        onChange={(event) => onChange({ ...model, tools: event.target.checked })}
      />
      <input
        type="checkbox"
        checked={model.imageInput}
        aria-label={`Model ${number} accepts images`}
        data-testid="opencode-model-images"
        className={`${CHECKBOX} justify-self-center`}
        onChange={(event) => onChange({ ...model, imageInput: event.target.checked })}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={!canRemove}
        aria-label={`Remove model ${number} from ${providerId || 'the provider'}`}
        title={canRemove ? 'Remove model' : 'A provider needs at least one model'}
        className="hover:text-danger"
        data-testid="opencode-model-remove"
        onClick={onRemove}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </li>
  )
}

/**
 * Adds or changes one custom OpenAI-compatible provider. It works on its own copy and hands the result back
 * with Done, so Cancel leaves the draft as it was. Only the name of the environment variable that holds the key
 * is asked for; the key itself never passes through here.
 */
export function OpenCodeConfigProviderForm({
  initial,
  creating,
  taken,
  onDone,
  onCancel,
}: {
  initial: CustomProvider
  creating: boolean
  /** Ids that cannot be used for a new provider: the ones already in the file under another key. */
  taken: ReadonlySet<string>
  onDone: (provider: CustomProvider) => void
  onCancel: () => void
}): JSX.Element {
  const [provider, setProvider] = useState(initial)
  const tidied = tidy(provider)
  const problem =
    creating && taken.has(tidied.id)
      ? `The id ${tidied.id} is already used by another provider in the file.`
      : customProviderProblem(tidied)

  const patch = (change: Partial<CustomProvider>): void => setProvider((current) => ({ ...current, ...change }))
  const setModels = (change: (models: CustomModel[]) => CustomModel[]): void =>
    setProvider((current) => ({ ...current, models: change(current.models) }))

  return (
    <form
      className="flex flex-col gap-4"
      data-testid="opencode-provider-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (!problem) onDone(tidied)
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="opencode-provider-id">Provider id</Label>
          <Input
            id="opencode-provider-id"
            autoFocus={creating}
            value={provider.id}
            readOnly={!creating}
            spellCheck={false}
            autoComplete="off"
            placeholder="llama-cpp"
            data-testid="opencode-provider-id"
            className={`font-mono text-xs ${creating ? '' : 'text-fg-muted'}`}
            onChange={(event) => patch({ id: event.target.value })}
          />
          <p className="text-[11px] text-fg-subtle">
            {creating ? 'Models are named id/model. It cannot be changed later.' : 'It cannot be changed. Add a new provider to use another id.'}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="opencode-provider-name">Name</Label>
          <Input
            id="opencode-provider-name"
            autoFocus={!creating}
            value={provider.name}
            autoComplete="off"
            placeholder="llama.cpp (local)"
            maxLength={OPENCODE_CONFIG_LIMITS.name}
            data-testid="opencode-provider-name"
            onChange={(event) => patch({ name: event.target.value })}
          />
          <p className="text-[11px] text-fg-subtle">Shown in the model list. Optional.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="opencode-provider-url">Base URL</Label>
          <Input
            id="opencode-provider-url"
            value={provider.baseUrl}
            spellCheck={false}
            autoComplete="off"
            placeholder="http://localhost:8080/v1"
            data-testid="opencode-provider-url"
            className="font-mono text-xs"
            onChange={(event) => patch({ baseUrl: event.target.value })}
          />
          <p className="text-[11px] text-fg-subtle">The server’s OpenAI-compatible API, usually ending in /v1.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="opencode-provider-key">API key variable</Label>
          <Input
            id="opencode-provider-key"
            value={provider.apiKeyEnv}
            spellCheck={false}
            autoComplete="off"
            placeholder="ACME_API_KEY"
            data-testid="opencode-provider-key"
            className="font-mono text-xs"
            onChange={(event) => patch({ apiKeyEnv: event.target.value })}
          />
          <p className="text-[11px] text-fg-subtle">
            The name of an environment variable that holds the key, not the key. Leave it empty for a server without one.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Models</Label>
        <div className={`${MODEL_COLUMNS} text-[11px] text-fg-subtle`} aria-hidden="true">
          <span>Id</span>
          <span>Name</span>
          <span className="text-right">Context</span>
          <span className="text-right">Output</span>
          <span className="text-center">Tools</span>
          <span className="text-center">Images</span>
          <span />
        </div>
        <ul className="flex flex-col gap-1.5">
          {provider.models.map((model, index) => (
            <ModelRow
              // A model has no identity until it has an id, so a row is its place in the list.
              key={index}
              model={model}
              index={index}
              providerId={provider.id}
              canRemove={provider.models.length > 1}
              onChange={(next) => setModels((models) => models.map((existing, at) => (at === index ? next : existing)))}
              onRemove={() => setModels((models) => models.filter((_, at) => at !== index))}
            />
          ))}
        </ul>
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="opencode-model-add"
            disabled={provider.models.length >= OPENCODE_CONFIG_LIMITS.models}
            onClick={() => setModels((models) => [...models, newCustomModel()])}
          >
            <Plus className="h-3.5 w-3.5" />
            Add model
          </Button>
        </div>
        <p className="text-[11px] text-fg-subtle">
          Context and output are token limits; leave them empty to let OpenCode choose. Turn off Tools for a model that cannot call tools.
        </p>
      </div>

      <div className="flex items-center justify-end gap-2">
        {problem && (
          <p data-testid="opencode-provider-problem" className="mr-auto text-[11px] text-fg-muted">
            {problem}
          </p>
        )}
        <Button type="button" variant="ghost" data-testid="opencode-provider-cancel" onClick={onCancel}>Cancel</Button>
        <Button type="submit" data-testid="opencode-provider-done" disabled={problem !== null}>
          {creating ? 'Add provider' : 'Done'}
        </Button>
      </div>
    </form>
  )
}
