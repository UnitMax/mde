import { describe, expect, it } from 'vitest'
import { terminalBufferText, type ReadableBuffer } from '../src/renderer/terminal/read-output'

function buffer(rows: { text: string; wrapped?: boolean }[], cols = 10): ReadableBuffer {
  return {
    length: rows.length,
    getLine: (index) => {
      const row = rows[index]
      return row && { isWrapped: row.wrapped ?? false, translateToString: (trim) => (trim ? row.text.trimEnd() : row.text.padEnd(cols)) }
    },
  }
}

describe('terminalBufferText', () => {
  it('joins wrapped lines, keeping the space at the wrap', () => {
    const read = terminalBufferText(buffer([{ text: 'error: the' }, { text: 'build', wrapped: true }, { text: 'done' }]), 10)
    expect(read).toEqual({ text: 'error: thebuild\ndone', totalLines: 2 })
    const spaced = terminalBufferText(buffer([{ text: 'error the ' }, { text: 'build', wrapped: true }]), 10)
    expect(spaced.text).toBe('error the build')
  })

  it('leaves out the empty rows under the prompt and gives the last lines asked for', () => {
    const read = terminalBufferText(buffer([{ text: 'a' }, { text: '' }, { text: 'b' }, { text: 'c' }, { text: '' }, { text: '   ' }]), 2)
    expect(read).toEqual({ text: 'b\nc', totalLines: 4 })
  })

  it('reads an empty terminal as nothing', () => {
    expect(terminalBufferText(buffer([{ text: '' }, { text: '' }]), 5)).toEqual({ text: '', totalLines: 0 })
  })
})
