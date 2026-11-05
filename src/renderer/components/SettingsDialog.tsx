import { useEffect, useRef, useState } from 'react'
import type { CodingAgent } from '@shared/types'
import { Input } from '@/components/ui/input'
import { AboutSettingsPanel } from '@/components/AboutSettingsPanel'
import { KeyboardShortcutsSettings } from '@/components/KeyboardShortcutsSettings'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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

const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string }> = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'agents', label: 'Agents' },
  { id: 'sidebar', label: 'Sidebar' },
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
  const setOpen = (value: boolean): void => {
    if (value) openSettings()
    else closeSettings()
  }
  const [activeSection, setActiveSection] = useState<SettingsSection>('appearance')
  const sectionButtonRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [settings, setSettings] = useState<TerminalSettings>(() => getTerminalSettings())
  const [availableFonts] = useState(() => listTerminalFonts())
  const platform = useWorkspace((state) => state.platform)
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex h-[min(42rem,85vh)] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Appearance changes apply immediately.
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
                  description="List terminal panes beneath their session."
                  testId="sidebar-terminal-instances"
                  onClick={() => updateSettings({ showTerminalInstances: !settings.showTerminalInstances })}
                />
              </section>
            )}

            {activeSection === 'about' && <AboutSettingsPanel />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
