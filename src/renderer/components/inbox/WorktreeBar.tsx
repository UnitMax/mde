import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Folder, FolderGit2, GitBranch, Search } from 'lucide-react'
import type { InboxGitBranch, InboxGitInfo } from '@shared/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { barTrigger as trigger, ComposerBar } from '@/components/inbox/ComposerBar'
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

function ModePicker({
  mode,
  canBranch,
  onModeChange,
  disabled,
}: {
  mode: WorktreeMode
  canBranch: boolean
  onModeChange: (mode: WorktreeMode) => void
  disabled?: boolean
}): JSX.Element {
  const active = MODES.find((item) => item.id === mode) ?? MODES[0]!
  const Icon = mode === 'worktree' ? FolderGit2 : Folder
  return (
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
  )
}

/**
 * The strip under the new-thread composer for a Git folder: run in the folder as it is, or in a new
 * worktree cut from a branch. In the folder the branch is only shown; MDE never switches it. `children`
 * are chips that go before the choice of where to run, set apart from it by a divider.
 */
export function WorktreeBar({
  children,
  info,
  mode,
  base,
  branchName,
  branchProblem,
  locked = false,
  onModeChange,
  onBaseChange,
  onBranchNameChange,
  disabled,
}: {
  children?: ReactNode
  info: InboxGitInfo
  mode: WorktreeMode
  /** The branch a new worktree starts from; null when the repository has none yet. */
  base: string | null
  /** The name typed for the new branch; empty lets MDE pick `mde/<id>`. */
  branchName: string
  /** Why that name cannot be used, or null. */
  branchProblem: string | null
  /** The folder is itself a worktree: threads started in it run there, and the mode is not a choice. */
  locked?: boolean
  onModeChange: (mode: WorktreeMode) => void
  onBaseChange: (name: string) => void
  onBranchNameChange: (name: string) => void
  disabled?: boolean
}): JSX.Element {
  const [nameFocused, setNameFocused] = useState(false)
  const canBranch = info.branches.length > 0

  return (
    <ComposerBar testId="worktree-bar">
      <div className="flex min-w-0 items-center gap-1">
        {children && (
          <>
            {children}
            <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-line-strong" />
          </>
        )}
        {locked ? (
          <span
            className="flex h-6 min-w-0 items-center gap-1.5 px-1.5 text-[12px] text-fg-muted"
            data-testid="worktree-fixed"
            title="This folder is a worktree. Threads started here run in it."
          >
            <FolderGit2 className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Worktree</span>
          </span>
        ) : (
          <ModePicker mode={mode} canBranch={canBranch} onModeChange={onModeChange} disabled={disabled} />
        )}
      </div>
      {mode === 'worktree' ? (
        <div className="ml-auto flex min-w-0 items-center gap-1">
          <input
            aria-label="New branch name"
            aria-invalid={branchProblem ? true : undefined}
            data-testid="worktree-branch-name"
            placeholder="New branch name (auto)"
            title="Name for the new branch. Leave it empty for an automatic name like mde/1a2b3c4d."
            value={branchName}
            disabled={disabled}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            onChange={(event) => onBranchNameChange(event.target.value)}
            onFocus={() => setNameFocused(true)}
            onBlur={() => setNameFocused(false)}
            className={cn(
              'h-6 w-44 min-w-0 rounded-md bg-transparent px-1.5 text-[12px] text-fg outline-none transition-colors placeholder:text-fg-subtle',
              'hover:bg-hover focus:bg-hover focus-visible:ring-1 focus-visible:ring-accent/60 disabled:opacity-50',
              branchProblem && !nameFocused && 'ring-1 ring-danger/70'
            )}
          />
          <BranchPicker branches={info.branches} current={info.branch} value={base} onChange={onBaseChange} disabled={disabled} />
        </div>
      ) : (
        <span className="flex h-6 min-w-0 items-center gap-1.5 px-1.5 text-[12px] text-fg-subtle" data-testid="worktree-current-branch" title="The folder's current branch">
          <GitBranch className="h-3.5 w-3.5 shrink-0" />
          <span className="max-w-[14rem] truncate">{info.branch ?? 'Detached HEAD'}</span>
        </span>
      )}
      {mode === 'worktree' && branchProblem && (
        <p
          role="status"
          data-testid="worktree-branch-problem"
          className={cn('basis-full px-1.5 pb-0.5 text-right text-[11px]', nameFocused ? 'text-fg-subtle' : 'text-danger')}
        >
          {branchProblem}
        </p>
      )}
    </ComposerBar>
  )
}
