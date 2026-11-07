import { useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Search, Sparkles } from 'lucide-react'
import type { ChatModel, OpenCodeModelRef } from '@shared/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { findModel, groupModels, modelKey, modelName, modelVariantLabel } from '@/lib/chat'
import { cn } from '@/lib/utils'

/** Model and effort share one menu; browsing models never changes the current choice. */
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
  const [browsed, setBrowsed] = useState<string | null>(null)
  const effortRef = useRef<HTMLDivElement>(null)
  const modelListRef = useRef<HTMLDivElement>(null)
  const groups = useMemo(() => groupModels(models, query), [models, query])
  const current = findModel(models, value)
  const visible = groups.flatMap((group) => group.models)
  const preview = visible.find((model) => modelKey(model) === browsed)
    ?? visible.find((model) => model.id === value?.id && model.providerId === value.providerId)
    ?? visible[0]
  const hasEfforts = models.some((model) => model.variants?.length)
  const previewSelected = preview?.id === value?.id && preview?.providerId === value?.providerId
  const selectedVariant = previewSelected ? JSON.stringify(value?.variant ?? null) : ''

  const choose = (model: ChatModel, variant?: string): void => {
    onChange({ id: model.id, providerId: model.providerId, ...(variant ? { variant } : {}) })
  }

  return (
    <DropdownMenu open={open} onOpenChange={(next) => {
      setOpen(next)
      if (!next) { setQuery(''); setBrowsed(null) }
    }}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          className="flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-fg-muted transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-hover data-[state=open]:text-fg"
          aria-label="Model"
          data-testid="chat-model-picker"
          title={value ? `${modelKey(value)}${value.variant ? `#${value.variant}` : ''}` : undefined}
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="max-w-[16rem] truncate">
            {value && <span className="text-fg-subtle">{current?.providerName ?? value.providerId} / </span>}
            {modelName(models, value)}
          </span>
          {value?.variant && (
            <span className="max-w-28 truncate rounded border border-line-strong px-1.5 py-0.5 text-[10px] leading-none text-fg-muted" data-testid="chat-model-effort">
              {modelVariantLabel(value.variant)}
            </span>
          )}
          <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={cn('flex max-h-[var(--radix-dropdown-menu-content-available-height)] w-80 max-w-[calc(100vw-2rem)] flex-col p-0', hasEfforts && 'w-[520px]')} data-testid="chat-model-menu">
        <div className="relative shrink-0 border-b border-line p-1.5">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" />
          <input
            autoFocus
            aria-label="Search models"
            placeholder="Search models"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setBrowsed(null) }}
            // Typing belongs to the field, rather than the menu's type-ahead.
            onKeyDown={(event) => {
              if (event.key !== 'Escape' && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') event.stopPropagation()
            }}
            className="h-7 w-full rounded bg-panel pl-7 pr-2 text-xs text-fg outline-none placeholder:text-fg-subtle"
          />
        </div>
        <div className={cn('min-h-0 overflow-y-auto', hasEfforts && 'grid grid-cols-[minmax(0,1fr)_180px] max-[480px]:grid-cols-1')}>
          <div ref={modelListRef} className="max-h-80 overflow-y-auto p-1" data-testid="chat-model-list">
            {groups.length === 0 && <p className="px-2 py-1.5 text-xs text-fg-subtle">No models match.</p>}
            {groups.map((group) => (
              <div key={group.providerId} role="group" aria-label={group.providerName}>
                <p className="px-2 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                  {group.providerName}
                </p>
                {group.models.map((model) => {
                  const selected = model.id === value?.id && model.providerId === value.providerId
                  return (
                    <DropdownMenuItem
                      key={modelKey(model)}
                      onFocus={() => setBrowsed(modelKey(model))}
                      onPointerMove={() => setBrowsed(modelKey(model))}
                      onKeyDown={(event) => {
                        if (event.key !== 'ArrowRight' || !model.variants?.length) return
                        event.preventDefault()
                        event.stopPropagation()
                        effortRef.current?.querySelector<HTMLElement>('[role="menuitemradio"]')?.focus()
                      }}
                      onSelect={(event) => {
                        choose(model, selected && model.variants?.includes(value?.variant ?? '') ? value?.variant : undefined)
                        if (model.variants?.length) event.preventDefault()
                      }}
                      className={cn('gap-1.5 text-xs', preview && modelKey(preview) === modelKey(model) && 'bg-hover')}
                      title={modelKey(model)}
                      data-model-key={modelKey(model)}
                    >
                      <span className="min-w-0 flex-1 truncate">{model.name}</span>
                      {selected && <Check className="h-3 w-3 shrink-0 text-accent" aria-hidden="true" />}
                      {Boolean(model.variants?.length) && <ChevronRight className="h-3 w-3 shrink-0 text-fg-subtle" aria-hidden="true" />}
                    </DropdownMenuItem>
                  )
                })}
              </div>
            ))}
          </div>
          {hasEfforts && (
            <div
              ref={effortRef}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' || !preview) return
                event.preventDefault()
                event.stopPropagation()
                Array.from(modelListRef.current?.querySelectorAll<HTMLElement>('[data-model-key]') ?? [])
                  .find((item) => item.dataset.modelKey === modelKey(preview))?.focus()
              }}
              className="min-w-0 border-l border-line bg-panel/40 p-1 max-[480px]:border-l-0 max-[480px]:border-t"
              data-testid="chat-model-reasoning"
            >
              <div className="px-2 pb-2 pt-1.5">
                <p className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">Reasoning effort</p>
                <p className="mt-1 truncate text-xs text-fg-muted" title={preview?.name}>{preview?.name ?? 'Choose a model'}</p>
              </div>
              {preview?.variants?.length ? (
                <DropdownMenuRadioGroup value={selectedVariant} aria-label={`Reasoning effort for ${preview.name}`} className="max-h-64 overflow-y-auto">
                  <DropdownMenuRadioItem value="null" onSelect={() => choose(preview)} className="items-start text-xs">
                    <span>Default<span className="mt-0.5 block text-[10px] text-fg-subtle">Use model settings</span></span>
                  </DropdownMenuRadioItem>
                  <div className="mx-2 my-1 h-px bg-line" />
                  {preview.variants.map((variant) => (
                    <DropdownMenuRadioItem key={variant} value={JSON.stringify(variant)} onSelect={() => choose(preview, variant)} title={variant} className="text-xs">
                      <span className="truncate">{modelVariantLabel(variant)}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              ) : (
                <p className="px-2 pb-3 text-[11px] leading-relaxed text-fg-subtle">
                  {preview ? 'Uses model defaults.' : 'Search for another model.'}
                </p>
              )}
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
