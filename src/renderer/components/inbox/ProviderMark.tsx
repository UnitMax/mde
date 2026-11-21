import type { CSSProperties } from 'react'
import { providerHue, providerInitials } from '@/lib/provider-mark'
import { cn } from '@/lib/utils'

/** A provider's lettered badge. The name itself is left to the surrounding control's label or tooltip. */
export function ProviderMark({ name, className }: { name: string; className?: string }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      data-testid="provider-mark"
      className={cn('provider-mark', className)}
      style={{ '--provider-hue': providerHue(name) } as CSSProperties}
    >
      {providerInitials(name)}
    </span>
  )
}
