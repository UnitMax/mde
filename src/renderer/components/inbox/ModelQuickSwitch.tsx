import { Star } from 'lucide-react'
import type { ChatModel, OpenCodeModelRef } from '@shared/types'
import { modelKey } from '@/lib/chat'
import { quickSwitchModels, switchedModel } from '@/lib/model-quick-switch'
import { cn } from '@/lib/utils'
import { useInboxView } from '@/store/inbox-view'
import { useModelFavorites } from '@/store/model-favorites'

/**
 * A row of the tray above the message box with up to five favorite models, one click each: the model in use is the
 * lit one, and clicking another makes the next message use it. Favorites are starred in the model menu. Nothing is
 * drawn while there are none, or none the place offers, or while the Inbox setting for it is off.
 */
export function ModelQuickSwitch({
  models,
  value,
  onChange,
  disabled,
}: {
  models: readonly ChatModel[]
  value: OpenCodeModelRef | null
  onChange: (model: OpenCodeModelRef) => void
  disabled?: boolean
}): JSX.Element | null {
  const favorites = useModelFavorites((state) => state.favorites)
  const enabled = useInboxView((state) => state.modelQuickSwitch)
  const shown = quickSwitchModels(models, favorites, value)
  if (!enabled || shown.length === 0) return null
  return (
    <div data-testid="model-quick-switch" role="group" aria-label="Switch model" className="flex min-w-0 items-center gap-1 px-1.5 py-1">
      <span
        aria-hidden="true"
        title="Your favorite models. Star more in the model menu."
        className="flex h-6 w-6 shrink-0 items-center justify-center text-accent"
      >
        <Star className="h-3 w-3 fill-current" />
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {shown.map((model) => {
          const active = value !== null && modelKey(model) === modelKey(value)
          return (
            <button
              key={modelKey(model)}
              type="button"
              data-testid={`model-quick-switch-${modelKey(model)}`}
              aria-pressed={active}
              disabled={disabled}
              title={`${model.providerName} / ${model.name}`}
              onClick={() => { if (!active) onChange(switchedModel(model, value)) }}
              className={cn(
                'h-6 max-w-[14rem] truncate rounded-md border px-2 text-[12px] transition-colors disabled:pointer-events-none disabled:opacity-50',
                active
                  ? 'border-accent/50 bg-accent/10 text-fg'
                  : 'border-transparent text-fg-muted hover:bg-hover hover:text-fg'
              )}
            >
              {model.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}
