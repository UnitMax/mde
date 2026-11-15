import { useState } from 'react'
import { Check, ChevronDown, Eye, FilePen, GlobeLock, LoaderCircle, Shield, ShieldOff, ShieldQuestion, type LucideIcon } from 'lucide-react'
import {
  THREAD_PERMISSION_MODE_INFO,
  threadPermissionModeInfo,
  type ThreadPermissionMode,
} from '@shared/permission-modes'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { barTrigger } from '@/components/inbox/ComposerBar'
import { HoverChevron, toolbarChip, useComposerSize } from '@/components/inbox/composer-toolbar'
import { atLeast } from '@/lib/composer-size'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { cn } from '@/lib/utils'

export const PERMISSION_MODE_ICONS: Record<ThreadPermissionMode, LucideIcon> = {
  default: Shield,
  'read-only': Eye,
  ask: ShieldQuestion,
  'auto-edit': FilePen,
  full: ShieldOff,
  'full-web-asks': GlobeLock,
}

/** The modes that let the agent act without asking wear the warning colour, wherever their icon is shown. */
export function permissionModeTone(mode: ThreadPermissionMode): string | undefined {
  return mode === 'full' || mode === 'full-web-asks' ? 'text-warn' : undefined
}

/**
 * How much a thread's agent may do without asking. On the new-thread page it is a chip of the strip under the box
 * and only picks; in a thread it sits in the box's toolbar and changes the running thread, which OpenCode applies at
 * the agent's next step. There the default mode is a quiet shield, and any other mode shows its name when there is room.
 */
export function PermissionModePicker({
  value,
  onChange,
  placement,
  running = false,
  disabled = false,
}: {
  value: ThreadPermissionMode
  /** A promise that rejects keeps the menu open with the reason, and the mode as it was. */
  onChange: (mode: ThreadPermissionMode) => void | Promise<void>
  /** `bar`: the strip under the new-thread box. `toolbar`: the box's own toolbar in a thread. */
  placement: 'bar' | 'toolbar'
  /** The agent is working: a change applies from its next step, which the menu says. */
  running?: boolean
  disabled?: boolean
}): JSX.Element {
  const size = useComposerSize()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState<ThreadPermissionMode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const active = threadPermissionModeInfo(value)
  const Icon = PERMISSION_MODE_ICONS[value]
  const tone = permissionModeTone(value)
  const label = placement === 'bar' || (value !== 'default' && atLeast(size, 'medium'))
  const description = `Permissions: ${active.label}. ${active.description}`

  const choose = (mode: ThreadPermissionMode): void => {
    if (mode === value) {
      setOpen(false)
      return
    }
    setError(null)
    const result = onChange(mode)
    if (!result) {
      setOpen(false)
      return
    }
    setSaving(mode)
    result.then(
      () => {
        setSaving(null)
        setOpen(false)
      },
      (reason: unknown) => {
        setSaving(null)
        setError(ipcErrorMessage(reason, 'the permission mode could not be changed.'))
      },
    )
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setError(null)
      }}
    >
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={description}
          title={description}
          data-testid="permission-mode-picker"
          data-mode={value}
          className={placement === 'bar'
            ? barTrigger
            : cn(toolbarChip, 'shrink-0', label ? 'px-2' : 'w-7 justify-center px-0')}
        >
          <Icon aria-hidden className={cn(placement === 'bar' ? 'h-3.5 w-3.5' : 'h-4 w-4', 'shrink-0', tone)} />
          {label && <span className="truncate">{active.label}</span>}
          {placement === 'bar'
            ? <ChevronDown aria-hidden className="h-3 w-3 shrink-0 opacity-70" />
            : label && <HoverChevron />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={placement === 'toolbar' ? 'top' : 'bottom'}
        align="start"
        sideOffset={placement === 'toolbar' ? 8 : 4}
        className="w-72"
        data-testid="permission-mode-menu"
      >
        {THREAD_PERMISSION_MODE_INFO.map(({ id, label: name, description: line }) => {
          const ItemIcon = PERMISSION_MODE_ICONS[id]
          return (
            <DropdownMenuItem
              key={id}
              data-testid={`permission-mode-${id}`}
              disabled={saving !== null}
              // The menu stays open while a thread's change is on its way, so a refusal can be read where it was made.
              onSelect={(event) => {
                event.preventDefault()
                choose(id)
              }}
              className="items-start"
            >
              {saving === id
                ? <LoaderCircle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-muted motion-safe:animate-spin" />
                : <ItemIcon aria-hidden className={cn('mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-muted', permissionModeTone(id))} />}
              <span className="min-w-0 flex-1">
                <span className="block">{name}</span>
                <span className="block text-[11px] text-fg-subtle">{line}</span>
              </span>
              {id === value && <Check aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />}
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        <p className="px-2 pb-1 pt-0.5 text-[11px] leading-snug text-fg-muted">
          Things you allowed with Always still run without asking.
          {running && ' A change applies from the agent’s next step.'}
        </p>
        {error && (
          <p role="alert" data-testid="permission-mode-error" className="px-2 pb-1 text-[11px] leading-snug text-danger">
            {error}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
