import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import {
  toolReviewerModelError,
  toolReviewerUrlError,
  type ToolReviewerSettings as Settings,
  type ToolReviewerTestResult,
} from '@shared/tool-reviewer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SwitchRow } from '@/components/ui/switch'
import { ipcErrorMessage } from '@/lib/ipc-error'

/**
 * Settings → OpenCode: the model behind the "Auto (reviewed)" permission mode, at any OpenAI-compatible endpoint
 * (OpenRouter, a local Ollama or LM Studio, a hosted API). The key is sent once and kept encrypted by main; this
 * page only learns whether one is saved.
 */
export function ToolReviewerSettings(): JSX.Element {
  const [saved, setSaved] = useState<Settings | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [key, setKey] = useState('')
  const [askMediumRisk, setAskMediumRisk] = useState(true)
  const [busy, setBusy] = useState<'save' | 'test' | 'remove-key' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [test, setTest] = useState<ToolReviewerTestResult | null>(null)

  const take = (settings: Settings): void => {
    setSaved(settings)
    setBaseUrl(settings.baseUrl)
    setModel(settings.model)
    setAskMediumRisk(settings.askMediumRisk)
    setKey('')
  }

  useEffect(() => {
    window.api.toolReviewer.settings().then(take, (reason: unknown) => setError(ipcErrorMessage(reason, 'MDE could not read the reviewer settings.')))
  }, [])

  const off = !baseUrl.trim() && !model.trim()
  const problem = off ? null : toolReviewerUrlError(baseUrl) ?? toolReviewerModelError(model)
  const dirty = saved !== null && (baseUrl !== saved.baseUrl || model !== saved.model || askMediumRisk !== saved.askMediumRisk || key.trim() !== '')

  const save = async (removeKey = false): Promise<void> => {
    setBusy(removeKey ? 'remove-key' : 'save')
    setError(null)
    setTest(null)
    try {
      take(await window.api.toolReviewer.save({
        baseUrl,
        model,
        askMediumRisk,
        ...(removeKey ? { key: null } : key.trim() ? { key: key.trim() } : {}),
      }))
    } catch (reason) {
      setError(ipcErrorMessage(reason, 'MDE could not save the reviewer settings.'))
    } finally {
      setBusy(null)
    }
  }

  const runTest = async (): Promise<void> => {
    setBusy('test')
    setError(null)
    setTest(null)
    try {
      setTest(await window.api.toolReviewer.test())
    } catch (reason) {
      setError(ipcErrorMessage(reason, 'MDE could not test the reviewer.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-2 rounded border border-line bg-panel p-3" data-testid="tool-reviewer-settings">
      <div>
        <h4 className="text-xs font-medium text-fg">Tool reviewer</h4>
        <p className="mt-0.5 text-[11px] text-fg-subtle">
          The model behind the “Auto (reviewed)” permission mode. It approves the safe actions of such a thread and leaves
          the risky ones to you; it never rejects one. Any OpenAI-compatible endpoint works. Each action it judges (a
          command, a file path, a URL, an MCP tool’s input) and your latest messages in the thread are sent there.
        </p>
      </div>
      <label className="block text-xs font-medium text-fg-muted">
        Endpoint URL
        <Input
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="https://openrouter.ai/api/v1"
          className="mt-1"
          spellCheck={false}
          data-testid="tool-reviewer-url"
        />
      </label>
      <label className="block text-xs font-medium text-fg-muted">
        Model
        <Input
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder="vendor/model-name"
          className="mt-1"
          spellCheck={false}
          data-testid="tool-reviewer-model"
        />
      </label>
      <label className="block text-xs font-medium text-fg-muted">
        API key
        <Input
          type="password"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder={saved?.hasKey ? 'Saved. Type a new one to replace it.' : 'Not needed for a local server'}
          className="mt-1"
          autoComplete="off"
          spellCheck={false}
          data-testid="tool-reviewer-key"
        />
      </label>
      <SwitchRow
        checked={askMediumRisk}
        label="Ask about medium risk"
        description="Off lets through what the reviewer rates medium risk; high risk always asks."
        testId="tool-reviewer-medium"
        onClick={() => setAskMediumRisk(!askMediumRisk)}
      />
      {problem && <p className="text-[11px] text-danger" data-testid="tool-reviewer-problem">{problem}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button type="button" size="sm" disabled={!dirty || problem !== null || busy !== null} onClick={() => void save()} data-testid="tool-reviewer-save">
          {busy === 'save' && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
          Save
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={dirty || off || busy !== null} onClick={() => void runTest()} data-testid="tool-reviewer-test">
          {busy === 'test' && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
          Test
        </Button>
        {saved?.hasKey && (
          <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => void save(true)} data-testid="tool-reviewer-remove-key">
            {busy === 'remove-key' && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
            Remove key
          </Button>
        )}
      </div>
      {test && (
        <p role="status" className={test.ok ? 'text-[11px] text-fg-muted' : 'text-[11px] text-danger'} data-testid="tool-reviewer-test-result">
          {test.ok ? `The reviewer answered in ${(test.milliseconds / 1000).toFixed(1)} s.` : test.reason}
        </p>
      )}
      {error && <p role="alert" className="text-[11px] text-danger">{error}</p>}
    </div>
  )
}
