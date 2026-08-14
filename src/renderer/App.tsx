import { useEffect, useState } from 'react'
import { Plus, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AddSessionDialog } from '@/components/AddProjectDialog'
import { NewProjectDialog } from '@/components/NewProjectDialog'
import { Sidebar } from '@/components/Sidebar'
import { TerminalView } from '@/components/TerminalView'
import { useWorkspace } from '@/store/workspace'

function EmptyState({ onNewSession }: { onNewSession: () => void }): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <Terminal className="h-6 w-6 text-fg-subtle" />
      <div>
        <p className="text-[13px] text-fg-muted">No session selected</p>
        <p className="mt-1 text-xs text-fg-subtle">
          Pick a session in the sidebar, or add a folder to work in.
        </p>
      </div>
      <Button size="sm" onClick={onNewSession}>
        <Plus className="h-3.5 w-3.5" />
        New session
      </Button>
    </div>
  )
}

export function App(): JSX.Element {
  const init = useWorkspace((state) => state.init)
  const ready = useWorkspace((state) => state.ready)
  const sessions = useWorkspace((state) => state.sessions)
  const selectedSessionId = useWorkspace((state) => state.selectedSessionId)
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [defaultProjectId, setDefaultProjectId] = useState<string | undefined>(undefined)

  useEffect(() => {
    void init()
  }, [init])

  const selected = sessions.find((session) => session.id === selectedSessionId) ?? null

  const openNewSession = (projectId?: string): void => {
    setDefaultProjectId(projectId)
    setNewSessionOpen(true)
  }

  return (
    <div className="flex h-full w-full overflow-hidden bg-bg">
      <Sidebar onNewProject={() => setNewProjectOpen(true)} onNewSession={openNewSession} />

      <main className="min-w-0 flex-1">
        {!ready ? null : selected ? (
          // Keyed so switching sessions mounts a fresh view; the xterm instance
          // behind it is kept alive by the session registry, not by React.
          <TerminalView key={selected.id} session={selected} />
        ) : (
          <EmptyState onNewSession={() => openNewSession()} />
        )}
      </main>

      <AddSessionDialog
        open={newSessionOpen}
        onOpenChange={setNewSessionOpen}
        defaultProjectId={defaultProjectId}
      />
      <NewProjectDialog open={newProjectOpen} onOpenChange={setNewProjectOpen} />
    </div>
  )
}
