import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, FolderPlus, Trash2 } from 'lucide-react'
import type { InboxFolder, InboxGitBranch, OpenCodeModelRef } from '@shared/types'
import { worktreeBranchConflict, worktreeBranchProblem } from '@shared/worktree-branch'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AddInboxFolderDialog } from '@/components/inbox/AddInboxFolderDialog'
import { ChatComposer } from '@/components/inbox/ChatComposer'
import { McpChip } from '@/components/inbox/McpChip'
import { WorktreeBar, useInboxGit, type WorktreeMode } from '@/components/inbox/WorktreeBar'
import { initialChoice } from '@/lib/chat'
import { defaultWorktreeBase, inboxWorktreeSource } from '@/lib/inbox'
import { optionsKey, useInboxChat } from '@/store/inbox-chat'
import { useInboxDrafts } from '@/store/inbox-drafts'

/** Why the chosen name cannot be used for the new branch, judged from what the page already knows. */
function worktreeBranchError(branches: InboxGitBranch[], name: string): string | null {
  return worktreeBranchProblem(name) ?? worktreeBranchConflict(name, branches.filter((branch) => !branch.remote).map((branch) => branch.name))
}

/** The tooltip of the folder in the heading: where it is and, for a worktree, what it was cut from. */
function folderTitle(folder: InboxFolder, folders: InboxFolder[]): string {
  const place = `${folder.directory}${folder.target.kind === 'wsl' ? ` (${folder.target.distro})` : ''}`
  if (!folder.worktree) return place
  return `Worktree of ${inboxWorktreeSource(folder.worktree, folder.target, folders)}, based on ${folder.worktree.base}\n${place}`
}

/** One folder in the chooser; a worktree says so, and which folder and branch it was based on. */
function FolderItem({
  item,
  folders,
  onChoose,
  onRemove,
}: {
  item: InboxFolder
  folders: InboxFolder[]
  onChoose: (id: string) => void
  onRemove: (id: string) => void
}): JSX.Element {
  const worktree = item.worktree
  return (
    <DropdownMenuItem
      onSelect={() => onChoose(item.id)}
      className="group items-start"
      title={folderTitle(item, folders)}
      data-testid={worktree ? 'inbox-worktree-folder' : 'inbox-folder-item'}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="block truncate">{worktree ? worktree.branch : item.name}</span>
          {worktree && (
            <span className="shrink-0 rounded bg-hover px-1 text-[10px] font-medium uppercase tracking-wide text-fg-muted">Worktree</span>
          )}
        </span>
        <span className="block truncate text-[11px] text-fg-subtle">
          {worktree
            ? `Based on ${worktree.base} in ${inboxWorktreeSource(worktree, item.target, folders)}`
            : `${item.directory}${item.target.kind === 'wsl' ? ` · ${item.target.distro}` : ''}`}
        </span>
      </span>
      <button
        type="button"
        aria-label={`Remove ${item.name} from the Inbox`}
        title={worktree ? 'Remove from the Inbox (the worktree stays on disk)' : 'Remove from the Inbox'}
        className="invisible mt-0.5 rounded p-0.5 text-fg-subtle hover:text-danger group-data-[highlighted]:visible"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onRemove(item.id)
        }}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </DropdownMenuItem>
  )
}

/** The Inbox's start page: pick a folder, a model and an agent, and describe the work. */
export function NewThreadView(): JSX.Element {
  const folders = useInboxChat((state) => state.folders)
  const loaded = useInboxChat((state) => state.foldersLoaded)
  const composer = useInboxChat((state) => state.composer)
  const setComposer = useInboxChat((state) => state.setComposer)
  const removeFolder = useInboxChat((state) => state.removeFolder)
  const loadOptions = useInboxChat((state) => state.loadOptions)
  const createThread = useInboxChat((state) => state.createThread)
  // The draft this page writes into. Leaving the page makes what was typed a draft of the sidebar's, and the next visit a blank one.
  const draftId = useInboxDrafts((state) => state.page.id)
  useEffect(() => () => useInboxDrafts.getState().leave(), [])
  const [adding, setAdding] = useState(false)
  const plainFolders = useMemo(() => folders.filter((item) => !item.worktree), [folders])
  const worktreeFolders = useMemo(() => folders.filter((item) => item.worktree), [folders])
  // Without a remembered choice, a real folder comes first: a worktree is something to pick on purpose.
  const folder = folders.find((item) => item.id === composer.folderId) ?? plainFolders[0] ?? folders[0] ?? null
  const options = useInboxChat((state) => (folder ? state.options[optionsKey({ folderId: folder.id })] : undefined))
  const [agent, setAgent] = useState<string | null>(null)
  const [model, setModel] = useState<OpenCodeModelRef | null>(null)
  // Where the thread runs. Every visit starts in the folder itself, so a worktree is always a choice.
  const git = useInboxGit(folder?.id)
  const [mode, setMode] = useState<WorktreeMode>('current')
  const [pickedBase, setPickedBase] = useState<string | null>(null)
  // The new branch's name; empty means MDE picks one (`mde/<id>`).
  const [branchName, setBranchName] = useState('')
  const folderId = folder?.id
  useEffect(() => {
    setMode('current')
    setPickedBase(null)
    setBranchName('')
  }, [folderId])
  const defaultBase = useMemo(() => (git ? defaultWorktreeBase(git) : null), [git])
  const base = git && pickedBase && git.branches.some((branch) => branch.name === pickedBase) ? pickedBase : defaultBase
  // A folder that is itself a worktree has no choice to make: threads started in it run in it.
  const locked = Boolean(folder?.worktree)
  const choosing = git !== null && !locked && mode === 'worktree'
  const chosenBranch = branchName.trim()
  const branchProblem = git && choosing && chosenBranch ? worktreeBranchError(git.branches, chosenBranch) : null
  const worktree = choosing && base ? { base, ...(chosenBranch ? { branch: chosenBranch } : {}) } : undefined

  useEffect(() => {
    if (folder) void loadOptions({ folderId: folder.id })
  }, [folder, loadOptions])

  const ready = options?.status === 'ready' ? options.value : null
  const initial = useMemo(() => (ready ? initialChoice(ready, composer) : null), [ready, composer])
  useEffect(() => {
    if (!initial) return
    setAgent((current) => (current && ready?.agents.some((item) => item.id === current) ? current : initial.agent))
    setModel((current) => current ?? initial.model)
  }, [initial, ready])

  const chooseAgent = (next: string): void => {
    setAgent(next)
    setComposer({ agent: next })
  }
  const chooseModel = (next: OpenCodeModelRef): void => {
    setModel(next)
    setComposer({ model: next })
  }

  return (
    <div className="flex h-full min-h-0 flex-col items-center overflow-y-auto px-6" data-testid="inbox-new-thread">
      <div className="flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 py-10">
        <div className="text-center">
          <h1 className="text-[28px] font-semibold tracking-tight text-fg">
            {folder ? (
              <>
                What should we build in{' '}
                {/* The name and the question mark stay together; a very long name is cut short, its tooltip has it all. */}
                <span className="whitespace-nowrap">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        data-testid="inbox-folder-picker"
                        title={folderTitle(folder, folders)}
                        className="inline-flex max-w-[min(28rem,70vw)] items-baseline gap-1 rounded align-bottom underline decoration-fg-subtle decoration-dotted decoration-2 underline-offset-[6px] outline-none hover:decoration-fg-muted focus-visible:ring-2 focus-visible:ring-accent/60"
                      >
                        <span className="truncate">{folder.name}</span>
                        <ChevronDown className="h-4 w-4 shrink-0 self-center text-fg-subtle" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="center" className="w-80">
                      <div className="max-h-[min(24rem,60vh)] overflow-y-auto">
                        {plainFolders.map((item) => (
                          <FolderItem key={item.id} item={item} folders={folders} onChoose={(id) => setComposer({ folderId: id })} onRemove={(id) => void removeFolder(id)} />
                        ))}
                        {worktreeFolders.length > 0 && (
                          <>
                            {plainFolders.length > 0 && <DropdownMenuSeparator />}
                            <p className="px-2 pb-0.5 pt-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">Worktrees</p>
                            {worktreeFolders.map((item) => (
                              <FolderItem key={item.id} item={item} folders={folders} onChoose={(id) => setComposer({ folderId: id })} onRemove={(id) => void removeFolder(id)} />
                            ))}
                          </>
                        )}
                      </div>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => setAdding(true)}>
                        <FolderPlus className="h-3.5 w-3.5" />
                        Add folder…
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  ?
                </span>
              </>
            ) : (
              'What should we build?'
            )}
          </h1>
          {loaded && !folder && (
            <div className="mt-4 flex flex-col items-center gap-3">
              <p className="text-[13px] text-fg-muted">Add a folder for OpenCode to work in.</p>
              <Button onClick={() => setAdding(true)}>
                <FolderPlus className="h-3.5 w-3.5" />
                Add a folder
              </Button>
            </div>
          )}
        </div>
        {folder && (
          <ChatComposer
            // The draft stays with the page when its folder is changed, so what was typed is not lost to the switch.
            key={draftId}
            draftKey={`draft:${draftId}`}
            draftFolderId={folder.id}
            autoFocus
            options={options}
            agent={agent}
            model={model}
            onAgentChange={chooseAgent}
            onModelChange={chooseModel}
            onRetryOptions={() => void loadOptions({ folderId: folder.id }, true)}
            placeholder="Describe what you want to build or change"
            sendBlocked={Boolean(branchProblem)}
            // The servers of the folder itself: a new worktree loads its own, so then they are shown but not switched.
            extraPickers={<McpChip place={{ request: { folderId: folder.id }, target: folder.target, directory: folder.directory }} readOnly={choosing} />}
            footer={git && (
              <WorktreeBar
                info={git}
                locked={locked}
                mode={locked ? 'current' : mode}
                base={base}
                branchName={branchName}
                branchProblem={branchProblem}
                onModeChange={setMode}
                onBaseChange={setPickedBase}
                onBranchNameChange={setBranchName}
              />
            )}
            onSend={async (text, attachments) => {
              if (!agent || !model) return
              await createThread({ folderId: folder.id, text, agent, model, draftId, ...attachments, ...(worktree ? { worktree } : {}) })
            }}
          />
        )}
      </div>
      <AddInboxFolderDialog open={adding} onOpenChange={setAdding} />
    </div>
  )
}
