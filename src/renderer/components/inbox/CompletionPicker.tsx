import { useEffect, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface CompletionItem {
  key: string
  /** What the choice writes into the box, as it is written: `$deploy`, `/btw`. */
  label: string
  /** What may follow it, shown softly after the label: the argument of a command. */
  hint?: string
  description?: string
  icon?: ReactNode
  testId: string
}

/**
 * A list of what fits the word being typed in the message box, shown above the box: the skills after a `$`,
 * the commands after a `/`. It never takes focus (the caret stays in the text), so the box handles the
 * keys and tells the list which row is active.
 */
export function CompletionPicker({
  id,
  label,
  testId,
  heading,
  items,
  active,
  onActive,
  onPick,
}: {
  id: string
  /** The list's accessible name. */
  label: string
  testId: string
  /** A caption above the rows, for a list that is not obvious from what was typed. */
  heading?: string
  items: readonly CompletionItem[]
  active: number
  onActive: (index: number) => void
  onPick: (index: number) => void
}): JSX.Element {
  useEffect(() => {
    document.getElementById(`${id}-${active}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [id, active])
  return (
    <div
      id={id}
      role="listbox"
      aria-label={label}
      data-testid={testId}
      className="absolute inset-x-0 bottom-full z-30 mb-1.5 max-h-64 overflow-y-auto rounded-xl border border-line-strong bg-elevated p-1 shadow-lg shadow-shade/30"
    >
      {heading && <p aria-hidden className="px-2.5 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">{heading}</p>}
      {items.map((item, index) => (
        <div
          key={item.key}
          id={`${id}-${index}`}
          role="option"
          aria-selected={index === active}
          data-testid={item.testId}
          // Keeps the caret in the text: a click on the list must not move focus out of the box.
          onMouseDown={(event) => event.preventDefault()}
          onMouseMove={() => { if (index !== active) onActive(index) }}
          onClick={() => onPick(index)}
          className={cn('flex min-w-0 cursor-pointer items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-[13px]', index === active ? 'bg-active' : 'hover:bg-hover')}
        >
          {item.icon && <span className="flex shrink-0 translate-y-0.5 items-center text-fg-muted">{item.icon}</span>}
          <span className="shrink-0 font-medium text-fg">{item.label}</span>
          {item.hint && <span className="shrink-0 text-[12px] text-fg-subtle">{item.hint}</span>}
          {item.description && <span className="min-w-0 truncate text-[12px] text-fg-muted">{item.description}</span>}
        </div>
      ))}
    </div>
  )
}
