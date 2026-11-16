import { spawn as nodeSpawn } from 'node:child_process'
import type { WslResourceSample } from '@shared/ipc'
import { resolveWslExecutable } from '../windows-executable'
import { buildWslExecArgs, listRunningDistros, wslEnv } from './distros'

/**
 * CPU and memory of WSL, for the meter in the title bar.
 *
 * All WSL 2 distros run in one virtual machine and share its processors and memory, so the numbers
 * describe WSL as a whole, whichever distro they are read in. They are read from `/proc/stat` and
 * `/proc/meminfo`, which needs no extra program and no special rights.
 *
 * Starting `wsl.exe` costs about 100 ms, so there is no process for each reading. One small loop
 * runs inside a distro for as long as the meter is shown and writes a sample every few seconds.
 * It ends by itself when its output is closed, which is what happens when MDE stops it or exits.
 *
 * The loop is only started in a distro that is already running, so the meter never starts WSL.
 * While it runs it does count as activity, so WSL does not shut down for being idle.
 */

const SAMPLE_SECONDS = 2
const SAMPLE_END = 'mde-sample-end'
/** A constant: nothing from outside is put into it. */
export const WSL_RESOURCE_SCRIPT =
  `while grep '^cpu' /proc/stat && grep -E '^(MemTotal|MemAvailable|SwapTotal|SwapFree):' /proc/meminfo && echo ${SAMPLE_END}; ` +
  `do sleep ${SAMPLE_SECONDS}; done`

/** How long to wait before looking for a running distro again. */
const RETRY_MS = 10_000
/** A sample is a few kilobytes; more than this without an end marker is not one. */
const MAX_PENDING_CHARS = 1_000_000
const MAX_CORES = 1024

export interface CpuTimes {
  idle: number
  total: number
}

export interface RawResourceSample {
  cpu: CpuTimes
  cores: CpuTimes[]
  memoryTotal: number
  memoryAvailable: number
  swapTotal: number
  swapFree: number
}

function cpuTimes(fields: readonly string[]): CpuTimes | null {
  // user nice system idle iowait irq softirq steal; guest time is already counted in user.
  const values = fields.slice(0, 8).map(Number)
  if (values.length < 4 || values.some((value) => !Number.isFinite(value) || value < 0)) return null
  return { idle: values[3]! + (values[4] ?? 0), total: values.reduce((sum, value) => sum + value, 0) }
}

/** Reads one sample: the `cpu` lines of `/proc/stat` and four lines of `/proc/meminfo`. */
export function parseResourceSample(text: string): RawResourceSample | null {
  let cpu: CpuTimes | null = null
  const cores: CpuTimes[] = []
  const memory = new Map<string, number>()
  for (const line of text.split('\n')) {
    const fields = line.trim().split(/\s+/)
    const name = fields[0] ?? ''
    if (name === 'cpu') {
      cpu = cpuTimes(fields.slice(1))
    } else if (/^cpu\d+$/.test(name)) {
      const times = cpuTimes(fields.slice(1))
      const index = Number(name.slice(3))
      if (times && index < MAX_CORES) cores[index] = times
    } else if (name.endsWith(':')) {
      const kilobytes = Number(fields[1])
      if (Number.isFinite(kilobytes) && kilobytes >= 0) memory.set(name.slice(0, -1), kilobytes * 1024)
    }
  }
  const memoryTotal = memory.get('MemTotal')
  const memoryAvailable = memory.get('MemAvailable')
  if (!cpu || !memoryTotal || memoryAvailable === undefined) return null
  return {
    cpu,
    // A processor that is offline has no line; the others keep their order.
    cores: cores.filter(Boolean),
    memoryTotal,
    memoryAvailable,
    swapTotal: memory.get('SwapTotal') ?? 0,
    swapFree: memory.get('SwapFree') ?? 0,
  }
}

/** The share of time between two readings that was not idle, from 0 to 1. */
export function cpuUsage(before: CpuTimes, after: CpuTimes): number {
  const total = after.total - before.total
  if (total <= 0) return 0
  return Math.min(1, Math.max(0, 1 - (after.idle - before.idle) / total))
}

/** The sample for the window. The processor load needs the reading before it. */
export function resourceSample(distro: string, before: RawResourceSample | null, raw: RawResourceSample): WslResourceSample {
  const comparable = before !== null && before.cores.length === raw.cores.length
  return {
    state: 'running',
    distro,
    cpu: comparable ? cpuUsage(before.cpu, raw.cpu) : null,
    cores: comparable ? raw.cores.map((core, index) => cpuUsage(before.cores[index]!, core)) : [],
    coreCount: raw.cores.length,
    memoryTotal: raw.memoryTotal,
    memoryUsed: Math.max(0, raw.memoryTotal - raw.memoryAvailable),
    swapTotal: raw.swapTotal,
    swapUsed: Math.max(0, raw.swapTotal - raw.swapFree),
  }
}

/** The part of a child process the monitor uses. */
export interface ResourceSampler {
  onData(listener: (chunk: string) => void): void
  onEnd(listener: () => void): void
  stop(): void
}

export interface WslResourceMonitorDependencies {
  platform?: NodeJS.Platform
  /** Names of the WSL 2 distros that are running, the default one first. */
  runningDistros?: () => Promise<string[]>
  start?: (distro: string) => ResourceSampler
  setTimeout?: (callback: () => void, ms: number) => unknown
  clearTimeout?: (timer: unknown) => void
}

function startSampler(distro: string): ResourceSampler {
  const executable = resolveWslExecutable()
  // Started on the main thread: once for as long as the meter is shown, not once per reading.
  const child = nodeSpawn(executable.file, buildWslExecArgs(distro, ['sh', '-c', WSL_RESOURCE_SCRIPT]), {
    env: wslEnv(),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
    ...(executable.cwd ? { cwd: executable.cwd } : {}),
  })
  child.stdout.setEncoding('utf8')
  return {
    onData: (listener) => child.stdout.on('data', listener),
    onEnd: (listener) => {
      let ended = false
      const end = (): void => {
        if (ended) return
        ended = true
        listener()
      }
      child.on('error', end)
      child.on('exit', end)
    },
    stop: () => {
      child.kill()
    },
  }
}

/** Runs the loop while the meter is wanted and turns what it writes into samples. */
export class WslResourceMonitor {
  private enabled = false
  /** Changes whenever the monitor is switched or its loop ends, so late answers are dropped. */
  private generation = 0
  private sampler: ResourceSampler | null = null
  private retry: unknown = null
  private readonly platform: NodeJS.Platform
  private readonly runningDistros: () => Promise<string[]>
  private readonly start: (distro: string) => ResourceSampler
  private readonly setTimer: (callback: () => void, ms: number) => unknown
  private readonly clearTimer: (timer: unknown) => void

  constructor(
    private readonly emit: (sample: WslResourceSample) => void,
    dependencies: WslResourceMonitorDependencies = {},
  ) {
    this.platform = dependencies.platform ?? process.platform
    this.runningDistros = dependencies.runningDistros ?? listRunningDistros
    this.start = dependencies.start ?? startSampler
    this.setTimer = dependencies.setTimeout ?? ((callback, ms) => setTimeout(callback, ms))
    this.clearTimer = dependencies.clearTimeout ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>))
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return
    this.enabled = enabled
    this.halt()
    if (enabled) void this.begin()
  }

  dispose(): void {
    this.enabled = false
    this.halt()
  }

  private halt(): void {
    this.generation += 1
    if (this.retry !== null) this.clearTimer(this.retry)
    this.retry = null
    this.sampler?.stop()
    this.sampler = null
  }

  private async begin(): Promise<void> {
    if (this.platform !== 'win32') {
      this.emit({ state: 'unavailable' })
      return
    }
    const generation = this.generation
    let distro: string | undefined
    try {
      distro = (await this.runningDistros())[0]
    } catch {
      distro = undefined
    }
    if (generation !== this.generation) return
    if (!distro) {
      this.waitForWsl(generation)
      return
    }

    let sampler: ResourceSampler
    try {
      sampler = this.start(distro)
    } catch {
      this.waitForWsl(generation)
      return
    }
    this.sampler = sampler
    let pending = ''
    let before: RawResourceSample | null = null
    sampler.onData((chunk) => {
      if (generation !== this.generation) return
      pending += chunk
      for (let end = pending.indexOf(SAMPLE_END); end >= 0; end = pending.indexOf(SAMPLE_END)) {
        const raw = parseResourceSample(pending.slice(0, end))
        pending = pending.slice(end + SAMPLE_END.length)
        if (!raw) continue
        this.emit(resourceSample(distro, before, raw))
        before = raw
      }
      if (pending.length > MAX_PENDING_CHARS) sampler.stop()
    })
    sampler.onEnd(() => {
      if (generation !== this.generation) return
      // The distro stopped, or WSL was shut down. Look again later.
      this.halt()
      this.waitForWsl(this.generation)
    })
  }

  private waitForWsl(generation: number): void {
    this.emit({ state: 'stopped' })
    this.retry = this.setTimer(() => {
      this.retry = null
      if (generation === this.generation && this.enabled) void this.begin()
    }, RETRY_MS)
  }
}
