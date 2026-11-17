import { opText, type CommandView, type Place } from '@/lib/shell-command'
import { cn } from '@/lib/utils'

function placeTitle(place: Place): string {
  if (place.status === 'inside') return `Ran in ${place.shown}, inside the thread's folder`
  if (place.status === 'outside') return `Ran in ${place.shown}, outside the thread's folder`
  return `Ran after cd ${place.shown}; MDE cannot tell which folder that is`
}

/** Where a command ran when that is not the thread's own folder; marked when it is outside it or cannot be told. */
export function PlaceChip({ place, className }: { place: Place; className?: string }): JSX.Element {
  const away = place.status !== 'inside'
  return (
    <span
      data-testid="shell-place"
      data-status={place.status}
      title={placeTitle(place)}
      className={cn(
        'inline-block max-w-[14rem] shrink-0 truncate rounded px-1 align-baseline text-[10.5px] leading-4',
        away ? 'bg-warn/15 text-warn' : 'bg-fg/[0.06] text-fg-subtle',
        className,
      )}
    >
      in {place.shown}
    </span>
  )
}

const away = (place: Place | undefined): boolean => place !== undefined && place.status !== 'inside'

/**
 * A shell command as its steps (`cd app && npm test` is `npm test`, in `app`): stacked one per line for the Tools tab,
 * where a row may grow, or on one line for the chat, joined by their operators. A `cd` among the steps that leaves the
 * thread's folder is marked like the place.
 */
export function ShellSteps({
  view,
  stacked = false,
  max = 3,
  className,
}: {
  view: CommandView
  stacked?: boolean
  /** Stacked: how many steps to show before "+N more"; one more is shown rather than "+1 more". */
  max?: number
  className?: string
}): JSX.Element {
  const { place, steps } = view
  if (!stacked) {
    return (
      <span data-testid="shell-steps" className={cn('min-w-0', className)}>
        {place && <PlaceChip place={place} className="mr-1.5" />}
        {steps.map((step, index) => (
          <span key={index} className={cn(away(step.place) && 'text-warn')}>
            {index > 0 && <span className="opacity-50">{step.op === 'newline' ? ' ; ' : ` ${opText(step.op)} `}</span>}
            {step.text}
            {step.cut && <span className="opacity-50"> …</span>}
          </span>
        ))}
      </span>
    )
  }
  const shown = steps.length <= max + 1 ? steps : steps.slice(0, max)
  const rest = steps.length - shown.length
  return (
    <span data-testid="shell-steps" className={cn('flex min-w-0 flex-col', className)}>
      {/* The place has its own line, so that it never takes the room a step needs: `git push --force` must show whole. */}
      {place && <span className="flex min-w-0"><PlaceChip place={place} className="max-w-full" /></span>}
      {shown.map((step, index) => (
        <span key={index} data-testid="shell-step" className="flex min-w-0 items-baseline gap-1.5">
          {index > 0 && <span aria-hidden className="w-[2ch] shrink-0 text-right opacity-50">{opText(step.op)}</span>}
          {/* A long step wraps to a second line before it is cut. */}
          <span className={cn('line-clamp-2 min-w-0 [overflow-wrap:anywhere]', away(step.place) && 'text-warn')}>
            {step.text}
            {step.cut && <span className="opacity-50"> …</span>}
          </span>
        </span>
      ))}
      {rest > 0 && (
        <span className="flex min-w-0 items-baseline gap-1.5">
          {steps.length > 1 && <span aria-hidden className="w-[2ch] shrink-0" />}
          <span className="text-[10.5px] opacity-60">+{rest} more</span>
        </span>
      )}
    </span>
  )
}
