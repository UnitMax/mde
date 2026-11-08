import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { InboxFolderColor, InboxFolderIcon } from '@shared/types'
import {
  INBOX_FOLDER_COLORS,
  INBOX_FOLDER_EMOJI_MAX_LENGTH,
  INBOX_FOLDER_SYMBOLS,
  isInboxFolderEmoji,
} from '@shared/inbox-folder-icons'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { PROJECT_SYMBOLS, ProjectIcon } from '@/components/inbox/ProjectIcon'

/** A short run of emoji to start from, for projects of the usual kinds. Any other one can be typed or pasted. */
const SUGGESTED_EMOJI = [
  '📁', '🚀', '💻', '🧪', '🛠️', '🐛', '⚡', '🌐', '📦', '🎨',
  '🤖', '📱', '🎮', '🎵', '📷', '🎬', '📚', '🎓', '💼', '🏢',
  '🛒', '💡', '🔥', '🌱', '⭐', '❤️', '🔒', '🔑', '🧭', '🗺️',
  '🧩', '🎯', '🏆', '📈', '🏠', '🔧', '🧠', '✨', '🐙', '🦀',
]

type Tab = 'icons' | 'emoji'

const tile = 'flex h-7 w-7 items-center justify-center rounded-md border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/60'
const tileIdle = 'border-transparent text-fg-muted hover:bg-hover hover:text-fg'
const tileOn = 'border-accent bg-accent/15 text-fg'

/**
 * Chooses a project's picture: one of the built-in icons in a tint, or an emoji. Nothing chosen means the
 * plain folder, which is what the reset button puts back.
 */
export function ProjectIconPicker({
  value,
  onChange,
}: {
  value: InboxFolderIcon | undefined
  onChange: (icon: InboxFolderIcon | undefined) => void
}): JSX.Element {
  const [tab, setTab] = useState<Tab>(value?.kind === 'emoji' ? 'emoji' : 'icons')
  // Kept apart from the value, so a tint picked before an icon is there for the icon picked next.
  const [color, setColor] = useState<InboxFolderColor | undefined>(value?.kind === 'symbol' ? value.color : undefined)
  const [typed, setTyped] = useState(value?.kind === 'emoji' ? value.emoji : '')
  const typedText = typed.trim()
  const typedInvalid = typedText !== '' && !isInboxFolderEmoji(typedText)

  const pickSymbol = (id: (typeof INBOX_FOLDER_SYMBOLS)[number]['id']): void =>
    onChange({ kind: 'symbol', id, ...(color ? { color } : {}) })
  const pickColor = (next: InboxFolderColor | undefined): void => {
    setColor(next)
    if (value?.kind === 'symbol') onChange({ kind: 'symbol', id: value.id, ...(next ? { color: next } : {}) })
  }
  const pickEmoji = (emoji: string): void => {
    setTyped(emoji)
    onChange({ kind: 'emoji', emoji })
  }
  const typeEmoji = (text: string): void => {
    setTyped(text)
    const trimmed = text.trim()
    if (isInboxFolderEmoji(trimmed)) onChange({ kind: 'emoji', emoji: trimmed })
    else if (trimmed === '' && value?.kind === 'emoji') onChange(undefined)
  }

  return (
    <div data-testid="project-icon-picker" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span
          title="Preview"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-panel text-fg-muted"
        >
          <ProjectIcon icon={value} size="lg" />
        </span>
        <div role="tablist" aria-label="Kind of icon" className="flex gap-0.5 rounded-md bg-hover p-0.5">
          {(['icons', 'emoji'] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              data-testid={`project-icon-tab-${id}`}
              onClick={() => setTab(id)}
              className={cn(
                'h-6 rounded px-2.5 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                tab === id ? 'bg-elevated text-fg shadow-sm' : 'text-fg-muted hover:text-fg'
              )}
            >
              {id === 'icons' ? 'Icons' : 'Emoji'}
            </button>
          ))}
        </div>
        <button
          type="button"
          data-testid="project-icon-reset"
          disabled={!value}
          onClick={() => {
            onChange(undefined)
            setTyped('')
          }}
          className="ml-auto flex h-6 items-center gap-1 rounded px-1.5 text-xs text-fg-muted transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40"
        >
          <RotateCcw aria-hidden="true" className="h-3 w-3" />
          Folder icon
        </button>
      </div>

      {tab === 'icons' ? (
        <div role="tabpanel" aria-label="Icons" className="flex flex-col gap-2">
          <div role="group" aria-label="Color" className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="No color"
              title="No color"
              aria-pressed={color === undefined}
              data-testid="project-color-none"
              onClick={() => pickColor(undefined)}
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full border-2 bg-panel outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                color === undefined ? 'border-accent' : 'border-line-strong hover:border-fg-subtle'
              )}
            >
              <span aria-hidden="true" className="h-px w-3 -rotate-45 bg-fg-subtle" />
            </button>
            {INBOX_FOLDER_COLORS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-label={option.label}
                title={option.label}
                aria-pressed={color === option.id}
                data-testid={`project-color-${option.id}`}
                onClick={() => pickColor(option.id)}
                style={{ backgroundColor: option.hex }}
                className={cn(
                  'h-5 w-5 rounded-full border-2 outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                  color === option.id ? 'border-fg' : 'border-transparent hover:border-fg-subtle'
                )}
              />
            ))}
          </div>
          <div className="flex max-h-44 flex-wrap gap-0.5 overflow-y-auto pr-1">
            {INBOX_FOLDER_SYMBOLS.map((option) => {
              const Picture = PROJECT_SYMBOLS[option.id]
              const on = value?.kind === 'symbol' && value.id === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-label={option.label}
                  title={option.label}
                  aria-pressed={on}
                  data-testid={`project-symbol-${option.id}`}
                  onClick={() => pickSymbol(option.id)}
                  className={cn(tile, on ? tileOn : tileIdle)}
                >
                  <Picture
                    aria-hidden="true"
                    className="h-4 w-4"
                    {...(color ? { style: { color: INBOX_FOLDER_COLORS.find((item) => item.id === color)?.hex } } : {})}
                  />
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <div role="tabpanel" aria-label="Emoji" className="flex flex-col gap-2">
          <Input
            aria-label="Emoji"
            data-testid="project-emoji-input"
            value={typed}
            maxLength={INBOX_FOLDER_EMOJI_MAX_LENGTH}
            placeholder="Type or paste an emoji"
            aria-invalid={typedInvalid || undefined}
            onChange={(event) => typeEmoji(event.target.value)}
            className="h-8 text-sm"
          />
          {typedInvalid && (
            <p role="status" className="text-[11px] text-danger">Use a single emoji.</p>
          )}
          <div className="flex flex-wrap gap-0.5">
            {SUGGESTED_EMOJI.map((emoji) => {
              const on = value?.kind === 'emoji' && value.emoji === emoji
              return (
                <button
                  key={emoji}
                  type="button"
                  aria-label={`Emoji ${emoji}`}
                  aria-pressed={on}
                  onClick={() => pickEmoji(emoji)}
                  className={cn(tile, 'text-base leading-none', on ? tileOn : tileIdle)}
                >
                  {emoji}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
