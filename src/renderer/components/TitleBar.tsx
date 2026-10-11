import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/store/workspace'

/** Clears the macOS traffic lights, which the OS draws inside the left of the bar. */
const TRAFFIC_LIGHT_INSET_PX = 78

/**
 * Replaces the hidden OS title bar and is the window's drag handle. On Windows and Linux the
 * OS still draws the minimize / maximize / close buttons over the right edge, so the content is
 * confined to the overlay-safe rectangle. The height must match `TITLE_BAR_HEIGHT` in
 * `src/main/window-chrome.ts`, which sizes those native buttons.
 */
export function TitleBar({
  icon,
  title,
  children
}: {
  icon?: ReactNode
  title: ReactNode
  /** Right-aligned actions; wrap each in TitleBarButton so it can receive clicks. */
  children?: ReactNode
}): JSX.Element {
  const isMac = useWorkspace((state) => state.platform?.platform === 'darwin')

  return (
    <header
      data-testid="title-bar"
      className="app-drag flex h-8 w-full shrink-0 items-center border-b border-line bg-panel"
    >
      <div
        data-testid="title-bar-content"
        className="title-bar-content flex h-full min-w-0 items-center gap-2 px-2.5"
        style={isMac ? { paddingLeft: TRAFFIC_LIGHT_INSET_PX } : undefined}
      >
        {icon}
        <div className="flex min-w-0 flex-1 items-center gap-2 truncate text-[12px] font-medium text-fg-muted">
          {title}
        </div>
        {children && <div className="flex shrink-0 items-center gap-0.5">{children}</div>}
      </div>
    </header>
  )
}

export function TitleBarButton({
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return (
    <button
      type={type}
      className={cn(
        'app-no-drag flex h-6 items-center gap-1 rounded px-1.5 text-fg-muted hover:bg-hover hover:text-fg',
        className
      )}
      {...props}
    />
  )
}
