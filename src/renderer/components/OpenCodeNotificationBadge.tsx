import { cn } from '@/lib/utils'

export function OpenCodeNotificationBadge({
  count,
  providerLabel = 'OpenCode',
  className
}: {
  count: number
  providerLabel?: string
  className?: string
}): JSX.Element | null {
  if (count <= 0) return null

  const label = `${count} ${providerLabel} agent${count === 1 ? '' : 's'} finished or need attention`

  return (
    <span
      data-testid="opencode-notification-count"
      aria-label={label}
      title={label}
      className={cn(
        'flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-medium leading-none text-accent-fg',
        className
      )}
    >
      {count}
    </span>
  )
}
