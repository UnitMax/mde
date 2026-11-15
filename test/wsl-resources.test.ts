import { describe, expect, it, vi } from 'vitest'
import type { WslResourceSample } from '../src/shared/ipc'
import {
  cpuUsage,
  parseResourceSample,
  resourceSample,
  WslResourceMonitor,
  WSL_RESOURCE_SCRIPT,
  type ResourceSampler,
} from '../src/main/wsl/resources'
import {
  formatMemory,
  formatShare,
  historyPoints,
  pushResourceHistory,
  RESOURCE_HISTORY_LENGTH,
  resourceLevel,
} from '../src/renderer/lib/wsl-resources'

const KB = 1024

function reading(busy: number, idle: number, available = 12_000_000): string {
  return [
    `cpu  ${busy * 2} 0 0 ${idle * 2} 0 0 0 0 0 0`,
    `cpu0 ${busy * 2} 0 0 0 0 0 0 0 0 0`,
    `cpu1 0 0 0 ${idle * 2} 0 0 0 0 0 0`,
    'MemTotal:       16000000 kB',
    `MemAvailable:   ${available} kB`,
    'SwapTotal:       4000000 kB',
    'SwapFree:        3000000 kB',
    '',
  ].join('\n')
}

describe('parseResourceSample', () => {
  it('reads processor times and memory', () => {
    const sample = parseResourceSample([
      'cpu  100 5 20 800 10 1 2 3 50 0',
      'cpu0 60 5 10 400 5 1 1 2 50 0',
      'cpu1 40 0 10 400 5 0 1 1 0 0',
      'MemTotal:       16000000 kB',
      'MemAvailable:   12000000 kB',
      'SwapTotal:       4000000 kB',
      'SwapFree:        3000000 kB',
    ].join('\n'))

    // Waiting for the disk counts as idle; guest time is part of user time and is not added again.
    expect(sample?.cpu).toEqual({ idle: 810, total: 941 })
    expect(sample?.cores).toHaveLength(2)
    expect(sample?.memoryTotal).toBe(16_000_000 * KB)
    expect(sample?.memoryAvailable).toBe(12_000_000 * KB)
    expect(sample?.swapFree).toBe(3_000_000 * KB)
  })

  it('refuses text that is not a reading', () => {
    expect(parseResourceSample('')).toBeNull()
    expect(parseResourceSample('cpu  1 2 3 4\n')).toBeNull()
    expect(parseResourceSample('MemTotal: 5 kB\nMemAvailable: 1 kB\n')).toBeNull()
    expect(parseResourceSample('cpu  a b c d\nMemTotal: 5 kB\nMemAvailable: 1 kB\n')).toBeNull()
  })

  it('treats a kernel without swap as having none', () => {
    const sample = parseResourceSample('cpu  1 0 0 9\ncpu0 1 0 0 9\nMemTotal: 8 kB\nMemAvailable: 2 kB\n')
    expect(sample?.swapTotal).toBe(0)
  })
})

describe('cpuUsage', () => {
  it('is the share of time that was not idle', () => {
    expect(cpuUsage({ idle: 100, total: 200 }, { idle: 175, total: 300 })).toBeCloseTo(0.25)
  })

  it('stays between 0 and 1 when the counters do not move or run backwards', () => {
    expect(cpuUsage({ idle: 100, total: 200 }, { idle: 100, total: 200 })).toBe(0)
    expect(cpuUsage({ idle: 100, total: 200 }, { idle: 50, total: 210 })).toBe(1)
    expect(cpuUsage({ idle: 100, total: 200 }, { idle: 300, total: 210 })).toBe(0)
  })
})

describe('resourceSample', () => {
  it('has memory but no load for the first reading', () => {
    const sample = resourceSample('Ubuntu', null, parseResourceSample(reading(10, 90))!)
    expect(sample).toMatchObject({
      state: 'running',
      distro: 'Ubuntu',
      cpu: null,
      cores: [],
      coreCount: 2,
      memoryUsed: 4_000_000 * KB,
      swapUsed: 1_000_000 * KB,
    })
  })

  it('has the load of every processor from the second reading on', () => {
    const sample = resourceSample('Ubuntu', parseResourceSample(reading(10, 90))!, parseResourceSample(reading(60, 240))!)
    expect(sample).toMatchObject({ cpu: 0.25, cores: [1, 0] })
  })
})

interface FakeSampler extends ResourceSampler {
  write(chunk: string): void
  end(): void
  stopped: boolean
}

function fakeMonitor(running: string[][] = [['Ubuntu']], platform: NodeJS.Platform = 'win32') {
  const samples: WslResourceSample[] = []
  const samplers: FakeSampler[] = []
  const timers: Array<() => void> = []
  const started: string[] = []
  const monitor = new WslResourceMonitor((sample) => samples.push(sample), {
    platform,
    runningDistros: async () => running.shift() ?? [],
    start: (distro) => {
      started.push(distro)
      let data: (chunk: string) => void = () => undefined
      let end: () => void = () => undefined
      const sampler: FakeSampler = {
        stopped: false,
        onData: (listener) => { data = listener },
        onEnd: (listener) => { end = listener },
        stop: () => { sampler.stopped = true },
        write: (chunk) => data(chunk),
        end: () => end(),
      }
      samplers.push(sampler)
      return sampler
    },
    setTimeout: (callback) => timers.push(callback),
    clearTimeout: (timer) => { timers[(timer as number) - 1] = () => undefined },
  })
  return { monitor, samples, samplers, timers, started }
}

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('WslResourceMonitor', () => {
  it('runs a constant script that names no outside value', () => {
    expect(WSL_RESOURCE_SCRIPT).toContain('/proc/stat')
    expect(WSL_RESOURCE_SCRIPT).toContain('/proc/meminfo')
    expect(WSL_RESOURCE_SCRIPT).not.toContain('$')
  })

  it('turns readings into samples, also when they arrive in pieces', async () => {
    const { monitor, samples, samplers, started } = fakeMonitor()
    monitor.setEnabled(true)
    await settle()
    expect(started).toEqual(['Ubuntu'])

    const first = `${reading(10, 90)}mde-sample-end\n`
    samplers[0]!.write(first.slice(0, 20))
    expect(samples).toEqual([])
    samplers[0]!.write(first.slice(20))
    samplers[0]!.write(`${reading(60, 240, 8_000_000)}mde-sample-end\n`)

    expect(samples).toHaveLength(2)
    expect(samples[0]).toMatchObject({ state: 'running', cpu: null })
    expect(samples[1]).toMatchObject({ state: 'running', cpu: 0.25, memoryUsed: 8_000_000 * KB })
  })

  it('stops the loop when switched off and ignores what it still writes', async () => {
    const { monitor, samples, samplers } = fakeMonitor()
    monitor.setEnabled(true)
    await settle()
    monitor.setEnabled(false)

    expect(samplers[0]!.stopped).toBe(true)
    samplers[0]!.write(`${reading(10, 90)}mde-sample-end\n`)
    samplers[0]!.end()
    expect(samples).toEqual([])
  })

  it('does not start a second loop when switched on twice', async () => {
    const { monitor, started } = fakeMonitor([['Ubuntu'], ['Ubuntu']])
    monitor.setEnabled(true)
    monitor.setEnabled(true)
    await settle()
    expect(started).toEqual(['Ubuntu'])
  })

  it('does not start WSL: with no distro running it reports that and looks again later', async () => {
    const { monitor, samples, started, timers } = fakeMonitor([[], ['Debian']])
    monitor.setEnabled(true)
    await settle()
    expect(samples).toEqual([{ state: 'stopped' }])
    expect(started).toEqual([])

    timers[0]!()
    await settle()
    expect(started).toEqual(['Debian'])
  })

  it('looks for a distro again after the loop ended', async () => {
    const { monitor, samples, samplers, started, timers } = fakeMonitor([['Ubuntu'], ['Ubuntu']])
    monitor.setEnabled(true)
    await settle()
    samplers[0]!.end()
    expect(samples).toEqual([{ state: 'stopped' }])

    timers[0]!()
    await settle()
    expect(started).toEqual(['Ubuntu', 'Ubuntu'])
  })

  it('drops a pending look when switched off', async () => {
    const { monitor, started, timers } = fakeMonitor([[], ['Ubuntu']])
    monitor.setEnabled(true)
    await settle()
    monitor.dispose()
    timers[0]!()
    await settle()
    expect(started).toEqual([])
  })

  it('says there is no WSL outside Windows and starts nothing', async () => {
    const runningDistros = vi.fn(async () => ['Ubuntu'])
    const samples: WslResourceSample[] = []
    const monitor = new WslResourceMonitor((sample) => samples.push(sample), { platform: 'linux', runningDistros })
    monitor.setEnabled(true)
    await settle()
    expect(samples).toEqual([{ state: 'unavailable' }])
    expect(runningDistros).not.toHaveBeenCalled()
  })
})

describe('meter formatting', () => {
  it('colors by load', () => {
    expect(resourceLevel(0.5)).toBe('normal')
    expect(resourceLevel(0.75)).toBe('high')
    expect(resourceLevel(0.95)).toBe('critical')
  })

  it('writes shares and sizes', () => {
    expect(formatShare(0.126)).toBe('13%')
    expect(formatShare(1.4)).toBe('100%')
    expect(formatMemory(512 * 1024 ** 2)).toBe('512 MB')
    expect(formatMemory(5.25 * 1024 ** 3)).toBe('5.3 GB')
    expect(formatMemory(128 * 1024 ** 3)).toBe('128 GB')
  })

  it('keeps a bounded history that ends at the right edge', () => {
    let history: number[] = []
    for (let index = 0; index < RESOURCE_HISTORY_LENGTH + 5; index += 1) history = pushResourceHistory(history, index / 100)
    expect(history).toHaveLength(RESOURCE_HISTORY_LENGTH)
    expect(history[0]).toBe(0.05)

    expect(historyPoints([0, 1], 118, 10)).toBe('116.0,10.0 118.0,0.0')
  })
})
