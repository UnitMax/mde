import { useEffect, useState } from 'react'
import type { ProjectKind } from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useWorkspace } from '@/store/workspace'

interface AddSessionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultProjectId?: string
}

export function AddSessionDialog({
  open,
  onOpenChange,
  defaultProjectId
}: AddSessionDialogProps): JSX.Element {
  const platform = useWorkspace((state) => state.platform)
  const projects = useWorkspace((state) => state.projects)
  const wslAvailable = useWorkspace((state) => state.wslAvailable)
  const distros = useWorkspace((state) => state.distros)
  const refreshDistros = useWorkspace((state) => state.refreshDistros)
  const addSession = useWorkspace((state) => state.addSession)

  // The location choice only exists on Windows, and only with a working wsl.exe.
  const showLocationChoice = Boolean(platform?.isWindows) && wslAvailable

  const [name, setName] = useState('')
  const [projectId, setProjectId] = useState('')
  const [kind, setKind] = useState<ProjectKind>('native')
  const [distro, setDistro] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!open) return
    setName('')
    setProjectId(
      defaultProjectId && projects.some((project) => project.id === defaultProjectId)
        ? defaultProjectId
        : (projects[0]?.id ?? '')
    )
    setKind('native')
    setCreating(false)
    setDistro(wslAvailable ? (distros.find((d) => d.isDefault)?.name ?? '') : '')
    if (wslAvailable) void refreshDistros()
    // This resets the form once per open. A distro refresh must not clear fields
    // the user has already entered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultProjectId, projects, wslAvailable, refreshDistros])

  useEffect(() => {
    if (!distro && distros.length > 0) {
      setDistro(distros.find((d) => d.isDefault)?.name ?? distros[0]?.name ?? '')
    }
  }, [distros, distro])

  const canCreate =
    projectId.length > 0 &&
    name.trim().length > 0 &&
    (kind === 'native' || distro.length > 0) &&
    !creating

  const create = async (): Promise<void> => {
    if (!canCreate) return
    setCreating(true)
    try {
      await addSession({
        projectId,
        name: name.trim(),
        kind,
        ...(kind === 'wsl' ? { distro } : {})
      })
      onOpenChange(false)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onKeyDown={(event) => {
          if (event.key === 'Enter' && canCreate) {
            event.preventDefault()
            void create()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>New session</DialogTitle>
          <DialogDescription>
            Add a terminal session to a project. New terminals start in your home directory.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5">
          {projects.length === 0 ? (
            <p className="rounded border border-warn/40 bg-warn/10 p-2.5 text-xs text-warn">
              Create a project before adding a session.
            </p>
          ) : (
            <div className="space-y-1.5">
              <Label>Project</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {showLocationChoice && (
            <div className="space-y-1.5">
              <Label>Location</Label>
              <RadioGroup
                value={kind}
                onValueChange={(value) => setKind(value as ProjectKind)}
              >
                <RadioGroupItem value="native">Windows</RadioGroupItem>
                <RadioGroupItem value="wsl">WSL</RadioGroupItem>
              </RadioGroup>
            </div>
          )}

          {showLocationChoice && kind === 'wsl' && (
            <div className="space-y-1.5">
              <Label>Distro</Label>
              <Select value={distro} onValueChange={setDistro}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a distro" />
                </SelectTrigger>
                <SelectContent>
                  {distros.map((option) => (
                    <SelectItem key={option.name} value={option.name}>
                      {option.name}
                      {option.isDefault ? ' (default)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {distros.length === 0 && (
                <p className="text-xs text-fg-subtle">No WSL 2 distros found.</p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="session-name">Session name</Label>
            <Input
              id="session-name"
              value={name}
              placeholder="app"
              onChange={(event) => setName(event.target.value)}
            />
          </div>

        </div>

        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!canCreate} onClick={() => void create()}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

  )
}
