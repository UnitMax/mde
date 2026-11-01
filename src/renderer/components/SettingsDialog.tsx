import { useEffect, useRef, useState } from 'react'
import type {
  OpenCodeTuiPluginState,
  OpenCodeTuiInstanceLabelMode,
  OpenCodeTuiSettings,
  OpenCodePluginTarget,
  OpenCodeAlertSettings,
  CodingAgent
} from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AboutSettingsPanel } from '@/components/AboutSettingsPanel'
import { KeyboardShortcutsSettings } from '@/components/KeyboardShortcutsSettings'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { useWorkspace, type SettingsSection } from '@/store/workspace'
import { applyTerminalSettings, fitSession, getSession } from '@/terminal/sessions'
import { isOsc52Policy, OSC52_POLICIES, type Osc52Policy } from '@/terminal/osc52'
import {
  getTerminalSettings,
  listTerminalFonts,
  saveTerminalSettings,
  TERMINAL_LINE_HEIGHTS,
  TERMINAL_FONT_SIZES,
  type TerminalSettings
} from '@/terminal/terminal-settings'
import { APPLICATION_THEMES, applyApplicationTheme } from '@/theme/themes'
import { AGENT_COMMAND_OPTIONS, agentCommandSettingError } from '@/lib/agent-commands'
import { syncWindowChrome } from '@/lib/window-chrome'

const OSC52_POLICY_LABELS: Record<Osc52Policy, string> = {
  notify: 'Allow and notify me',
  ask: 'Ask the first time in each terminal',
  never: 'Never allow'
}

function pluginStatusLabel(state: OpenCodeTuiPluginState | undefined): string {
  if (!state) return 'Checking…'
  if (state.status === 'installed') return `Installed · v${state.installedVersion}`
  if (state.status === 'outdated') {
    return `Update available · v${state.installedVersion ?? 'unknown'} → v${state.currentVersion}`
  }
  if (state.status === 'conflict') return 'Another plugin owns the MDE plugin files'
  return 'Not installed'
}

function pluginTargetKey(target: OpenCodePluginTarget): string {
  return target.kind === 'native' ? 'native' : 'wsl:' + target.distro
}

function pluginTargetLabel(target: OpenCodePluginTarget, platform?: string): string {
  return target.kind === 'native' ? (platform === 'darwin' ? 'This Mac' : 'Native Linux') : target.distro + ' (WSL 2)'
}

const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string }> = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'agents', label: 'Agents' },
  { id: 'sidebar', label: 'Sidebar' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'about', label: 'About' }
]

function SettingsToggle({
  checked,
  label,
  description,
  testId,
  onClick
}: {
  checked: boolean
  label: string
  description: string
  testId: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-testid={testId}
      onClick={onClick}
      className="flex w-full items-center justify-between rounded border border-line bg-panel px-3 py-2 text-left text-xs text-fg-muted hover:bg-hover"
    >
      <span>
        <span className="block font-medium text-fg">{label}</span>
        <span className="mt-0.5 block text-fg-subtle">{description}</span>
      </span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-line-strong'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  )
}

/** The single application Settings dialog, opened through the workspace store from anywhere. */
export function SettingsDialog({ terminalIds }: { terminalIds: string[] }): JSX.Element {
  const open = useWorkspace((state) => state.settingsDialog.open)
  const requestedSection = useWorkspace((state) => state.settingsDialog.section)
  const openSettings = useWorkspace((state) => state.openSettings)
  const closeSettings = useWorkspace((state) => state.closeSettings)
  const setOpenCodeTuiEnabled = useWorkspace((state) => state.setOpenCodeTuiEnabled)
  const setOpen = (value: boolean): void => {
    if (value) openSettings()
    else closeSettings()
  }
  const [activeSection, setActiveSection] = useState<SettingsSection>('appearance')
  const sectionButtonRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [settings, setSettings] = useState<TerminalSettings>(() => getTerminalSettings())
  const [availableFonts] = useState(() => listTerminalFonts())
  const platform = useWorkspace((state) => state.platform)
  const wslAvailable = useWorkspace((state) => state.wslAvailable)
  const distros = useWorkspace((state) => state.distros)
  const refreshDistros = useWorkspace((state) => state.refreshDistros)
  const opencodeTuiInstanceLabelMode = useWorkspace((state) => state.opencodeTuiInstanceLabelMode)
  const setOpenCodeTuiInstanceLabelMode = useWorkspace(
    (state) => state.setOpenCodeTuiInstanceLabelMode
  )
  const [tuiSettings, setTuiSettings] = useState<OpenCodeTuiSettings>({
    enabled: false,
    currentPluginVersion: '',
    instanceLabelMode: 'numbered'
  })
  const [pluginStates, setPluginStates] = useState<Record<string, OpenCodeTuiPluginState>>({})
  const [tuiLoading, setTuiLoading] = useState(false)
  const [tuiBusyDistro, setTuiBusyDistro] = useState<string | null>(null)
  const [tuiError, setTuiError] = useState<string | null>(null)
  const [alertSettings, setAlertSettings] = useState<OpenCodeAlertSettings>({ enabled: true })
  const [alertLoading, setAlertLoading] = useState(false)
  const [alertError, setAlertError] = useState<string | null>(null)

  const canManageTui = platform?.platform === 'darwin' || (platform?.isWindows === true && wslAvailable)
  const pluginTargets: OpenCodePluginTarget[] =
    platform?.platform === 'darwin'
      ? [{ kind: 'native' }]
      : distros.map((distro) => ({ kind: 'wsl', distro: distro.name }))

  useEffect(() => {
    if (open) setActiveSection(requestedSection)
  }, [open, requestedSection])

  const selectSection = (section: SettingsSection): void => {
    setActiveSection(section)
  }

  const moveSection = (currentIndex: number, delta: number): void => {
    const nextIndex = (currentIndex + delta + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length
    const nextSection = SETTINGS_SECTIONS[nextIndex]
    if (!nextSection) return
    setActiveSection(nextSection.id)
    sectionButtonRefs.current[nextIndex]?.focus()
  }

  const handleSectionKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault()
      moveSection(index, 1)
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault()
      moveSection(index, -1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      const firstSection = SETTINGS_SECTIONS[0]
      if (firstSection) {
        setActiveSection(firstSection.id)
        sectionButtonRefs.current[0]?.focus()
      }
    } else if (event.key === 'End') {
      event.preventDefault()
      const lastIndex = SETTINGS_SECTIONS.length - 1
      const lastSection = SETTINGS_SECTIONS[lastIndex]
      if (lastSection) {
        setActiveSection(lastSection.id)
        sectionButtonRefs.current[lastIndex]?.focus()
      }
    }
  }

  useEffect(() => {
    if (open && platform?.isWindows && wslAvailable) void refreshDistros()
  }, [platform?.isWindows, wslAvailable, open, refreshDistros])

  const updateSettings = (patch: Partial<TerminalSettings>): void => {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveTerminalSettings(next)
    applyApplicationTheme(next.theme)
    if (patch.theme) syncWindowChrome(next.theme)
    applyTerminalSettings(next)

    terminalIds.forEach((terminalId) => {
      const terminal = getSession(terminalId)
      const size = terminal ? fitSession(terminal) : null
      if (size) void window.api.pty.resize({ terminalId, size })
    })
  }

  const updateAgentSetting = (
    kind: CodingAgent,
    patch: Partial<TerminalSettings['agents'][CodingAgent]>
  ): void => {
    updateSettings({
      agents: {
        ...settings.agents,
        [kind]: { ...settings.agents[kind], ...patch }
      }
    })
  }

  useEffect(() => {
    if (!open || !canManageTui) return
    let cancelled = false
    setTuiLoading(true)
    setTuiError(null)
    const targets: OpenCodePluginTarget[] = platform?.platform === 'darwin'
      ? [{ kind: 'native' }]
      : distros.map((distro) => ({ kind: 'wsl', distro: distro.name }))
    void Promise.all([
      window.api.opencodeTui.settings(),
      Promise.allSettled(
        targets.map((target) => window.api.opencodeTui.pluginState({ target }))
      )
    ])
      .then(([nextSettings, stateResults]) => {
        if (cancelled) return
        const nextStates: Record<string, OpenCodeTuiPluginState> = {}
        const failures: string[] = []
        stateResults.forEach((result) => {
          if (result.status === 'fulfilled') {
            nextStates[pluginTargetKey(result.value.target)] = result.value
          } else {
            failures.push(ipcErrorMessage(result.reason, 'Could not inspect this OpenCode target.'))
          }
        })
        setTuiSettings(nextSettings)
        setPluginStates(nextStates)
        if (failures.length > 0) setTuiError(failures[0] ?? 'Could not inspect one or more OpenCode targets.')
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setTuiError(ipcErrorMessage(error, 'Could not update the OpenCode status plugin.'))
        }
      })
      .finally(() => {
        if (!cancelled) setTuiLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [canManageTui, distros, open, platform?.platform])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setAlertLoading(true)
    setAlertError(null)
    void window.api.opencodeAlerts
      .settings()
      .then((next) => {
        if (!cancelled) setAlertSettings(next)
      })
      .catch((error: unknown) => {
        if (!cancelled) setAlertError(ipcErrorMessage(error, 'Could not update OpenCode alerts.'))
      })
      .finally(() => {
        if (!cancelled) setAlertLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const setTuiEnabled = async (): Promise<void> => {
    setTuiError(null)
    try {
      const next = await window.api.opencodeTui.setEnabled({ enabled: !tuiSettings.enabled })
      setTuiSettings(next)
      setOpenCodeTuiEnabled(next.enabled)
    } catch (error) {
      setTuiError(ipcErrorMessage(error, 'Could not update the OpenCode status plugin.'))
    }
  }

  const changeTuiInstanceLabelMode = async (
    mode: OpenCodeTuiInstanceLabelMode
  ): Promise<void> => {
    setTuiError(null)
    try {
      await setOpenCodeTuiInstanceLabelMode(mode)
      setTuiSettings((current) => ({ ...current, instanceLabelMode: mode }))
    } catch (error) {
      setTuiError(ipcErrorMessage(error, 'Could not update the OpenCode status plugin.'))
    }
  }

  const setAlertsEnabled = async (): Promise<void> => {
    setAlertError(null)
    setAlertLoading(true)
    try {
      const next = await window.api.opencodeAlerts.setEnabled({ enabled: !alertSettings.enabled })
      setAlertSettings(next)
    } catch (error) {
      setAlertError(ipcErrorMessage(error, 'Could not update OpenCode alerts.'))
    } finally {
      setAlertLoading(false)
    }
  }

  const changePlugin = async (target: OpenCodePluginTarget, action: 'install' | 'remove'): Promise<void> => {
    setTuiBusyDistro(pluginTargetKey(target))
    setTuiError(null)
    try {
      const state =
        action === 'install'
          ? await window.api.opencodeTui.install({ target })
          : await window.api.opencodeTui.remove({ target })
      setPluginStates((current) => ({ ...current, [pluginTargetKey(target)]: state }))
    } catch (error) {
      setTuiError(ipcErrorMessage(error, 'Could not update the OpenCode status plugin.'))
    } finally {
      setTuiBusyDistro(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex h-[min(42rem,85vh)] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Appearance changes apply immediately. Plugin changes apply after OpenCode is restarted.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-[10rem_minmax(0,1fr)] gap-5 overflow-hidden">
          <div className="min-w-0 border-r border-line pr-3">
            <div
              role="tablist"
              aria-label="Settings sections"
              aria-orientation="vertical"
              className="flex flex-col gap-1"
            >
              {SETTINGS_SECTIONS.map((section, index) => {
                const active = activeSection === section.id
                return (
                  <button
                    key={section.id}
                    ref={(element) => {
                      sectionButtonRefs.current[index] = element
                    }}
                    type="button"
                    id={`terminal-settings-tab-${section.id}`}
                    role="tab"
                    aria-selected={active}
                    aria-controls="terminal-settings-panel"
                    tabIndex={active ? 0 : -1}
                    onClick={() => selectSection(section.id)}
                    onKeyDown={(event) => handleSectionKeyDown(event, index)}
                    className={`w-full rounded px-3 py-2 text-left text-xs font-medium transition-colors ${
                      active ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg'
                    }`}
                  >
                    {section.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div
            id="terminal-settings-panel"
            role="tabpanel"
            aria-labelledby={`terminal-settings-tab-${activeSection}`}
            tabIndex={0}
            className="min-w-0 min-h-0 overflow-y-auto pr-1"
          >
            {activeSection === 'appearance' && (
              <section className="space-y-3" aria-labelledby="appearance-settings">
                <h3 id="appearance-settings" className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                  Appearance
                </h3>
                <div className="space-y-4">
                  <label className="block text-xs font-medium text-fg-muted">
                    Application theme
                    <Select
                      value={settings.theme}
                      onValueChange={(value) => {
                        const theme = APPLICATION_THEMES.find((option) => option.id === value)
                        if (theme) updateSettings({ theme: theme.id })
                      }}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {APPLICATION_THEMES.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>

                  <label className="block text-xs font-medium text-fg-muted">
                    Terminal font family
                    <Select value={settings.family} onValueChange={(family) => updateSettings({ family })}>
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {availableFonts.map((font) => (
                          <SelectItem key={font.family} value={font.family}>
                            {font.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>

                  <label className="block text-xs font-medium text-fg-muted">
                    Terminal font size
                    <Select
                      value={String(settings.size)}
                      onValueChange={(value) => {
                        const size = TERMINAL_FONT_SIZES.find((candidate) => String(candidate) === value)
                        if (size !== undefined) updateSettings({ size })
                      }}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TERMINAL_FONT_SIZES.map((size) => (
                          <SelectItem key={size} value={String(size)}>
                            {size}px
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>

                  <label className="block text-xs font-medium text-fg-muted">
                    Terminal line height
                    <Select
                      value={String(settings.lineHeight)}
                      onValueChange={(value) => {
                        const lineHeight = TERMINAL_LINE_HEIGHTS.find(
                          (candidate) => String(candidate) === value
                        )
                        if (lineHeight !== undefined) updateSettings({ lineHeight })
                      }}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TERMINAL_LINE_HEIGHTS.map((lineHeight) => (
                          <SelectItem key={lineHeight} value={String(lineHeight)}>
                            {lineHeight.toFixed(1)}×
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>

                  <label className="block text-xs font-medium text-fg-muted">
                    Code preview font family
                    <Select
                      value={settings.codeFamily}
                      onValueChange={(codeFamily) => updateSettings({ codeFamily })}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {availableFonts.map((font) => (
                          <SelectItem key={font.family} value={font.family}>
                            {font.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                </div>
              </section>
            )}

            {activeSection === 'terminal' && (
              <section className="space-y-3" aria-labelledby="terminal-settings">
                <div>
                  <h3 id="terminal-settings" className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                    Terminal
                  </h3>
                  <p className="mt-1 text-xs text-fg-subtle">
                    Configure terminal behavior and keyboard shortcuts.
                  </p>
                </div>
                <SettingsToggle
                  checked={settings.escapeExitsFullscreen}
                  label="Exit fullscreen with Escape"
                  description="Press Escape to leave the temporary fullscreen terminal view."
                  testId="terminal-escape-fullscreen"
                  onClick={() => updateSettings({ escapeExitsFullscreen: !settings.escapeExitsFullscreen })}
                />

                <label className="block text-xs font-medium text-fg-muted">
                  Clipboard access from terminal programs
                  <Select
                    value={settings.osc52Policy}
                    onValueChange={(value) => {
                      if (isOsc52Policy(value)) updateSettings({ osc52Policy: value })
                    }}
                  >
                    <SelectTrigger className="mt-1" data-testid="terminal-osc52-policy">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OSC52_POLICIES.map((policy) => (
                        <SelectItem key={policy} value={policy}>
                          {OSC52_POLICY_LABELS[policy]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="mt-1 block font-normal text-fg-subtle">
                    Programs can ask to set the clipboard with an escape sequence, which editors
                    use for yank over SSH. Whatever you choose here, a terminal that is hidden,
                    unfocused, or that you have not just typed in is always refused.
                  </span>
                </label>
              </section>
            )}

            {activeSection === 'shortcuts' && (
              <KeyboardShortcutsSettings
                platform={platform?.platform ?? 'other'}
                escapeExitsFullscreen={settings.escapeExitsFullscreen}
              />
            )}

            {activeSection === 'agents' && (
              <section className="space-y-4" aria-labelledby="agent-settings">
                <div>
                  <h3 id="agent-settings" className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                    Agents
                  </h3>
                  <p className="mt-1 text-xs text-fg-subtle">
                    Configure the commands available from Ctrl+N and Cmd+N. These commands run directly in WSL from the focused terminal directory.
                  </p>
                </div>

                <div className="space-y-3">
                  {AGENT_COMMAND_OPTIONS.map((option) => {
                    const setting = settings.agents[option.kind]
                    const error = agentCommandSettingError(setting)
                    return (
                      <div key={option.kind} className="space-y-2 rounded border border-line bg-panel p-3">
                        <div>
                          <h4 className="text-xs font-medium text-fg">{option.label}</h4>
                          <p className="mt-0.5 text-[11px] text-fg-subtle">{option.description}</p>
                        </div>
                        <label className="block text-xs font-medium text-fg-muted">
                          Executable
                          <Input
                            value={setting.executable}
                            onChange={(event) => updateAgentSetting(option.kind, { executable: event.target.value })}
                            className="mt-1"
                            data-testid={`agent-${option.kind}-executable`}
                            spellCheck={false}
                          />
                        </label>
                        <label className="block text-xs font-medium text-fg-muted">
                          Arguments
                          <Input
                            value={setting.args}
                            onChange={(event) => updateAgentSetting(option.kind, { args: event.target.value })}
                            className="mt-1"
                            placeholder="Optional shell-style arguments"
                            data-testid={`agent-${option.kind}-args`}
                            spellCheck={false}
                          />
                        </label>
                        {error ? (
                          <p className="text-[11px] text-danger">{error} This option will be disabled in the launcher.</p>
                        ) : (
                          <p className="text-[11px] text-fg-subtle">
                            The executable is checked when the command starts; a missing CLI will show its normal shell error.
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {activeSection === 'sidebar' && (
              <section className="space-y-3" aria-labelledby="sidebar-settings">
                <div>
                  <h3 id="sidebar-settings" className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                    Sidebar
                  </h3>
                  <p className="mt-1 text-xs text-fg-subtle">
                    Choose which individual terminal activity appears beneath each session.
                  </p>
                </div>
                <SettingsToggle
                  checked={settings.showTerminalInstances}
                  label="Show terminal instances"
                  description="List ordinary terminal panes beneath their session."
                  testId="sidebar-terminal-instances"
                  onClick={() => updateSettings({ showTerminalInstances: !settings.showTerminalInstances })}
                />
              </section>
            )}

            {activeSection === 'opencode' && (
              <section className="space-y-6" aria-labelledby="opencode-settings">
                <div>
                  <h3 id="opencode-settings" className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                    OpenCode
                  </h3>
                  <p className="mt-1 text-xs text-fg-subtle">
                    Configure desktop alerts and session status reporting.
                  </p>
                </div>

                <section className="space-y-3" aria-labelledby="opencode-alert-settings">
                  <div>
                    <h4 id="opencode-alert-settings" className="text-xs font-medium text-fg">
                      Alerts
                    </h4>
                    <p className="mt-1 text-xs text-fg-subtle">
                      {platform?.platform === 'darwin' ? 'Request Dock attention' : 'Flash the taskbar'} and play a sound when OpenCode finishes, needs input, or encounters an error while MDE is unfocused.
                    </p>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={alertSettings.enabled}
                    data-testid="opencode-alerts-enabled"
                    disabled={alertLoading}
                    onClick={() => void setAlertsEnabled()}
                    className="flex w-full items-center justify-between rounded border border-line bg-panel px-3 py-2 text-left text-xs text-fg-muted hover:bg-hover disabled:pointer-events-none disabled:opacity-50"
                  >
                    <span>
                      <span className="block font-medium text-fg">Enable OpenCode alerts</span>
                      <span className="mt-0.5 block text-fg-subtle">
                        {alertSettings.enabled ? 'Alerts are enabled.' : 'Alerts are disabled.'}
                      </span>
                    </span>
                    <span
                      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                        alertSettings.enabled ? 'bg-accent' : 'bg-line-strong'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                          alertSettings.enabled ? 'translate-x-4' : 'translate-x-0.5'
                        }`}
                      />
                    </span>
                  </button>
                  {alertError && <p className="text-xs text-danger">{alertError}</p>}
                </section>

                <section
                  className="space-y-3 border-t border-line pt-5"
                  aria-labelledby="opencode-tui-settings"
                >
                  <div>
                    <h4 id="opencode-tui-settings" className="text-xs font-medium text-fg">
                      Session status
                    </h4>
                    <p className="mt-1 text-xs text-fg-subtle">
                      Install the status plugin (OpenCode 2 or newer) for this Mac or a WSL distro and control reporting across new sessions.
                    </p>
                  </div>

                  {!canManageTui ? (
                    <p className="rounded border border-line bg-panel px-3 py-2 text-xs text-fg-subtle">
                      This integration is available on macOS and Windows with WSL 2.
                    </p>
                  ) : (
                    <>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={tuiSettings.enabled}
                        data-testid="opencode-tui-enabled"
                        disabled={tuiLoading || !tuiSettings.currentPluginVersion}
                        onClick={() => void setTuiEnabled()}
                        className="flex w-full items-center justify-between rounded border border-line bg-panel px-3 py-2 text-left text-xs text-fg-muted hover:bg-hover disabled:pointer-events-none disabled:opacity-50"
                      >
                        <span>
                          <span className="block font-medium text-fg">Enable status reporting</span>
                          <span className="mt-0.5 block text-fg-subtle">
                            {tuiSettings.enabled
                              ? 'New and restarted terminals will report OpenCode TUI status.'
                              : 'Status reporting is disabled until you enable it.'}
                          </span>
                        </span>
                        <span
                          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                            tuiSettings.enabled ? 'bg-accent' : 'bg-line-strong'
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                              tuiSettings.enabled ? 'translate-x-4' : 'translate-x-0.5'
                            }`}
                          />
                        </span>
                      </button>

                      <label className="block text-xs font-medium text-fg-muted">
                        Instance labels
                        <Select
                          value={opencodeTuiInstanceLabelMode}
                          onValueChange={(value) => {
                            if (value === 'numbered' || value === 'title') {
                              void changeTuiInstanceLabelMode(value)
                            }
                          }}
                        >
                          <SelectTrigger className="mt-1" data-testid="opencode-tui-instance-labels">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="numbered">OpenCode 1, 2, …</SelectItem>
                            <SelectItem value="title">OpenCode session titles</SelectItem>
                          </SelectContent>
                        </Select>
                        <span className="mt-1 block text-[11px] font-normal text-fg-subtle">
                          Session titles stay in MDE's local runtime status snapshot. Numbered labels are used when a title is unavailable.
                        </span>
                      </label>

                      <div className="space-y-2">
                        {pluginTargets.length === 0 ? (
                          <p className="text-xs text-fg-subtle">No WSL 2 distros found.</p>
                        ) : (
                          pluginTargets.map((target) => {
                            const key = pluginTargetKey(target)
                            const state = pluginStates[key]
                            const busy = tuiBusyDistro === key
                            const action = state?.status === 'installed' ? 'remove' : 'install'
                            const actionLabel =
                              state?.status === 'outdated'
                                ? 'Replace'
                                : state?.status === 'installed'
                                  ? 'Uninstall'
                                  : state?.status === 'conflict'
                                    ? 'Unavailable'
                                    : 'Install'
                            return (
                              <div
                                key={key}
                                className="flex items-center gap-3 rounded border border-line bg-panel px-3 py-2"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-xs font-medium text-fg">{pluginTargetLabel(target, platform?.platform)}</div>
                                  <div className="truncate text-[11px] text-fg-subtle">
                                    {pluginStatusLabel(state)}
                                  </div>
                                </div>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  disabled={busy || state?.status === 'conflict' || !state}
                                  onClick={() => void changePlugin(target, action)}
                                >
                                  {busy ? 'Working…' : actionLabel}
                                </Button>
                              </div>
                            )
                          })
                        )}
                      </div>
                      <p className="text-[11px] text-fg-subtle">
                        Current plugin version: v{tuiSettings.currentPluginVersion || '…'}. Restart OpenCode after installing,
                        replacing, or uninstalling the plugin.
                      </p>
                    </>
                  )}
                  {tuiError && <p className="text-xs text-danger">{tuiError}</p>}
                </section>
              </section>
            )}

            {activeSection === 'about' && <AboutSettingsPanel />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
