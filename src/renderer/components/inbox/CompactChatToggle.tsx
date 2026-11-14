import { List, ListCollapse, TextQuote, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useInboxView } from '@/store/inbox-view'

/** How a chat conversation is laid out: every step, compact, or compact with the text between the steps. */
export type ChatLayout = 'full' | 'compact' | 'compact-text'

const LAYOUTS: ReadonlyArray<{ value: ChatLayout; label: string; detail: string; icon: LucideIcon }> = [
  { value: 'full', label: 'Every step', detail: 'Each thought and tool call is a row of its own.', icon: List },
  {
    value: 'compact',
    label: 'Compact',
    detail: 'Each stretch of work is one line; the answer and the words before a question are shown.',
    icon: ListCollapse,
  },
  {
    value: 'compact-text',
    label: 'Compact with text',
    detail: 'Everything the model writes is shown; thinking and tool calls still fold into lines.',
    icon: TextQuote,
  },
]

/**
 * Chooses how the conversation is laid out, in the thread's header. Both compact layouts fold thoughts and tool calls
 * (commands, reads, searches, file changes) into one line per stretch of work and start file changes shut; plain
 * compact folds the words the model writes on its way too, and compact with text draws them.
 */
export function CompactChatToggle(): JSX.Element {
  const compact = useInboxView((state) => state.compactChat)
  const showText = useInboxView((state) => state.compactText)
  const setCompact = useInboxView((state) => state.setCompactChat)
  const setShowText = useInboxView((state) => state.setCompactText)
  const commandNames = useInboxView((state) => state.commandNames)
  const setCommandNames = useInboxView((state) => state.setCommandNames)
  const turnChanges = useInboxView((state) => state.turnChanges)
  const setTurnChanges = useInboxView((state) => state.setTurnChanges)
  const layout: ChatLayout = !compact ? 'full' : showText ? 'compact-text' : 'compact'
  const current = LAYOUTS.find((option) => option.value === layout)!
  const Icon = current.icon
  const choose = (value: string): void => {
    if (value === 'full') return setCompact(false)
    setShowText(value === 'compact-text')
    setCompact(true)
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          type="button"
          className={cn('shrink-0 data-[state=open]:bg-active', compact && 'bg-active text-fg')}
          data-testid="chat-compact-toggle"
          data-layout={layout}
          aria-label={`Layout: ${current.label}`}
          title={`Layout: ${current.label}`}
        >
          <Icon className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-72">
        <DropdownMenuLabel>Layout</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={layout} onValueChange={choose} aria-label="Conversation layout">
          {LAYOUTS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value} data-testid={`chat-layout-${option.value}`} className="items-start">
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <option.icon className="h-3.5 w-3.5 text-fg-subtle" aria-hidden="true" />
                  {option.label}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-fg-subtle">{option.detail}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {/* What the compact layouts show besides their lines; Every step shows all of it anyway. */}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Compact layouts</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          data-testid="inbox-setting-turn-changes"
          checked={turnChanges}
          onCheckedChange={(checked) => setTurnChanges(checked === true)}
        >
          <span className="min-w-0">
            <span className="block">Changes after each turn</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-fg-subtle">
              A panel at the end of each turn lists the files it edited, wrote and deleted, with their diffs.
            </span>
          </span>
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          data-testid="inbox-setting-command-names"
          checked={commandNames}
          onCheckedChange={(checked) => setCommandNames(checked === true)}
        >
          <span className="min-w-0">
            <span className="block">Command and tool names</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-fg-subtle">
              A folded line names the commands and tools it ran, such as echo, git status or mde.show_view.
            </span>
          </span>
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
