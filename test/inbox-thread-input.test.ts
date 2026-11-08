import { describe, expect, it, vi } from 'vitest'
import { registerThreadInput, sendTextToThread } from '../src/renderer/lib/inbox-thread-input'

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
