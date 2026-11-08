import { useEffect, useState } from 'react'
import type { SessionKind } from '@shared/types'
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
}

export function AddSessionDialog({
  open,
  onOpenChange
}: AddSessionDialogProps): JSX.Element {
  const platform = useWorkspace((state) => state.platform)
  const wslAvailable = useWorkspace((state) => state.wslAvailable)
  const distros = useWorkspace((state) => state.distros)
  const refreshDistros = useWorkspace((state) => state.refreshDistros)
  const addSession = useWorkspace((state) => state.addSession)

  // The location choice only exists on Windows, and only with a working wsl.exe.
  const showLocationChoice = Boolean(platform?.isWindows) && wslAvailable

  const [name, setName] = useState('')
  const [kind, setKind] = useState<SessionKind>('native')
  const [distro, setDistro] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!open) return
    setName('')
    setKind('native')
    setCreating(false)
    setDistro(wslAvailable ? (distros.find((d) => d.isDefault)?.name ?? '') : '')
    if (wslAvailable) void refreshDistros()
    // This resets the form once per open. A distro refresh must not clear fields
    // the user has already entered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, wslAvailable, refreshDistros])

  useEffect(() => {
    if (!distro && distros.length > 0) {
      setDistro(distros.find((d) => d.isDefault)?.name ?? distros[0]?.name ?? '')
    }
  }, [distros, distro])

  const canCreate =
    name.trim().length > 0 &&
    (kind === 'native' || distro.length > 0) &&
    !creating

  const create = async (): Promise<void> => {
    if (!canCreate) return
    setCreating(true)
    try {
      await addSession({
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
            Choose a name and environment. New terminals start in your home directory.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5">
          {showLocationChoice && (
            <div className="space-y-1.5">
              <Label>Location</Label>
              <RadioGroup
                value={kind}
                onValueChange={(value) => setKind(value as SessionKind)}
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
