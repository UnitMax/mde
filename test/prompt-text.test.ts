import { describe, expect, it } from 'vitest'
import { assertIpcPayload } from '../src/main/ipc-validation'
import { IpcChannels } from '../src/shared/ipc'
import { cleanPromptText, PROMPT_CONTROL_CHARACTERS } from '../src/shared/prompt-text'

// The start of a GitLab CI job log as the raw log view and `glab ci trace` give it.
const gitlabLog = [
  '\u001b[0KRunning with gitlab-runner 17.5.0 (abc123)\u001b[0;m',
  'section_start:1731230000:prepare_executor\r\u001b[0K\u001b[0K\u001b[36;1mPreparing the "docker" executor\u001b[0;m\u001b[0;m',
  '\u001b[32;1m$ npm test\u001b[0;m',
  ' ✓ test/app.test.ts (3 tests) ██░░',
  'section_end:1731230042:step_script\r\u001b[0K',
].join('\n')

describe('cleanPromptText', () => {
  it('takes terminal colour codes out of a CI log whole and leaves the words, tabs and block characters', () => {
    const cleaned = cleanPromptText(`${gitlabLog}\n\tindented`)
    expect(cleaned).toBe([
      'Running with gitlab-runner 17.5.0 (abc123)',
      'section_start:1731230000:prepare_executor\rPreparing the "docker" executor',
      '$ npm test',
      ' ✓ test/app.test.ts (3 tests) ██░░',
      'section_end:1731230042:step_script\r',
      '\tindented',
    ].join('\n'))
    expect(PROMPT_CONTROL_CHARACTERS.test(cleaned)).toBe(false)
  })

  it('removes window titles, links and lone control characters, and breaks lines at form feeds', () => {
    const text = '\u001b]0;title\u0007\u001b]8;;https://example.com\u001b\\link\u001b]8;;\u001b\\ a\u0000b\u0008c\u007f\fpage\u000bnext\u001b(B\u001b='
    expect(cleanPromptText(text)).toBe('link abc\npage\nnext')
  })

  it('returns text without control characters as it is', () => {
    const text = 'Plain text with emoji 🚀, CJK 漢字 and a\r\nWindows line break'
    expect(cleanPromptText(text)).toBe(text)
  })

  it('makes a pasted CI log a draft the main process accepts', () => {
    const draft = (text: string) => ({ key: 'thread:ses_one', action: 'text', text })
    expect(() => assertIpcPayload(IpcChannels.chatDraft, draft(gitlabLog))).toThrow('Invalid IPC payload for chat:draft.')
    expect(() => assertIpcPayload(IpcChannels.chatDraft, draft(cleanPromptText(gitlabLog)))).not.toThrow()
  })
})
