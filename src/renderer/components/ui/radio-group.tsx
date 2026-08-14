import * as React from 'react'
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import { cn } from '@/lib/utils'

export const RadioGroup = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Root ref={ref} className={cn('flex gap-2', className)} {...props} />
))
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName

/**
 * Rendered as a segmented control rather than a dot: it reads better at this
 * density and there are only ever two options.
 */
export const RadioGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <RadioGroupPrimitive.Item
    ref={ref}
    className={cn(
      'flex h-8 flex-1 items-center justify-center gap-1.5 rounded border border-line-strong',
      'bg-bg text-[13px] text-fg-muted transition-colors hover:text-fg',
      'data-[state=checked]:border-accent data-[state=checked]:bg-accent/15 data-[state=checked]:text-fg',
      className
    )}
    {...props}
  >
    {children}
  </RadioGroupPrimitive.Item>
))
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName
