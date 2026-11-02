import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, Folder, FolderGit2, GitBranch, Search } from 'lucide-react'
import type { InboxGitBranch, InboxGitInfo } from '@shared/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export type WorktreeMode = 'current' | 'worktree'

/**
 * What Git says about a folder, read afresh whenever the folder changes. Anything that goes wrong
 * (not a repository, Git missing, the folder gone) is the same as no Git: the page just has no
 * worktree bar.
 */
export function useInboxGit(folderId: string | undefined): InboxGitInfo | null {
  const [state, setState] = useState<{ folderId: string; info: InboxGitInfo } | null>(null)
  useEffect(() => {
    if (!folderId) return
    let cancelled = false
    Promise.resolve()
      .then(() => window.api.inbox.gitInfo({ folderId }))
      .then(
        (info) => { if (!cancelled) setState({ folderId, info }) },
        () => { if (!cancelled) setState(null) }
      )
    return () => { cancelled = true }
  }, [folderId])
  if (!state || state.folderId !== folderId || !state.info.repository) return null
  return state.info
}

const trigger =
  'flex h-6 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-[12px] text-fg-muted transition-colors ' +
  'hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-hover data-[state=open]:text-fg'

const MODES: ReadonlyArray<{ id: WorktreeMode; label: string; description: string }> = [
  { id: 'current', label: 'Current directory', description: 'Work in the folder as it is, on its current branch.' },
  { id: 'worktree', label: 'New worktree', description: 'Work on a new branch in a separate checkout, and leave the folder alone.' },
]

function BranchPicker({
  branches,
  current,
  value,
  onChange,
  disabled,
}: {
  branches: InboxGitBranch[]
  current: string | null
  value: string | null
  onChange: (name: string) => void
  disabled?: boolean
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? branches.filter((branch) => branch.name.toLowerCase().includes(needle)) : branches
  }, [branches, query])
  const groups = [
    { label: 'Local', items: shown.filter((branch) => !branch.remote) },
    { label: 'Remote', items: shown.filter((branch) => branch.remote) },
  ].filter((group) => group.items.length > 0)

  return (
    <DropdownMenu open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery('') }}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button type="button" className={trigger} aria-label="Branch to start from" data-testid="worktree-branch-picker">
          <GitBranch className="h-3.5 w-3.5 shrink-0" />
          <span className="max-w-[14rem] truncate">From {value ?? 'a branch'}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 p-0">
        <div className="relative border-b border-line p-1.5">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" />
          <input
            autoFocus
            aria-label="Search branches"
            placeholder="Search branches"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            // Typing must reach the field, not the menu's type-ahead.
            onKeyDown={(event) => {
              if (event.key !== 'Escape' && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') event.stopPropagation()
            }}
            className="h-7 w-full rounded bg-panel pl-7 pr-2 text-xs text-fg outline-none placeholder:text-fg-subtle"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1" data-testid="worktree-branch-list">
          {groups.length === 0 && <p className="px-2 py-1.5 text-xs text-fg-subtle">No branches match.</p>}
          {groups.map((group) => (
            <div key={group.label} role="group" aria-label={group.label}>
              <p className="px-2 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">{group.label}</p>
              {group.items.map((branch) => (
                <DropdownMenuItem
                  key={branch.name}
                  onSelect={() => onChange(branch.name)}
                  className={cn(branch.name === value && 'bg-active')}
                  title={branch.name}
                >
                  <span className="min-w-0 flex-1 truncate">{branch.name}</span>
                  {branch.name === current && !branch.remote && <span className="shrink-0 text-[10px] text-fg-subtle">current</span>}
                  {branch.name === value && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
                </DropdownMenuItem>
              ))}
            </div>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The strip under the new-thread composer for a Git folder: run in the folder as it is, or in a new
 * worktree cut from a branch. In the folder the branch is only shown; MDE never switches it.
 */
export function WorktreeBar({
  info,
  mode,
  base,
  onModeChange,
  onBaseChange,
  disabled,
}: {
  info: InboxGitInfo
  mode: WorktreeMode
  /** The branch a new worktree starts from; null when the repository has none yet. */
  base: string | null
  onModeChange: (mode: WorktreeMode) => void
  onBaseChange: (name: string) => void
  disabled?: boolean
}): JSX.Element {
  const active = MODES.find((item) => item.id === mode) ?? MODES[0]!
  const canBranch = info.branches.length > 0
  const Icon = mode === 'worktree' ? FolderGit2 : Folder

  return (
    <div
      data-testid="worktree-bar"
      className="-mt-1.5 mx-5 flex items-center justify-between gap-2 rounded-b-xl border border-t-0 border-line bg-elevated/50 px-1.5 pb-1 pt-2"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button type="button" className={trigger} aria-label="Where to run" data-testid="worktree-mode-picker">
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{active.label}</span>
            <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          {MODES.map((item) => (
            <DropdownMenuItem
              key={item.id}
              disabled={item.id === 'worktree' && !canBranch}
              onSelect={() => onModeChange(item.id)}
              className="items-start"
              data-testid={`worktree-mode-${item.id}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block">{item.label}</span>
                <span className="block text-[11px] text-fg-subtle">
                  {item.id === 'worktree' && !canBranch ? 'This repository has no branches yet.' : item.description}
                </span>
              </span>
              {item.id === mode && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {mode === 'worktree' ? (
        <BranchPicker branches={info.branches} current={info.branch} value={base} onChange={onBaseChange} disabled={disabled} />
      ) : (
        <span className="flex h-6 min-w-0 items-center gap-1.5 px-1.5 text-[12px] text-fg-subtle" data-testid="worktree-current-branch" title="The folder's current branch">
          <GitBranch className="h-3.5 w-3.5 shrink-0" />
          <span className="max-w-[14rem] truncate">{info.branch ?? 'Detached HEAD'}</span>
        </span>
      )}
    </div>
  )
}
