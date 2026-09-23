import type { HostPlatform } from '@shared/types'
import { getKeyboardShortcutGroups } from '@/terminal/keyboard-shortcuts'

export function KeyboardShortcutsSettings({
  platform,
  escapeExitsFullscreen
}: {
  platform: HostPlatform
  escapeExitsFullscreen: boolean
}): JSX.Element {
  const groups = getKeyboardShortcutGroups(platform, escapeExitsFullscreen)

  return (
    <section
      className="space-y-4"
      aria-labelledby="keyboard-shortcuts-settings"
      data-testid="keyboard-shortcuts-settings"
    >
      <div>
        <h3
          id="keyboard-shortcuts-settings"
          className="text-xs font-semibold uppercase tracking-wide text-fg-subtle"
        >
          Keyboard shortcuts
        </h3>
        <p className="mt-1 text-xs text-fg-subtle">
          Keyboard shortcuts available in MDE and its terminal dialogs.
        </p>
      </div>

      {groups.map((group) => (
        <section key={group.id} className="space-y-2" aria-labelledby={`shortcut-group-${group.id}`}>
          <h4
            id={`shortcut-group-${group.id}`}
            className="text-xs font-medium text-fg"
          >
            {group.label}
          </h4>
          <dl className="divide-y divide-line rounded border border-line bg-panel">
            {group.shortcuts.map((shortcut) => (
              <div
                key={shortcut.id}
                data-testid={`keyboard-shortcut-row-${shortcut.id}`}
                className="grid grid-cols-[12rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-3 py-2.5"
              >
                <dt
                  data-testid={`keyboard-shortcut-keys-${shortcut.id}`}
                  className="flex flex-col items-start gap-1 text-[11px]"
                >
                  {shortcut.keys.map((key, index) => (
                    <kbd
                      key={`${key}-${index}`}
                      className="whitespace-nowrap rounded border border-line-strong bg-canvas px-1.5 py-0.5 font-mono text-fg-muted"
                    >
                      {key}
                    </kbd>
                  ))}
                </dt>
                <dd className="min-w-0 text-xs text-fg-muted">
                  {shortcut.description}
                  {shortcut.note && (
                    <span className="mt-0.5 block text-[11px] text-fg-subtle">
                      {shortcut.note}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </section>
  )
}
