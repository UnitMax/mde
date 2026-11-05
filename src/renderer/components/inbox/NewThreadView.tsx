import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, FolderPlus, Trash2 } from 'lucide-react'
import type { ChatDraftChoice, InboxFolder, InboxGitBranch, InboxThreadMode, OpenCodeModelRef } from '@shared/types'
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
import { ThreadModeSwitch } from '@/components/inbox/ThreadModeSwitch'
import { WorktreeBar, useInboxGit, type WorktreeMode } from '@/components/inbox/WorktreeBar'
import { findModel, initialChoice } from '@/lib/chat'
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

/** The agent and model picked on one page; what was not picked follows the last choice made anywhere. */
interface Picked {
  pageId: string
  mode?: InboxThreadMode
  agent?: string
  model?: OpenCodeModelRef
}

const pickedFrom = (choice: ChatDraftChoice | undefined): Omit<Picked, 'pageId'> => ({
  ...(choice?.mode ? { mode: choice.mode } : {}),
  ...(choice?.agent ? { agent: choice.agent } : {}),
  ...(choice?.model ? { model: choice.model } : {}),
})

/** Where the thread would run, as picked on one page and for one folder. `base` and `branch` matter in a worktree only. */
interface Where {
  pageId: string
  folderId: string | undefined
  mode: WorktreeMode
  /** The branch the worktree is cut from, once one was picked or restored; Git's default until then. */
  base: string | null
  /** The new branch's name; empty means MDE picks one (`mde/<id>`). */
  branch: string
}

const whereFrom = (choice: ChatDraftChoice | undefined): Pick<Where, 'mode' | 'base' | 'branch'> =>
  choice?.worktree
    ? { mode: 'worktree', base: choice.worktree.base, branch: choice.worktree.branch ?? '' }
    : { mode: 'current', base: null, branch: '' }

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
  const page = useInboxDrafts((state) => state.page)
  const startFresh = useInboxDrafts((state) => state.startFresh)
  useEffect(() => () => useInboxDrafts.getState().leave(), [])
  const [adding, setAdding] = useState(false)
  const plainFolders = useMemo(() => folders.filter((item) => !item.worktree), [folders])
  const worktreeFolders = useMemo(() => folders.filter((item) => item.worktree), [folders])
  // Without a remembered choice, a real folder comes first: a worktree is something to pick on purpose.
  const folder = folders.find((item) => item.id === composer.folderId) ?? plainFolders[0] ?? folders[0] ?? null
  const options = useInboxChat((state) => (folder ? state.options[optionsKey({ folderId: folder.id })] : undefined))
  const folderId = folder?.id
  const git = useInboxGit(folderId)

  // What was picked on this page. A draft taken from the list brings back how it was left; a blank page has
  // picked nothing, and follows the last choice made anywhere. Kept per page, so another page starts over.
  const [picked, setPicked] = useState<Picked>(() => ({ pageId: page.id, ...pickedFrom(page.choice) }))
  const pick: Picked = picked.pageId === page.id ? picked : { pageId: page.id, ...pickedFrom(page.choice) }
  const mode = pick.mode ?? 'gui'
  // Where the thread runs. Every blank page starts in the folder itself, so a worktree is always a choice; a
  // draft that had one chosen has it again, and changing the folder takes it away, since the branches differ.
  const [where, setWhere] = useState<Where>(() => ({ pageId: page.id, folderId, ...whereFrom(page.folderId === folderId ? page.choice : undefined) }))
  // A page that was just opened shows what its draft had, unless it is in another folder than the draft's.
  const here: Where = where.pageId !== page.id
    ? { pageId: page.id, folderId, ...whereFrom(page.folderId === folderId ? page.choice : undefined) }
    : where.folderId === undefined
      ? { ...where, folderId }
      : where.folderId !== folderId
        ? { pageId: page.id, folderId, mode: 'current', base: null, branch: '' }
        : where
  const setHere = (patch: Partial<Where>): void => setWhere({ ...here, ...patch })
  const defaultBase = useMemo(() => (git ? defaultWorktreeBase(git) : null), [git])
  const base = git && here.base && git.branches.some((branch) => branch.name === here.base) ? here.base : defaultBase
  // A folder that is itself a worktree has no choice to make: threads started in it run in it.
  const locked = Boolean(folder?.worktree)
  const choosing = git !== null && !locked && here.mode === 'worktree'
  const chosenBranch = here.branch.trim()
  const branchProblem = git && choosing && chosenBranch ? worktreeBranchError(git.branches, chosenBranch) : null
  const worktree = choosing && base ? { base, ...(chosenBranch ? { branch: chosenBranch } : {}) } : undefined

  useEffect(() => {
    if (folder) void loadOptions({ folderId: folder.id })
  }, [folder, loadOptions])

  const ready = options?.status === 'ready' ? options.value : null
  const initial = useMemo(() => (ready ? initialChoice(ready, composer) : null), [ready, composer])
  const agent = pick.agent && ready?.agents.some((item) => item.id === pick.agent) ? pick.agent : initial?.agent ?? null
  const model = pick.model && ready && findModel(ready.models, pick.model) ? pick.model : initial?.model ?? null

  const chooseAgent = (next: string): void => {
    setPicked({ ...pick, agent: next })
    setComposer({ agent: next })
  }
  const chooseModel = (next: OpenCodeModelRef): void => {
    setPicked({ ...pick, model: next })
    setComposer({ model: next })
  }

  // What the draft remembers of how it would start: the agent and model once they are known, and a worktree
  // when one is chosen, whether or not Git has answered yet. Left out until then, so a draft keeps what it had.
  const savedBase = here.base ?? base
  const choice: ChatDraftChoice | undefined = agent && model
    ? {
        agent,
        model,
        ...(mode === 'terminal' ? { mode } : {}),
        ...(!locked && here.mode === 'worktree' && savedBase ? { worktree: { base: savedBase, ...(chosenBranch ? { branch: chosenBranch } : {}) } } : {}),
      }
    : undefined
  const choiceKey = JSON.stringify(choice)
  const draftMeta = useMemo(
    () => (folderId ? { folderId, ...(choice ? { choice } : {}) } : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [folderId, choiceKey],
  )

  // Save as draft: what is typed is set aside and the page starts blank. The sidebar's Drafts section has it
  // from then on, which may be folded or hidden, so the page says so for a moment.
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    if (!saved) return
    const timer = window.setTimeout(() => setSaved(false), 4000)
    return () => window.clearTimeout(timer)
  }, [saved])
  const saveDraft = (): void => {
    void startFresh().then((done) => { if (done) setSaved(true) })
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
            key={page.id}
            draftKey={`draft:${page.id}`}
            draftMeta={draftMeta}
            onSaveDraft={saveDraft}
            allowBackgroundSend
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
            extraPickers={(
              <>
                <McpChip place={{ request: { folderId: folder.id }, target: folder.target, directory: folder.directory }} readOnly={choosing} />
                <ThreadModeSwitch value={mode} onChange={(next) => setPicked({ ...pick, mode: next })} />
              </>
            )}
            footer={git && (
              <WorktreeBar
                info={git}
                locked={locked}
                mode={locked ? 'current' : here.mode}
                base={base}
                branchName={here.branch}
                branchProblem={branchProblem}
                // Choosing a worktree takes the branch it is cut from along, so the draft remembers it though Git's default may change.
                onModeChange={(next) => setHere({ mode: next, ...(next === 'worktree' ? { base: here.base ?? base } : {}) })}
                onBaseChange={(next) => setHere({ base: next })}
                onBranchNameChange={(next) => setHere({ branch: next })}
              />
            )}
            onSend={async (text, { background, ...attachments } = {}) => {
              if (!agent || !model) return
              await createThread({ folderId: folder.id, text, agent, model, draftId: page.id, ...attachments, ...(mode === 'terminal' ? { mode } : {}), ...(worktree ? { worktree } : {}) }, { background })
              const drafts = useInboxDrafts.getState()
              if (background && drafts.page.id === page.id) {
                drafts.leave()
                // Keep where the next thread runs, but give its worktree a fresh branch name.
                setWhere({ ...here, pageId: useInboxDrafts.getState().page.id, branch: '' })
              }
            }}
          />
        )}
        {saved && (
          <p role="status" data-testid="inbox-draft-saved" className="-mt-3 text-center text-xs text-fg-muted">
            Saved as a draft. It is under Drafts in the sidebar.
          </p>
        )}
      </div>
      <AddInboxFolderDialog open={adding} onOpenChange={setAdding} />
    </div>
  )
}
