import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, FolderPlus, Trash2 } from 'lucide-react'
import type { OpenCodeModelRef } from '@shared/types'
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
import { WorktreeBar, useInboxGit, type WorktreeMode } from '@/components/inbox/WorktreeBar'
import { initialChoice } from '@/lib/chat'
import { defaultWorktreeBase } from '@/lib/inbox'
import { optionsKey, useInboxChat } from '@/store/inbox-chat'

/** The Inbox's start page: pick a folder, a model and an agent, and describe the work. */
export function NewThreadView(): JSX.Element {
  const folders = useInboxChat((state) => state.folders)
  const loaded = useInboxChat((state) => state.foldersLoaded)
  const composer = useInboxChat((state) => state.composer)
  const setComposer = useInboxChat((state) => state.setComposer)
  const removeFolder = useInboxChat((state) => state.removeFolder)
  const loadOptions = useInboxChat((state) => state.loadOptions)
  const createThread = useInboxChat((state) => state.createThread)
  const [adding, setAdding] = useState(false)
  const folder = folders.find((item) => item.id === composer.folderId) ?? folders[0] ?? null
  const options = useInboxChat((state) => (folder ? state.options[optionsKey({ folderId: folder.id })] : undefined))
  const [agent, setAgent] = useState<string | null>(null)
  const [model, setModel] = useState<OpenCodeModelRef | null>(null)
  // Where the thread runs. Every visit starts in the folder itself, so a worktree is always a choice.
  const git = useInboxGit(folder?.id)
  const [mode, setMode] = useState<WorktreeMode>('current')
  const [pickedBase, setPickedBase] = useState<string | null>(null)
  const folderId = folder?.id
  useEffect(() => {
    setMode('current')
    setPickedBase(null)
  }, [folderId])
  const defaultBase = useMemo(() => (git ? defaultWorktreeBase(git) : null), [git])
  const base = git && pickedBase && git.branches.some((branch) => branch.name === pickedBase) ? pickedBase : defaultBase
  const worktree = git && mode === 'worktree' && base ? { base } : undefined

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
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      data-testid="inbox-folder-picker"
                      title={`${folder.directory}${folder.target.kind === 'wsl' ? ` (${folder.target.distro})` : ''}`}
                      className="inline-flex items-baseline gap-1 rounded underline decoration-fg-subtle decoration-dotted decoration-2 underline-offset-[6px] outline-none hover:decoration-fg-muted focus-visible:ring-2 focus-visible:ring-accent/60"
                    >
                      {folder.name}
                      <ChevronDown className="h-4 w-4 self-center text-fg-subtle" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="center" className="w-80">
                    {folders.map((item) => (
                      <DropdownMenuItem
                        key={item.id}
                        onSelect={() => setComposer({ folderId: item.id })}
                        className="group items-start"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{item.name}</span>
                          <span className="block truncate text-[11px] text-fg-subtle">
                            {item.directory}
                            {item.target.kind === 'wsl' ? ` · ${item.target.distro}` : ''}
                          </span>
                        </span>
                        <button
                          type="button"
                          aria-label={`Remove ${item.name} from the Inbox`}
                          title="Remove from the Inbox"
                          className="invisible mt-0.5 rounded p-0.5 text-fg-subtle hover:text-danger group-data-[highlighted]:visible"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            void removeFolder(item.id)
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setAdding(true)}>
                      <FolderPlus className="h-3.5 w-3.5" />
                      Add folder…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                ?
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
            key={folder.id}
            draftKey={`folder:${folder.id}`}
            autoFocus
            options={options}
            agent={agent}
            model={model}
            onAgentChange={chooseAgent}
            onModelChange={chooseModel}
            onRetryOptions={() => void loadOptions({ folderId: folder.id }, true)}
            placeholder="Describe what you want to build or change"
            footer={git && (
              <WorktreeBar info={git} mode={mode} base={base} onModeChange={setMode} onBaseChange={setPickedBase} />
            )}
            onSend={async (text, attachments) => {
              if (!agent || !model) return
              await createThread({ folderId: folder.id, text, agent, model, ...attachments, ...(worktree ? { worktree } : {}) })
            }}
          />
        )}
      </div>
      <AddInboxFolderDialog open={adding} onOpenChange={setAdding} />
    </div>
  )
}
