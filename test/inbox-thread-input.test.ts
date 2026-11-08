import { describe, expect, it, vi } from 'vitest'
import { registerNewThreadInput, registerThreadInput, sendTextToNewThread, sendTextToThread } from '../src/renderer/lib/inbox-thread-input'

describe('sending text to a thread', () => {
  it('hands the text to the thread that is open, and says so', () => {
    const input = vi.fn()
    const stop = registerThreadInput('ses_1', input)
    expect(sendTextToThread('ses_1', 'Error: boom')).toBe(true)
    expect(input).toHaveBeenCalledExactlyOnceWith('Error: boom')
    stop()
  })

  it('has nowhere to put it once the thread is closed, and keeps blank text out', () => {
    const input = vi.fn()
    const stop = registerThreadInput('ses_1', input)
    expect(sendTextToThread('ses_1', ' \n ')).toBe(false)
    expect(sendTextToThread('ses_2', 'text')).toBe(false)
    stop()
    expect(sendTextToThread('ses_1', 'text')).toBe(false)
    expect(input).not.toHaveBeenCalled()
  })

  it('does not let a thread that was closed take away the registration of one opened in its place', () => {
    const first = vi.fn()
    const second = vi.fn()
    const stopFirst = registerThreadInput('ses_1', first)
    const stopSecond = registerThreadInput('ses_1', second)
    stopFirst()
    expect(sendTextToThread('ses_1', 'text')).toBe(true)
    expect(second).toHaveBeenCalledOnce()
    stopSecond()
  })
})

describe('sending text to a new thread', () => {
  it('goes to the new-thread page when it is open', () => {
    const input = vi.fn()
    const stop = registerNewThreadInput(input)
    sendTextToNewThread('Error: boom')
    expect(input).toHaveBeenCalledExactlyOnceWith('Error: boom')
    stop()
  })

  it('waits for the page to open, and is handed over in the order it was sent', () => {
    sendTextToNewThread('first')
    sendTextToNewThread(' ')
    sendTextToNewThread('second')
    const input = vi.fn()
    const stop = registerNewThreadInput(input)
    expect(input.mock.calls).toEqual([['first'], ['second']])
    stop()
  })

  it('is not kept for a page that opens much later', () => {
    vi.useFakeTimers()
    try {
      sendTextToNewThread('stale')
      vi.advanceTimersByTime(3500)
      const input = vi.fn()
      const stop = registerNewThreadInput(input)
      expect(input).not.toHaveBeenCalled()
      stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
