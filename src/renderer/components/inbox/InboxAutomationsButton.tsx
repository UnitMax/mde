import { useEffect } from 'react'
import { CalendarClock } from 'lucide-react'
import { useInboxAutomations } from '@/store/inbox-automations'

/** A calendar clock next to the usage button, which opens the automations. A dot on it says that some are on. */
export function InboxAutomationsButton(): JSX.Element {
  const load = useInboxAutomations((state) => state.load)
  const openManager = useInboxAutomations((state) => state.openManager)
  const active = useInboxAutomations((state) => state.automations.filter((item) => item.enabled).length)
  useEffect(() => { void load() }, [load])
  const label = active === 0 ? 'Automations' : `Automations (${active} on)`
  return (
    <button
      type="button"
      data-testid="inbox-automations-button"
      data-active={active > 0 ? active : undefined}
      aria-label={label}
      title={label}
      onClick={() => openManager()}
      className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
    >
      <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
      {active > 0 && <span aria-hidden className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-accent" />}
    </button>
  )
}
