import { useEffect, useState } from 'react'
import { Plus, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AddProjectDialog } from '@/components/AddProjectDialog'
import { Sidebar } from '@/components/Sidebar'
import { TerminalView } from '@/components/TerminalView'
import { useProjects } from '@/store/projects'

function EmptyState({ onNewProject }: { onNewProject: () => void }): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <Terminal className="h-6 w-6 text-fg-subtle" />
      <div>
        <p className="text-[13px] text-fg-muted">No project selected</p>
        <p className="mt-1 text-xs text-fg-subtle">
          Pick a project in the sidebar, or add a folder to work in.
        </p>
      </div>
      <Button size="sm" onClick={onNewProject}>
        <Plus className="h-3.5 w-3.5" />
        New project
      </Button>
    </div>
  )
}

export function App(): JSX.Element {
  const init = useProjects((state) => state.init)
  const ready = useProjects((state) => state.ready)
  const projects = useProjects((state) => state.projects)
  const selectedId = useProjects((state) => state.selectedId)
  const [addOpen, setAddOpen] = useState(false)

  useEffect(() => {
    void init()
  }, [init])

  const selected = projects.find((project) => project.id === selectedId) ?? null

  return (
    <div className="flex h-full w-full overflow-hidden bg-bg">
      <Sidebar onNewProject={() => setAddOpen(true)} />

      <main className="min-w-0 flex-1">
        {!ready ? null : selected ? (
          // Keyed so switching projects mounts a fresh view; the xterm instance
          // behind it is kept alive by the session registry, not by React.
          <TerminalView key={selected.id} project={selected} />
        ) : (
          <EmptyState onNewProject={() => setAddOpen(true)} />
        )}
      </main>

      <AddProjectDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  )
}
