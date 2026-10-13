import { describe, expect, it } from 'vitest'
import type { OpenCodeTuiInstanceStatus } from '../src/shared/types'
import {
  detectInstanceHighlights,
  highlightToneForStatus
} from '../src/renderer/lib/terminal-highlight'

function instance(
  terminalId: string,
  status: OpenCodeTuiInstanceStatus['status'],
  revision: number
): OpenCodeTuiInstanceStatus {
  return { terminalId, status, revision }
}

describe('highlightToneForStatus', () => {
  it('maps finished and failed agents to their own tones and everything else to attention', () => {
    expect(highlightToneForStatus('completed')).toBe('done')
    expect(highlightToneForStatus('error')).toBe('error')
    expect(highlightToneForStatus('attention')).toBe('attention')
    expect(highlightToneForStatus('working')).toBe('attention')
    expect(highlightToneForStatus('idle')).toBe('attention')
    expect(highlightToneForStatus(undefined)).toBe('attention')
  })
})

describe('detectInstanceHighlights', () => {
  it('flashes a pane that starts waiting, finishes, or fails after a revision change', () => {
    const previous = [
      instance('s:1', 'working', 1),
      instance('s:2', 'working', 3),
      instance('s:3', 'working', 5)
    ]
    const next = [
      instance('s:1', 'attention', 2),
      instance('s:2', 'completed', 4),
      instance('s:3', 'error', 6)
    ]

    expect(detectInstanceHighlights(previous, next)).toEqual([
      { terminalId: 's:1', tone: 'attention' },
      { terminalId: 's:2', tone: 'done' },
      { terminalId: 's:3', tone: 'error' }
    ])
  })

  it('stays quiet for a title-only update that keeps the revision', () => {
    const previous = [instance('s:1', 'completed', 4)]
    const next = [{ ...instance('s:1', 'completed', 4), title: 'Checkout flow' }]

    expect(detectInstanceHighlights(previous, next)).toEqual([])
  })

  it('stays quiet when the new status is not worth a highlight', () => {
    const previous = [instance('s:1', 'completed', 1), instance('s:2', 'attention', 1)]
    const next = [instance('s:1', 'working', 2), instance('s:2', 'idle', 2)]

    expect(detectInstanceHighlights(previous, next)).toEqual([])
  })

  it('stays quiet for the first report of a session or of a new pane', () => {
    const finished = [instance('s:1', 'completed', 4)]

    expect(detectInstanceHighlights(undefined, finished)).toEqual([])
    expect(
      detectInstanceHighlights(finished, [...finished, instance('s:2', 'attention', 1)])
    ).toEqual([])
  })

  it('flashes each pane independently', () => {
    const previous = [instance('s:1', 'working', 1), instance('s:2', 'working', 1)]
    const next = [instance('s:1', 'completed', 2), instance('s:2', 'working', 1)]

    expect(detectInstanceHighlights(previous, next)).toEqual([{ terminalId: 's:1', tone: 'done' }])
  })

  it('treats an agent restarted in the same pane with a lower revision as a transition', () => {
    const previous = [instance('s:1', 'working', 9)]
    const next = [instance('s:1', 'completed', 2)]

    expect(detectInstanceHighlights(previous, next)).toEqual([{ terminalId: 's:1', tone: 'done' }])
  })
})
