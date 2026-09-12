export function TerminalFullscreenIndicator({
  isFullscreen
}: {
  isFullscreen: boolean
}): JSX.Element | null {
  if (!isFullscreen) return null

  return (
    <span
      role="status"
      aria-label="Terminal is in fullscreen"
      data-testid="terminal-fullscreen-indicator"
      title="Terminal is in fullscreen"
      className="inline-flex shrink-0 items-center rounded-sm border border-accent/30 bg-accent/10 px-1 py-0.5 text-[10px] font-medium leading-none text-accent"
    >
      Fullscreen
    </span>
  )
}
