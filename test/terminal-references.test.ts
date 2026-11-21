import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanTerminalTitle,
  isTerminalRef,
  splitTerminalReferences,
  terminalRefFrom,
  terminalReferenceText,
  terminalReferenceTokens,
  type TerminalReadRequest,
} from '../src/shared/terminal-references'
import {
  TERMINAL_READ_PENDING_LIMIT,
  TERMINAL_READ_TIMEOUT_MS,
  TERMINAL_REFERENCE_LIMIT,
  TERMINAL_REFERENCES_FILE,
  TerminalReferences,
} from '../src/main/mcp/terminal-references'

const PANE = 'inbox-terminal:tab:default:pane:pane-2'

describe('terminal reference text', () => {
  it('is written and read back the same way', () => {
    const text = `Why does ${terminalReferenceText('k3m9x2qavw', 'Dev server')} fail?`
    expect(text).toBe('Why does [terminal:k3m9x2qavw "Dev server"] fail?')
    expect(terminalReferenceTokens(text)).toEqual([{ start: 9, end: 43, ref: 'k3m9x2qavw', title: 'Dev server' }])
    expect(splitTerminalReferences(text).map((part) => [part.text, part.reference?.ref])).toEqual([
      ['Why does ', undefined],
      ['[terminal:k3m9x2qavw "Dev server"]', 'k3m9x2qavw'],
      [' fail?', undefined],
    ])
  })

  it('finds several, and nothing in text that only looks like one', () => {
    const text = '[terminal:k3m9x2qavw "a"][terminal:abcdefghjk "b"] [terminal:short "c"] [terminal:k3m9x2qavw a]'
    expect(terminalReferenceTokens(text).map((token) => token.title)).toEqual(['a', 'b'])
    expect(splitTerminalReferences('plain')).toEqual([{ text: 'plain' }])
  })

  it('keeps a title to one short line without quotes or brackets', () => {
    expect(cleanTerminalTitle('  npm "run" [dev]\n\tnow ')).toBe('npm run dev now')
    expect(cleanTerminalTitle('   ')).toBe('terminal')
    expect(cleanTerminalTitle('x'.repeat(100))).toHaveLength(60)
    expect(cleanTerminalTitle(`a${String.fromCharCode(0x202e)}b`)).toBe('a b')
    expect(terminalReferenceTokens(terminalReferenceText('k3m9x2qavw', 'x'.repeat(100)))).toHaveLength(1)
  })

  it('makes refs from random bytes in its own alphabet', () => {
    const ref = terminalRefFrom(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 255]))
    expect(isTerminalRef(ref)).toBe(true)
    expect(isTerminalRef('K3M9X2QAVW')).toBe(false)
    expect(isTerminalRef('k3m9x2qav')).toBe(false)
    expect(() => terminalRefFrom(new Uint8Array(3))).toThrow()
  })
})

describe('TerminalReferences', () => {
  let folder: string
  /** The shell each terminal runs, as the PTY manager would say. */
  let shells: Map<string, string>

  beforeEach(async () => {
    folder = await fs.mkdtemp(join(tmpdir(), 'mde-terminal-refs-'))
    shells = new Map([[PANE, 'shell-1'], [`${PANE}x`, 'shell-x']])
  })

  afterEach(async () => {
    vi.useRealTimers()
    await fs.rm(folder, { recursive: true, force: true })
  })

  /** Distinct refs, one after another: the count written in the ref alphabet's base. */
  function counter(): (size: number) => Uint8Array {
    let next = 0
    return (size) => {
      let value = next++
      return Uint8Array.from({ length: size }, () => { const digit = value % 31; value = Math.floor(value / 31); return digit })
    }
  }

  /** References wired to a window (which records what it is asked) and to `shells`. */
  function attached(sent: TerminalReadRequest[] = [], window = true): TerminalReferences {
    const references = new TerminalReferences(folder, counter())
    references.attach({
      send: (request) => { if (window) sent.push(request); return window },
      shellId: (terminalId) => shells.get(terminalId),
      now: () => 1000,
    })
    return references
  }

  const reading = (text: string) => ({ title: 'pane', directory: null, running: true, totalLines: 1, text })

  it('gives a shell one ref and reads the title again', async () => {
    const references = attached()
    const first = await references.create(PANE, 'Dev server')
    expect(isTerminalRef(first.ref)).toBe(true)
    expect(first.text).toBe(`[terminal:${first.ref} "Dev server"]`)
    const again = await references.create(PANE, 'npm run dev')
    expect(again).toEqual({ ref: first.ref, text: `[terminal:${first.ref} "npm run dev"]` })
    expect(await references.resolve(first.ref)).toEqual({ terminalId: PANE, title: 'npm run dev' })
  })

  it('names only running panes of the Inbox terminal', async () => {
    const references = attached()
    await expect(references.create('session-1:tab:t:pane:pane-1', 'x')).rejects.toThrow(/Inbox terminal/)
    await expect(references.create(`${PANE}\n`, 'x')).rejects.toThrow()
    await expect(references.create(`${PANE}-none`, 'x')).rejects.toThrow(/not running/)
    await expect(new TerminalReferences(folder, counter()).create(PANE, 'x')).rejects.toThrow(/not running/)
    expect(await references.resolve('not a ref')).toBeUndefined()
  })

  it('keeps the newest refs only', async () => {
    const references = attached()
    const panes = Array.from({ length: TERMINAL_REFERENCE_LIMIT + 1 }, (_, index) => `${PANE}-${index}`)
    for (const pane of panes) shells.set(pane, `shell-${pane}`)
    const refs = []
    for (const pane of panes) refs.push((await references.create(pane, 'pane')).ref)
    expect(await references.resolve(refs[0]!)).toBeUndefined()
    expect(await references.resolve(refs[1]!)).toEqual({ terminalId: panes[1], title: 'pane' })
  })

  it('keeps nothing between runs and removes the file earlier versions kept', async () => {
    const file = join(folder, TERMINAL_REFERENCES_FILE)
    await fs.writeFile(file, JSON.stringify({ version: 2, references: [{ ref: 'k3m9x2qavw', terminalId: PANE, title: 'old', createdAt: 1 }] }))
    const references = attached()
    expect(await references.resolve('k3m9x2qavw')).toBeUndefined()
    await expect(references.read('k3m9x2qavw', 10)).rejects.toThrow(/dragged into a message/)
    await expect(fs.access(file)).rejects.toThrow()
    await references.create(PANE, 'new')
    await expect(fs.access(file)).rejects.toThrow()
  })

  it('asks the window for the pane a ref names and passes on its answer', async () => {
    const sent: TerminalReadRequest[] = []
    const references = attached(sent)
    const { ref } = await references.create(PANE, 'Dev server')
    const read = references.read(ref, 50)
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toMatchObject({ terminalId: PANE, lines: 50 })
    references.answer({ requestId: sent[0]!.requestId, reading: reading('ok') })
    await expect(read).resolves.toMatchObject({ text: 'ok' })

    const failing = references.read(ref, 50)
    await vi.waitFor(() => expect(sent).toHaveLength(2))
    references.answer({ requestId: sent[1]!.requestId, error: 'That terminal was closed.' })
    await expect(failing).rejects.toThrow('That terminal was closed.')
    // An answer nobody waits for is dropped.
    references.answer({ requestId: 'nobody', error: 'x' })
  })

  it('still reads a shell that exited, which is the one the person shared', async () => {
    const sent: TerminalReadRequest[] = []
    const references = attached(sent)
    const { ref } = await references.create(PANE, 'build')
    // An exited shell keeps its ID until it is restarted.
    const read = references.read(ref, 10)
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    references.answer({ requestId: sent[0]!.requestId, reading: { ...reading('done'), running: false } })
    await expect(read).resolves.toMatchObject({ text: 'done', running: false })
  })

  it('refuses a ref it did not make, with no window, and too many at once', async () => {
    const unattached = new TerminalReferences(folder, counter())
    await expect(unattached.read('k3m9x2qavw', 10)).rejects.toThrow(/dragged into a message/)
    const noWindow = attached([], false)
    const { ref } = await noWindow.create(PANE, 'a')
    await expect(noWindow.read(ref, 10)).rejects.toThrow(/no window/)

    const busy = attached()
    const busyRef = (await busy.create(PANE, 'a')).ref
    const waiting = Array.from({ length: TERMINAL_READ_PENDING_LIMIT }, () => busy.read(busyRef, 10))
    await vi.waitFor(async () => expect(await busy.read(busyRef, 10).catch((error: Error) => error.message)).toMatch(/other terminals/))
    void Promise.allSettled(waiting)
  })

  it('gives up on a window that does not answer', async () => {
    const references = attached()
    const { ref } = await references.create(PANE, 'a')
    vi.useFakeTimers()
    const read = references.read(ref, 10)
    const outcome = expect(read).rejects.toThrow(/did not answer/)
    await vi.advanceTimersByTimeAsync(TERMINAL_READ_TIMEOUT_MS)
    await outcome
  })

  it('forgets the refs of a closed pane', async () => {
    const sent: TerminalReadRequest[] = []
    const references = attached(sent)
    const closed = await references.create(PANE, 'shared')
    const other = await references.create(`${PANE}x`, 'other')
    references.forget([PANE])
    await expect(references.read(closed.ref, 10)).rejects.toThrow(/dragged into a message/)
    expect(sent).toHaveLength(0)
    expect(await references.resolve(other.ref)).toMatchObject({ terminalId: `${PANE}x` })
  })

  it('does not read a new shell of the pane through a ref made for an earlier one (restart)', async () => {
    const sent: TerminalReadRequest[] = []
    const references = attached(sent)
    const shared = await references.create(PANE, 'shared')
    shells.set(PANE, 'shell-2')
    await expect(references.read(shared.ref, 10)).rejects.toThrow(/restarted/)
    expect(await references.resolve(shared.ref)).toBeUndefined()
    expect(sent).toHaveLength(0)
    // Back to the first shell ID or not, the forgotten ref stays forgotten.
    shells.set(PANE, 'shell-1')
    expect(await references.resolve(shared.ref)).toBeUndefined()

    // Dragging the pane in again shares the new shell under a new ref.
    shells.set(PANE, 'shell-2')
    const again = await references.create(PANE, 'shared')
    expect(again.ref).not.toBe(shared.ref)
    expect(await references.resolve(again.ref)).toMatchObject({ terminalId: PANE })
  })

  it('does not read a pane whose shell went with a WSL distribution change', async () => {
    const references = attached()
    const { ref } = await references.create(PANE, 'shared')
    shells.delete(PANE)
    await expect(references.read(ref, 10)).rejects.toThrow(/restarted/)
    shells.set(PANE, 'shell-other-distro')
    await expect(references.read(ref, 10)).rejects.toThrow(/restarted/)
  })

  it('drops an answer read from a shell that replaced the shared one while it was asked', async () => {
    const sent: TerminalReadRequest[] = []
    const references = attached(sent)
    const { ref } = await references.create(PANE, 'shared')
    const read = references.read(ref, 10)
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    shells.set(PANE, 'shell-2')
    references.answer({ requestId: sent[0]!.requestId, reading: reading('SECRET-FROM-NEW-SHELL') })
    await expect(read).rejects.toThrow(/restarted while it was being read/)
    expect(await references.resolve(ref)).toBeUndefined()
  })
})
