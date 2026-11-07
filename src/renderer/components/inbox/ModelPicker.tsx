import { useMemo, useRef, useState } from 'react'
import { Check, ChevronRight, Search, Sparkles, Star } from 'lucide-react'
import type { ChatModel, OpenCodeModelRef } from '@shared/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSwitchItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { HoverChevron, toolbarChip, useComposerSize, useComposerWidth } from '@/components/inbox/composer-toolbar'
import { findModel, groupModels, modelKey, modelName, modelVariantLabel } from '@/lib/chat'
import { atLeast, providerFits } from '@/lib/composer-size'
import { quietCloseFocus } from '@/lib/input-modality'
import { cn } from '@/lib/utils'
import { useModelFavorites } from '@/store/model-favorites'

/** Model and effort share one menu; browsing models never changes the current choice. */
export function ModelPicker({
  models,
  value,
  onChange,
  onMenuClosed,
  disabled,
}: {
  models: ChatModel[]
  value: OpenCodeModelRef | null
  onChange: (model: OpenCodeModelRef) => void
  /** After a selection closes the menu, return focus to the composer's message input. */
  onMenuClosed?: () => void
  disabled?: boolean
}): JSX.Element {
  const size = useComposerSize()
  const width = useComposerWidth()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [browsed, setBrowsed] = useState<string | null>(null)
  const effortRef = useRef<HTMLDivElement>(null)
  const modelListRef = useRef<HTMLDivElement>(null)
  const selectedInMenu = useRef(false)
  const favorites = useModelFavorites((state) => state.favorites)
  const toggleFavorite = useModelFavorites((state) => state.toggle)
  const favoriteKeys = useMemo(() => new Set(favorites.map(modelKey)), [favorites])
  const groups = useMemo(() => {
    const providers = groupModels(models, query)
    const starred = providers.flatMap((group) => group.models).filter((model) => favoriteKeys.has(modelKey(model)))
      .sort((a, b) => a.name.localeCompare(b.name) || a.providerName.localeCompare(b.providerName))
    return [
      ...(starred.length ? [{ key: 'favorites', label: 'Favorites', favorite: true, models: starred }] : []),
      ...providers.map((group) => ({
        key: `provider:${group.providerId}`, label: group.providerName, favorite: false,
        models: group.models.filter((model) => !favoriteKeys.has(modelKey(model))),
      })).filter((group) => group.models.length > 0),
    ]
  }, [models, query, favoriteKeys])
  const current = findModel(models, value)
  const visible = groups.flatMap((group) => group.models)
  const preview = visible.find((model) => modelKey(model) === browsed)
    ?? visible.find((model) => model.id === value?.id && model.providerId === value.providerId)
    ?? visible[0]
  const name = modelName(models, value)
  const effort = value?.variant ? modelVariantLabel(value.variant) : null
  const provider = current?.providerName ?? value?.providerId ?? ''
  const showEffort = Boolean(effort) && atLeast(size, 'narrow')
  const showProvider = Boolean(value) && size === 'wide' && providerFits(name, effort, provider, width)
  const hasEfforts = models.some((model) => model.variants?.length)
  const previewSelected = preview?.id === value?.id && preview?.providerId === value?.providerId
  const selectedVariant = previewSelected ? JSON.stringify(value?.variant ?? null) : ''

  const choose = (model: ChatModel, variant?: string): void => {
    selectedInMenu.current = true
    onChange({ id: model.id, providerId: model.providerId, ...(variant ? { variant } : {}) })
  }

  const star = (model: ChatModel): void => {
    toggleFavorite(model)
    // The row moves between sections. Keep keyboard focus on its star in the new position.
    window.requestAnimationFrame(() => {
      Array.from(modelListRef.current?.querySelectorAll<HTMLElement>('[data-favorite-key]') ?? [])
        .find((item) => item.dataset.favoriteKey === modelKey(model))?.focus()
    })
  }

  return (
    <DropdownMenu open={open} onOpenChange={(next) => {
      setOpen(next)
      if (next) selectedInMenu.current = false
      if (!next) { setQuery(''); setBrowsed(null) }
    }}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(toolbarChip, 'shrink', atLeast(size, 'medium') && 'pr-1.5')}
          aria-label="Model"
          data-testid="chat-model-picker"
          title={value ? `${modelKey(value)}${value.variant ? `#${value.variant}` : ''}` : undefined}
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" />
          {/* One line in one size: the provider in front and the effort behind are the same quiet tone, the name is the one that reads. */}
          <span className="flex min-w-0 items-baseline gap-1">
            {showProvider && <span className="shrink-0 text-fg-subtle" data-testid="chat-model-provider">{provider} /</span>}
            {/* Short names keep their own width; a long one gives way, but not below a few letters. */}
            <span className="max-w-[16rem] truncate" style={{ minWidth: `${Math.min(name.length, 5)}ch` }}>{name}</span>
            {showEffort && (
              <>
                <span aria-hidden="true" className="shrink-0 text-fg-subtle">·</span>
                <span className="max-w-28 shrink-0 truncate text-fg-subtle" data-testid="chat-model-effort">{effort}</span>
              </>
            )}
          </span>
          {atLeast(size, 'medium') && <HoverChevron />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        onInteractOutside={() => { selectedInMenu.current = false }}
        onCloseAutoFocus={(event) => {
          if (selectedInMenu.current && onMenuClosed) {
            event.preventDefault()
            onMenuClosed()
            return
          }
          quietCloseFocus(event)
        }}
        className={cn('flex max-h-[var(--radix-dropdown-menu-content-available-height)] w-80 max-w-[calc(100vw-2rem)] flex-col p-0', hasEfforts && 'w-[520px]')}
        data-testid="chat-model-menu"
      >
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
              <div key={group.key} role="group" aria-label={group.label} className={cn(group.favorite && 'mb-1 border-b border-line pb-1')}>
                <p className="flex items-center gap-1.5 px-2 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                  {group.favorite && <Star className="h-2.5 w-2.5 fill-current text-accent" aria-hidden="true" />}
                  {group.label}
                </p>
                {group.models.map((model) => {
                  const selected = model.id === value?.id && model.providerId === value.providerId
                  const starred = favoriteKeys.has(modelKey(model))
                  return (
                    <div key={modelKey(model)} className={cn('group/model flex items-center rounded', preview && modelKey(preview) === modelKey(model) && 'bg-hover')}>
                      <DropdownMenuItem
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
                        className="min-w-0 flex-1 gap-1.5 text-xs"
                        title={modelKey(model)}
                        aria-label={group.favorite ? `${model.name} (${model.providerName})` : undefined}
                        data-model-key={modelKey(model)}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {model.name}
                          {group.favorite && <span className="ml-1.5 text-[10px] text-fg-subtle">{model.providerName}</span>}
                        </span>
                        {selected && <Check className="h-3 w-3 shrink-0 text-accent" aria-hidden="true" />}
                        {Boolean(model.variants?.length) && <ChevronRight className="h-3 w-3 shrink-0 text-fg-subtle" aria-hidden="true" />}
                      </DropdownMenuItem>
                      <DropdownMenuSwitchItem
                        checked={starred}
                        onCheckedChange={() => star(model)}
                        onFocus={() => setBrowsed(modelKey(model))}
                        onPointerMove={() => setBrowsed(modelKey(model))}
                        aria-label={`${starred ? 'Unstar' : 'Star'} ${model.name} (${model.providerName})`}
                        title={starred ? 'Remove from favorites' : 'Add to favorites'}
                        data-favorite-key={modelKey(model)}
                        className={cn('h-7 w-7 shrink-0 justify-center gap-0 p-0',
                          starred ? 'text-accent' : 'text-fg-subtle opacity-0 group-hover/model:opacity-100 group-focus-within/model:opacity-100 [@media(hover:none)]:opacity-100')}
                        trailing={<Star className={cn('h-3.5 w-3.5', starred && 'fill-current')} aria-hidden="true" />}
                      />
                    </div>
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
