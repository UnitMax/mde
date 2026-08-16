import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@shared/types'

type FakeChild = {
  dataListener?: (data: string) => void
  exitListener?: (info: { exitCode: number; signal?: number }) => void
  write: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  onData: (listener: (data: string) => void) => { dispose: ReturnType<typeof vi.fn> }
  onExit: (listener: (info: { exitCode: number; signal?: number }) => void) => {
    dispose: ReturnType<typeof vi.fn>
  }
}

const ptyMock = vi.hoisted(() => ({
  children: new Map<string, FakeChild>(),
  spawn: vi.fn()
}))

vi.mock('node-pty', () => ({ spawn: ptyMock.spawn }))

import { PtyManager } from '../src/main/pty/manager'

function sourceSession(): Session {
  return {
    id: 'session-1',
    projectId: 'project-1',
    name: 'App',
    kind: 'native',
    path: '/tmp/app',
    createdAt: '2026-01-01T00:00:00.000Z'
  }
}

describe('PtyManager runtime terminal identities', () => {
  beforeEach(() => {
    ptyMock.children.clear()
    ptyMock.spawn.mockReset()
    ptyMock.spawn.mockImplementation((file: string, args: string[], options: unknown) => {
      void file
      void args
      void options
      const child = {} as FakeChild
      child.write = vi.fn()
      child.resize = vi.fn()
      child.kill = vi.fn()
      child.onData = (listener) => {
        child.dataListener = listener
        return { dispose: vi.fn() }
      }
      child.onExit = (listener) => {
        child.exitListener = listener
        return { dispose: vi.fn() }
      }
      ptyMock.children.set(`pane-${ptyMock.children.size + 1}`, child)
      return child
    })
  })

  it('routes independent panes launched from one workspace session', () => {
    const events = { onData: vi.fn(), onExit: vi.fn() }
    const manager = new PtyManager(events)
    const source = sourceSession()
    const size = { cols: 80, rows: 24 }

    manager.ensure('pane-a', source, size)
    manager.ensure('pane-b', source, size)

    expect(ptyMock.spawn).toHaveBeenCalledTimes(2)
    const first = ptyMock.children.get('pane-1')
    const second = ptyMock.children.get('pane-2')
    first?.dataListener?.('first')
    second?.dataListener?.('second')
    expect(events.onData).toHaveBeenNthCalledWith(1, { terminalId: 'pane-a', data: 'first' })
    expect(events.onData).toHaveBeenNthCalledWith(2, { terminalId: 'pane-b', data: 'second' })

    manager.write('pane-a', 'input')
    manager.resize('pane-b', { cols: 120, rows: 30 })
    expect(first?.write).toHaveBeenCalledWith('input')
    expect(second?.resize).toHaveBeenCalledWith(120, 30)

    first?.exitListener?.({ exitCode: 0 })
    expect(events.onExit).toHaveBeenCalledWith({
      sessionId: 'session-1',
      terminalId: 'pane-a',
      exitCode: 0
    })
  })

  it('restarts and disposes panes independently', () => {
    const manager = new PtyManager({ onData: vi.fn(), onExit: vi.fn() })
    const source = sourceSession()
    manager.ensure('pane-a', source, { cols: 80, rows: 24 })
    manager.ensure('pane-b', source, { cols: 80, rows: 24 })
    const first = ptyMock.children.get('pane-1')
    const second = ptyMock.children.get('pane-2')

    manager.restart('pane-a', source, { cols: 100, rows: 25 })
    expect(first?.kill).toHaveBeenCalledTimes(1)
    expect(ptyMock.spawn).toHaveBeenCalledTimes(3)
    expect(manager.status('pane-a')).toBe('running')

    manager.dispose('pane-b')
    expect(second?.kill).toHaveBeenCalledTimes(1)
    expect(manager.status('pane-b')).toBe('none')
    expect(manager.status('pane-a')).toBe('running')
  })
})
