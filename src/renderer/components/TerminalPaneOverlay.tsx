export function TerminalPaneOverlay({
  visible,
  number,
  active,
  isFullscreen
}: {
  visible: boolean
  /** The pane's Ctrl+Shift+<number> shortcut, or null when number switching is unavailable. */
  number: number | null
  active: boolean
  isFullscreen: boolean
}): JSX.Element | null {
  if (!visible || (number === null && !active)) return null

  return (
    <div
      aria-hidden="true"
      data-testid="terminal-pane-overlay"
      className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-bg/40"
    >
      {number !== null && (
        <span
          data-testid="terminal-pane-overlay-number"
          className={
            active
              ? 'min-w-16 rounded-lg border border-accent bg-panel/95 px-4 py-2 text-center text-4xl font-semibold leading-none text-accent shadow-lg'
              : 'min-w-16 rounded-lg border border-line-strong bg-panel/95 px-4 py-2 text-center text-4xl font-semibold leading-none text-fg shadow-lg'
          }
        >
          {number}
        </span>
      )}
      {active && (
        <span
          data-testid="terminal-pane-overlay-fullscreen"
          className="rounded-md border border-accent/40 bg-panel/95 px-2 py-1 text-xs font-medium text-accent shadow"
        >
          {`Ctrl+Shift+F · ${isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}`}
        </span>
      )}
    </div>
  )
}
