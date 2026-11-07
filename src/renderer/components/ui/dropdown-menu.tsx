import * as React from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export const DropdownMenu = DropdownMenuPrimitive.Root
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

export const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 min-w-[10rem] overflow-hidden rounded-md border border-line-strong bg-elevated p-1',
        'shadow-xl shadow-black/50 [animation:mde-menu-in_90ms_ease-out]',
        className
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
))
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

export const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      'flex cursor-default select-none items-center gap-2 rounded px-2 py-1.5 text-[13px] text-fg outline-none',
      'data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
      className
    )}
    {...props}
  />
))
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

export function DropdownMenuSeparator({ className }: { className?: string }): JSX.Element {
  return <DropdownMenuPrimitive.Separator className={cn('my-1 h-px bg-line', className)} />
}

export const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      'relative flex cursor-default select-none items-start gap-2 rounded py-1.5 pl-7 pr-2 text-[13px] text-fg outline-none',
      'data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
      className
    )}
    {...props}
  >
    <span className="absolute left-2 top-[9px] flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
))
DropdownMenuCheckboxItem.displayName = DropdownMenuPrimitive.CheckboxItem.displayName

export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

/** One choice of several, with the check where the checkbox items have it. */
export const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      'relative flex cursor-default select-none items-center gap-2 rounded py-1.5 pl-7 pr-2 text-[13px] text-fg outline-none',
      'data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
))
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName

/**
 * A menu row that is an on/off switch. It is a checkbox item, so it is announced as a menu item that is checked or
 * not, and the arrow keys, Space and Enter work as in any menu; the switch drawn on the right is decoration. Choosing
 * it does not close the menu, so several rows can be switched in a row. `trailing` replaces the switch, e.g. by a
 * spinner while the change is made.
 */
export const DropdownMenuSwitchItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem> & { trailing?: React.ReactNode }
>(({ className, children, checked, onSelect, trailing, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    checked={checked}
    onSelect={(event) => {
      event.preventDefault()
      onSelect?.(event)
    }}
    className={cn(
      'flex cursor-default select-none items-center gap-2.5 rounded px-2 py-1.5 text-[13px] text-fg outline-none',
      'data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-60',
      className
    )}
    {...props}
  >
    {children}
    {trailing ?? (
      <span
        aria-hidden="true"
        className={cn('relative h-4 w-7 shrink-0 rounded-full transition-colors', checked === true ? 'bg-accent' : 'bg-line-strong')}
      >
        <span
          className={cn(
            'absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none',
            checked === true && 'translate-x-3'
          )}
        />
      </span>
    )}
  </DropdownMenuPrimitive.CheckboxItem>
))
DropdownMenuSwitchItem.displayName = 'DropdownMenuSwitchItem'

export const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn('px-2 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-fg-subtle', className)}
    {...props}
  />
))
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName
