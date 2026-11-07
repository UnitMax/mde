import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AboutSettingsPanel } from '@/components/AboutSettingsPanel'
import { KeyboardShortcutsSettings } from '@/components/KeyboardShortcutsSettings'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SwitchRow } from '@/components/ui/switch'
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
  { id: 'opencode', label: 'OpenCode' },
  { id: 'sidebar', label: 'Sidebar' },
  { id: 'about', label: 'About' }
]

/** Why the OpenCode command cannot be used, or null. */
function openCodeExecutableError(value: string): string | null {
  const executable = value.trim()
  if (!executable) return 'Enter an executable name.'
  if (/[\u0000-\u001f\u007f]/.test(executable)) return 'The executable contains a control character.'
  return null
}

/** The single application Settings dialog, opened through the workspace store from anywhere. */
export function SettingsDialog({ terminalIds }: { terminalIds: string[] }): JSX.Element {
  const open = useWorkspace((state) => state.settingsDialog.open)
  const requestedSection = useWorkspace((state) => state.settingsDialog.section)
  const openSettings = useWorkspace((state) => state.openSettings)
  const closeSettings = useWorkspace((state) => state.closeSettings)
  const openOpenCodeConfig = useWorkspace((state) => state.openOpenCodeConfig)
  const setOpen = (value: boolean): void => {
    if (value) openSettings()
    else closeSettings()
  }
  const [activeSection, setActiveSection] = useState<SettingsSection>('appearance')
  const sectionButtonRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [settings, setSettings] = useState<TerminalSettings>(() => getTerminalSettings())
  const [availableFonts] = useState(() => listTerminalFonts())
  const executableError = openCodeExecutableError(settings.openCodeExecutable)
  const platform = useWorkspace((state) => state.platform)
  // OpenCode, and so its settings, is only used on macOS and (inside WSL) on Windows.
  const openCodeAvailable = platform?.platform === 'darwin' || platform?.platform === 'win32'
  const sections = openCodeAvailable ? SETTINGS_SECTIONS : SETTINGS_SECTIONS.filter((section) => section.id !== 'opencode')
  useEffect(() => {
    if (open) setActiveSection(requestedSection)
  }, [open, requestedSection])
  // The OpenCode section is not offered where OpenCode is not used; one that was open is left for the first.
  const shownSection = sections.some((section) => section.id === activeSection) ? activeSection : 'appearance'

  const selectSection = (section: SettingsSection): void => {
    setActiveSection(section)
  }

  const moveSection = (currentIndex: number, delta: number): void => {
    const nextIndex = (currentIndex + delta + sections.length) % sections.length
    const nextSection = sections[nextIndex]
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
      const firstSection = sections[0]
      if (firstSection) {
        setActiveSection(firstSection.id)
        sectionButtonRefs.current[0]?.focus()
      }
    } else if (event.key === 'End') {
      event.preventDefault()
      const lastIndex = sections.length - 1
      const lastSection = sections[lastIndex]
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
              {sections.map((section, index) => {
                const active = shownSection === section.id
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
            aria-labelledby={`terminal-settings-tab-${shownSection}`}
            tabIndex={0}
            className="min-w-0 min-h-0 overflow-y-auto pr-1"
          >
            {shownSection === 'appearance' && (
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

            {shownSection === 'terminal' && (
              <section className="space-y-3" aria-labelledby="terminal-settings">
                <div>
                  <h3 id="terminal-settings" className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                    Terminal
                  </h3>
                  <p className="mt-1 text-xs text-fg-subtle">
                    Configure terminal behavior and keyboard shortcuts.
                  </p>
                </div>
                <SwitchRow
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

            {shownSection === 'shortcuts' && (
              <KeyboardShortcutsSettings
                platform={platform?.platform ?? 'other'}
                escapeExitsFullscreen={settings.escapeExitsFullscreen}
              />
            )}

            {shownSection === 'opencode' && (
              <section className="space-y-4" aria-labelledby="opencode-settings">
                <div>
                  <h3 id="opencode-settings" className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                    OpenCode
                  </h3>
                  <p className="mt-1 text-xs text-fg-subtle">
                    How the Inbox starts OpenCode, and OpenCode’s own configuration.
                  </p>
                </div>

                <div className="space-y-2 rounded border border-line bg-panel p-3">
                  <label className="block text-xs font-medium text-fg-muted">
                    Executable
                    <Input
                      value={settings.openCodeExecutable}
                      onChange={(event) => updateSettings({ openCodeExecutable: event.target.value })}
                      className="mt-1"
                      data-testid="opencode-executable"
                      spellCheck={false}
                    />
                  </label>
                  {executableError ? (
                    <p className="text-[11px] text-danger" data-testid="opencode-executable-error">
                      {executableError} The Inbox keeps using the previous command.
                    </p>
                  ) : (
                    <p className="text-[11px] text-fg-subtle">
                      The command that starts OpenCode for the Inbox: its background service and its terminal threads.
                      A missing program is reported by the Inbox, not here.
                    </p>
                  )}
                </div>

                <div className="space-y-2 rounded border border-line bg-panel p-3" data-testid="opencode-config-entry">
                  <div>
                    <h4 className="text-xs font-medium text-fg">OpenCode configuration</h4>
                    <p className="mt-0.5 text-[11px] text-fg-subtle">
                      Permission rules, custom OpenAI-compatible providers and disabled providers, in OpenCode’s global configuration file.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    data-testid="opencode-config-open"
                    onClick={() => {
                      closeSettings()
                      openOpenCodeConfig()
                    }}
                  >
                    Edit configuration…
                  </Button>
                </div>
              </section>
            )}

            {shownSection === 'sidebar' && (
              <section className="space-y-3" aria-labelledby="sidebar-settings">
                <div>
                  <h3 id="sidebar-settings" className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                    Sidebar
                  </h3>
                  <p className="mt-1 text-xs text-fg-subtle">
                    Choose which individual terminal activity appears beneath each session.
                  </p>
                </div>
                <SwitchRow
                  checked={settings.showTerminalInstances}
                  label="Show terminal instances"
                  description="List terminal panes beneath their session."
                  testId="sidebar-terminal-instances"
                  onClick={() => updateSettings({ showTerminalInstances: !settings.showTerminalInstances })}
                />
              </section>
            )}

            {shownSection === 'about' && <AboutSettingsPanel />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
