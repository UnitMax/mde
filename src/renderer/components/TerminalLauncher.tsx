import { useEffect, useRef, useState } from 'react'
import { Bot, Code2, Terminal as TerminalIcon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Session, CodingAgent, TerminalLaunchDirectory } from '@shared/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { resolveAgentCommand, agentCommandSettingError, AGENT_COMMAND_OPTIONS } from '@/lib/agent-commands'
import {
  defaultTerminalLaunchDirectory,
  terminalLaunchDirectoryDisabled,
  terminalLaunchDirectoryPath,
  toggleTerminalLaunchDirectory
} from '@/lib/terminal-launcher'
import { useWorkspace } from '@/store/workspace'
import { getTerminalSettings, subscribeTerminalSettings } from '@/terminal/terminal-settings'
import { MAX_TERMINAL_COUNT, type RuntimeTerminalLaunch } from '@/terminal/layout'

interface TerminalLauncherProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  session: Session
  sourceTerminalId: string
  directory?: string
  paneCount: number
  onSelect: (launch: RuntimeTerminalLaunch) => void
}

interface LauncherItem {
  id: 'terminal' | CodingAgent
  label: string
  description: string
  icon: LucideIcon
  kind?: CodingAgent
}

const DIRECTORY_OPTIONS: readonly { id: TerminalLaunchDirectory; label: string }[] = [
  { id: 'terminal', label: 'Current terminal directory' },
  { id: 'session', label: 'Session directory' }
]

const LAUNCHER_ITEMS: readonly LauncherItem[] = [
  {
    id: 'terminal',
    label: 'New terminal',
    description: 'Open a shell in the selected directory',
    icon: TerminalIcon
  },
  ...AGENT_COMMAND_OPTIONS.map((option) => ({
    id: option.kind,
    label: option.label,
    description: option.description,
    icon: option.kind === 'opencode' ? Code2 : Bot,
    kind: option.kind
  }))
]

export function TerminalLauncher({
  open,
  onOpenChange,
  session,
  sourceTerminalId,
  directory,
  paneCount,
  onSelect
}: TerminalLauncherProps): JSX.Element {
  const platform = useWorkspace((state) => state.platform)
  const [settings, setSettings] = useState(() => getTerminalSettings())
  const [activeIndex, setActiveIndex] = useState(0)
  const [directorySource, setDirectorySource] = useState<TerminalLaunchDirectory>('terminal')
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const sessionDirectory = session.path
  const selectedDirectorySource = terminalLaunchDirectoryDisabled(
    directorySource,
    directory,
    sessionDirectory
  )
    ? defaultTerminalLaunchDirectory(directory)
    : directorySource
  const selectedDirectory = terminalLaunchDirectoryPath(
    selectedDirectorySource,
    directory,
    sessionDirectory
  )
  const available = Boolean(selectedDirectory?.trim())
  const capacityAvailable = paneCount < MAX_TERMINAL_COUNT
  const wslOnly = platform?.isWindows === true && session.kind === 'wsl'

  useEffect(() => subscribeTerminalSettings(() => setSettings(getTerminalSettings())), [])

  useEffect(() => {
    if (!open) return
    setDirectorySource(defaultTerminalLaunchDirectory(directory))
  }, [open, sourceTerminalId])

  const directoryOptionDisabled = (option: TerminalLaunchDirectory): boolean =>
    terminalLaunchDirectoryDisabled(option, directory, sessionDirectory)

  const directoryOptionPath = (option: TerminalLaunchDirectory): string | undefined =>
    terminalLaunchDirectoryPath(option, directory, sessionDirectory)

  const itemDisabled = (item: LauncherItem): boolean => {
    if (!wslOnly || !available || !capacityAvailable) return true
    if (!item.kind) return false
    return agentCommandSettingError(settings.agents[item.kind]) !== null
  }

  const enabledIndexes = LAUNCHER_ITEMS
    .map((item, index) => itemDisabled(item) ? -1 : index)
    .filter((index) => index >= 0)

  useEffect(() => {
    if (!open) return
    setActiveIndex(enabledIndexes[0] ?? 0)
  }, [open, settings, available, capacityAvailable, wslOnly])

  const selectItem = (item: LauncherItem): void => {
    if (itemDisabled(item)) return
    if (!available) return
    if (!item.kind) {
      onSelect({ sourceTerminalId, directory: selectedDirectorySource })
      return
    }

    const command = resolveAgentCommand(settings.agents[item.kind])
    if (!command) return
    onSelect({
      sourceTerminalId,
      directory: selectedDirectorySource,
      agent: { kind: item.kind, command }
    })
  }

  const moveActive = (delta: number): void => {
    if (enabledIndexes.length === 0) return
    const currentPosition = enabledIndexes.indexOf(activeIndex)
    const nextPosition = currentPosition < 0
      ? 0
      : (currentPosition + delta + enabledIndexes.length) % enabledIndexes.length
    setActiveIndex(enabledIndexes[nextPosition] ?? 0)
  }

  const statusMessage = !wslOnly
    ? 'This launcher is available only for WSL sessions on Windows.'
    : !available
      ? 'The selected directory is not available.'
      : !capacityAvailable
        ? 'This tab already has the maximum of ' + MAX_TERMINAL_COUNT + ' terminals.'
        : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl p-3"
        onKeyDown={(event) => {
          if (event.key === 'Tab') {
            const next = toggleTerminalLaunchDirectory(
              selectedDirectorySource,
              directory,
              sessionDirectory
            )
            if (next !== selectedDirectorySource) {
              event.preventDefault()
              event.stopPropagation()
              setDirectorySource(next)
            }
          } else if (event.key === 'ArrowDown') {
            event.preventDefault()
            moveActive(1)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            moveActive(-1)
          } else if (event.key === 'Home') {
            event.preventDefault()
            setActiveIndex(enabledIndexes[0] ?? 0)
          } else if (event.key === 'End') {
            event.preventDefault()
            setActiveIndex(enabledIndexes[enabledIndexes.length - 1] ?? 0)
          } else if (event.key === 'Enter') {
            const item = LAUNCHER_ITEMS[activeIndex]
            if (item && !itemDisabled(item)) {
              event.preventDefault()
              selectItem(item)
            }
          }
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          window.requestAnimationFrame(() => itemRefs.current[activeIndex]?.focus())
        }}
      >
        <DialogHeader className="mb-3 px-1">
          <DialogTitle>
            Open in {selectedDirectorySource === 'terminal' ? 'current terminal' : 'session'} directory
          </DialogTitle>
          <DialogDescription className="truncate font-mono" title={selectedDirectory ?? 'Unavailable'}>
            {selectedDirectory ?? 'Directory unavailable'}
          </DialogDescription>
        </DialogHeader>

        <div
          role="tablist"
          aria-label="Launch directory"
          className="mb-3 grid grid-cols-2 gap-1 rounded border border-line bg-panel p-1"
        >
          {DIRECTORY_OPTIONS.map((option) => {
            const optionDisabled = directoryOptionDisabled(option.id)
            const optionPath = directoryOptionPath(option.id)
            const selected = option.id === selectedDirectorySource
            return (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={selected}
                disabled={optionDisabled}
                onClick={() => setDirectorySource(option.id)}
                className={
                  'min-w-0 rounded px-2 py-1.5 text-left transition-colors ' +
                  (selected ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg') +
                  ' disabled:cursor-not-allowed disabled:opacity-40'
                }
                data-testid={'terminal-launch-directory-' + option.id}
              >
                <span className="block truncate text-xs font-medium">{option.label}</span>
                <span
                  className="mt-0.5 block truncate font-mono text-[10px] text-fg-subtle"
                  title={optionPath ?? 'Unavailable'}
                >
                  {optionPath ?? (option.id === 'terminal'
                    ? 'Not reported yet'
                    : 'Session directory unavailable')}
                </span>
              </button>
            )
          })}
        </div>

        <div
          role="listbox"
          aria-label="Terminal launch options"
          aria-activedescendant={
            'terminal-launcher-option-' + (LAUNCHER_ITEMS[activeIndex]?.id ?? 'terminal')
          }
          className="space-y-1"
        >
          {LAUNCHER_ITEMS.map((item, index) => {
            const disabled = itemDisabled(item)
            const settingError = item.kind
              ? agentCommandSettingError(settings.agents[item.kind])
              : null
            const detail = settingError ?? statusMessage ?? item.description
            const Icon = item.icon
            return (
              <button
                key={item.id}
                ref={(element) => {
                  itemRefs.current[index] = element
                }}
                id={'terminal-launcher-option-' + item.id}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                disabled={disabled}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectItem(item)}
                className={
                  'flex w-full items-center gap-3 rounded border px-3 py-2 text-left transition-colors ' +
                  (index === activeIndex
                    ? 'border-accent bg-active'
                    : 'border-transparent hover:border-line hover:bg-hover') +
                  ' disabled:cursor-not-allowed disabled:opacity-45'
                }
                data-testid={'terminal-launcher-' + item.id}
              >
                <Icon className="h-4 w-4 shrink-0 text-fg-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-fg">{item.label}</span>
                  <span
                    className={
                      'mt-0.5 block truncate text-xs ' +
                      (settingError ? 'text-danger' : 'text-fg-subtle')
                    }
                  >
                    {detail}
                  </span>
                </span>
                {index === activeIndex && !disabled && (
                  <span className="text-[10px] uppercase tracking-wide text-fg-subtle">Enter</span>
                )}
              </button>
            )
          })}
        </div>

        <p className="mt-2 px-1 text-[11px] text-fg-subtle">
          Press Tab to switch directories when both are available. Use Ctrl+N or Cmd+N from a focused terminal to open this selector.
        </p>
      </DialogContent>
    </Dialog>
  )
}
