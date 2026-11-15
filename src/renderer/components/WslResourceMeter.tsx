import { useEffect, useState } from 'react'
import { Cpu, MemoryStick } from 'lucide-react'
import type { WslResourceSample } from '@shared/ipc'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
  formatMemory,
  formatShare,
  historyArea,
  historyPoints,
  pushResourceHistory,
  resourceLevel,
  type ResourceLevel,
} from '@/lib/wsl-resources'

type RunningSample = Extract<WslResourceSample, { state: 'running' }>

const LEVEL_FILL: Record<ResourceLevel, string> = {
  normal: 'bg-accent',
  high: 'bg-warn',
  critical: 'bg-danger',
}

const LEVEL_STROKE: Record<ResourceLevel, string> = {
  normal: 'text-accent',
  high: 'text-warn',
  critical: 'text-danger',
}

const GRAPH_WIDTH = 256
const GRAPH_HEIGHT = 44

/** The readings while the meter is shown: the latest one and the processor load over time. */
function useWslResources(): { sample: WslResourceSample | null; history: number[] } {
  const [state, setState] = useState<{ sample: WslResourceSample | null; history: number[] }>({ sample: null, history: [] })

  useEffect(() => {
    const unsubscribe = window.api.wsl.onResources((sample) => {
      setState((current) => ({
        sample,
        history: sample.state !== 'running'
          ? []
          : sample.cpu === null
            ? current.history
            : pushResourceHistory(current.history, sample.cpu),
      }))
    })
    void window.api.wsl.watchResources(true).catch(() => undefined)
    return () => {
      unsubscribe()
      void window.api.wsl.watchResources(false).catch(() => undefined)
    }
  }, [])

  return state
}

/** A thin horizontal track, filled to a share. */
function Track({ share, className }: { share: number | null; className?: string }): JSX.Element {
  return (
    <span aria-hidden="true" className={cn('block overflow-hidden rounded-full bg-line-strong', className)}>
      <span
        className={cn('block h-full rounded-full transition-[width] duration-500 ease-out', LEVEL_FILL[resourceLevel(share ?? 0)])}
        style={{ width: `${Math.min(1, Math.max(0, share ?? 0)) * 100}%` }}
      />
    </span>
  )
}

/** One number in the title bar: an icon, the value, and a hairline bar under both. */
function Gauge({
  icon,
  value,
  share,
  width,
  testId,
}: {
  icon: JSX.Element
  value: string
  share: number | null
  width: string
  testId: string
}): JSX.Element {
  return (
    <span className="flex flex-col gap-[3px]" style={{ width }} data-testid={testId}>
      <span className="flex items-center gap-1 leading-none">
        {icon}
        <span className="flex-1 text-right">{value}</span>
      </span>
      <Track share={share} className="h-[2px] w-full" />
    </span>
  )
}

function Details({ sample, history }: { sample: RunningSample; history: number[] }): JSX.Element {
  const memoryShare = sample.memoryUsed / sample.memoryTotal
  const cpuLevel = resourceLevel(sample.cpu ?? 0)
  // Up to sixteen bars in a row, and rows of equal length for the usual processor counts.
  const columns = Math.min(16, sample.cores.length <= 16 ? Math.max(1, sample.cores.length) : Math.ceil(sample.cores.length / Math.ceil(sample.cores.length / 16)))

  return (
    <div className="w-72 space-y-3 p-2 text-xs text-fg-muted" data-testid="wsl-resource-details">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium text-fg">WSL resources</span>
        <span className="min-w-0 truncate text-[11px] text-fg-subtle" title={`Read in ${sample.distro}`}>{sample.distro}</span>
      </div>

      <section className="space-y-1.5" aria-label="Processor">
        <div className="flex items-baseline justify-between">
          <span>CPU</span>
          <span className="tabular-nums">
            <span className="text-fg" data-testid="wsl-resource-cpu-detail">{sample.cpu === null ? '…' : formatShare(sample.cpu)}</span>
            <span className="text-fg-subtle"> · {sample.coreCount} {sample.coreCount === 1 ? 'processor' : 'processors'}</span>
          </span>
        </div>
        <svg
          viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
          className={cn('block h-11 w-full rounded border border-line bg-bg', LEVEL_STROKE[cpuLevel])}
          preserveAspectRatio="none"
          role="img"
          aria-label="Processor load over the last two minutes"
        >
          {[0.25, 0.5, 0.75].map((line) => (
            <line key={line} x1="0" x2={GRAPH_WIDTH} y1={GRAPH_HEIGHT * line} y2={GRAPH_HEIGHT * line} className="stroke-line" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          {history.length > 1 && (
            <>
              <polygon
                points={historyArea(history, GRAPH_WIDTH, GRAPH_HEIGHT)}
                fill="currentColor"
                opacity="0.14"
              />
              <polyline
                points={historyPoints(history, GRAPH_WIDTH, GRAPH_HEIGHT)}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
        </svg>
        {sample.cores.length > 0 && (
          <div
            className="grid gap-[3px]"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
            data-testid="wsl-resource-cores"
          >
            {sample.cores.map((core, index) => (
              <span
                key={index}
                title={`Processor ${index}: ${formatShare(core)}`}
                className="flex h-6 items-end overflow-hidden rounded-sm bg-line-strong"
              >
                <span
                  className={cn('block w-full transition-[height] duration-500 ease-out', LEVEL_FILL[resourceLevel(core)])}
                  style={{ height: `${Math.max(core, 0.04) * 100}%` }}
                />
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-1.5" aria-label="Memory">
        <div className="flex items-baseline justify-between">
          <span>Memory</span>
          <span className="tabular-nums">
            <span className="text-fg">{formatMemory(sample.memoryUsed)}</span>
            <span className="text-fg-subtle"> of {formatMemory(sample.memoryTotal)} · {formatShare(memoryShare)}</span>
          </span>
        </div>
        <Track share={memoryShare} className="h-1.5 w-full" />
        {sample.swapTotal > 0 && (
          <>
            <div className="flex items-baseline justify-between pt-1">
              <span>Swap</span>
              <span className="tabular-nums">
                <span className="text-fg">{formatMemory(sample.swapUsed)}</span>
                <span className="text-fg-subtle"> of {formatMemory(sample.swapTotal)}</span>
              </span>
            </div>
            <Track share={sample.swapUsed / sample.swapTotal} className="h-1 w-full" />
          </>
        )}
      </section>

      <p className="border-t border-line pt-2 text-[11px] leading-4 text-fg-subtle">
        All WSL 2 distros share these processors and this memory. Memory in use leaves out caches Linux can give
        back, so Task Manager may show more.
      </p>
    </div>
  )
}

/**
 * WSL's CPU and memory in the title bar, with the details in a panel. Mounting it starts the
 * readings in the main process and unmounting stops them, so it costs nothing while switched off.
 */
export function WslResourceMeter(): JSX.Element | null {
  const { sample, history } = useWslResources()
  if (sample?.state === 'unavailable') return null

  const chip = 'app-no-drag mr-1 flex h-6 items-center gap-2.5 rounded px-1.5 text-[11px] tabular-nums text-fg-muted'

  if (!sample || sample.state === 'stopped') {
    return (
      <span
        className={cn(chip, 'text-fg-subtle')}
        data-testid="wsl-resource-meter"
        title={sample ? 'No WSL distro is running. The meter starts when one does.' : 'Reading WSL resources…'}
      >
        <Cpu className="h-3 w-3" />
        {sample ? 'WSL idle' : '…'}
      </span>
    )
  }

  const memoryShare = sample.memoryUsed / sample.memoryTotal
  const label = `WSL: CPU ${sample.cpu === null ? 'not read yet' : formatShare(sample.cpu)}, memory ${formatMemory(sample.memoryUsed)} of ${formatMemory(sample.memoryTotal)}`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(chip, 'hover:bg-hover hover:text-fg data-[state=open]:bg-hover data-[state=open]:text-fg')}
          data-testid="wsl-resource-meter"
          aria-label={label}
          title="WSL resources"
        >
          <Gauge
            testId="wsl-resource-cpu"
            icon={<Cpu className="h-3 w-3 shrink-0" />}
            value={sample.cpu === null ? '…' : formatShare(sample.cpu)}
            share={sample.cpu}
            width="2.9rem"
          />
          <Gauge
            testId="wsl-resource-memory"
            icon={<MemoryStick className="h-3 w-3 shrink-0" />}
            value={formatMemory(sample.memoryUsed)}
            share={memoryShare}
            width="4rem"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="p-1">
        <Details sample={sample} history={history} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
