import * as React from 'react'
import { cn } from '@/lib/utils'

/** The track and thumb of a switch, for a button that already carries `role="switch"`. */
export function SwitchTrack({ checked }: { checked: boolean }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-line-strong')}
    >
      <span
        className={cn(
          // `left-0` pins the thumb: without it its place follows the button's text alignment.
          'absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5'
        )}
      />
    </span>
  )
}

export interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'role'> {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

/** A bare on/off switch. Give it an `aria-label` or put it inside a labelled row. */
export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, className, disabled, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn('inline-flex shrink-0 items-center rounded-full disabled:cursor-not-allowed disabled:opacity-50', className)}
      {...props}
    >
      <SwitchTrack checked={checked} />
    </button>
  )
)
Switch.displayName = 'Switch'

/** A bordered settings row: a label and a description on the left, the switch on the right. */
export function SwitchRow({
  checked,
  label,
  description,
  testId,
  disabled,
  onClick,
}: {
  checked: boolean
  label: string
  description: string
  testId: string
  disabled?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      data-testid={testId}
      onClick={onClick}
      className="flex w-full items-center justify-between rounded border border-line bg-panel px-3 py-2 text-left text-xs text-fg-muted hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span>
        <span className="block font-medium text-fg">{label}</span>
        <span className="mt-0.5 block text-fg-subtle">{description}</span>
      </span>
      <SwitchTrack checked={checked} />
    </button>
  )
}
