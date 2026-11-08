import { useState } from 'react'
import type { HostPlatform } from '@shared/types'
import {
  formatShortcutKey,
  getKeyboardShortcutGroups,
  LIST_KEYS_NOTE,
  type KeyboardShortcutEntry
} from '@/terminal/keyboard-shortcuts'

function matches(shortcut: KeyboardShortcutEntry, words: readonly string[], platform: HostPlatform): boolean {
  if (words.length === 0) return true
  const text = [
    ...shortcut.keys,
    ...shortcut.keys.map((key) => formatShortcutKey(key, platform)),
    shortcut.description,
    shortcut.note ?? ''
  ].join(' ').toLowerCase()
  return words.every((word) => text.includes(word))
}

export function KeyboardShortcutsSettings({
  platform,
  escapeExitsFullscreen
}: {
  platform: HostPlatform
  escapeExitsFullscreen: boolean
}): JSX.Element {
  const [query, setQuery] = useState('')
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const groups = getKeyboardShortcutGroups(platform, escapeExitsFullscreen)
    .map((group) => ({ ...group, shortcuts: group.shortcuts.filter((shortcut) => matches(shortcut, words, platform)) }))
    .filter((group) => group.shortcuts.length > 0)

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
        <p className="mt-1 text-xs text-fg-subtle">{LIST_KEYS_NOTE}</p>
      </div>

      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search shortcuts"
        aria-label="Search shortcuts"
        data-testid="keyboard-shortcuts-search"
        className="w-full rounded border border-line bg-canvas px-2.5 py-1.5 text-xs text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
      />

      {groups.length === 0 && (
        <p className="text-xs text-fg-subtle" data-testid="keyboard-shortcuts-empty">
          No shortcut matches “{query.trim()}”.
        </p>
      )}

      {groups.map((group) => (
        <section key={group.id} className="space-y-2" aria-labelledby={`shortcut-group-${group.id}`}>
          <div className="flex items-baseline justify-between gap-3">
            <h4 id={`shortcut-group-${group.id}`} className="text-xs font-medium text-fg">
              {group.label}
            </h4>
            <span className="text-[11px] text-fg-subtle">{group.where}</span>
          </div>
          <dl className="divide-y divide-line rounded border border-line bg-panel">
            {group.shortcuts.map((shortcut) => (
              <div
                key={shortcut.id}
                data-testid={`keyboard-shortcut-row-${shortcut.id}`}
                className="grid grid-cols-[12rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-3 py-2"
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
                      {formatShortcutKey(key, platform)}
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
