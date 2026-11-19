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

  beforeEach(async () => {
    folder = await fs.mkdtemp(join(tmpdir(), 'mde-terminal-refs-'))
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

  /** A window that brought back `PANE` at start. */
  async function attached(references: TerminalReferences, sent: TerminalReadRequest[] = [], window = true): Promise<TerminalReadRequest[]> {
    references.attach({ send: (request) => { if (window) sent.push(request); return window }, now: () => 1000 })
    await references.retain([PANE])
    return sent
  }

  it('gives a pane one ref, keeps it between runs, and reads the title again', async () => {
    const references = new TerminalReferences(folder, counter())
    const first = await references.create(PANE, 'Dev server')
    expect(isTerminalRef(first.ref)).toBe(true)
    expect(first.text).toBe(`[terminal:${first.ref} "Dev server"]`)
    const again = await references.create(PANE, 'npm run dev')
    expect(again).toEqual({ ref: first.ref, text: `[terminal:${first.ref} "npm run dev"]` })

    const later = new TerminalReferences(folder, counter())
    expect(await later.resolve(first.ref)).toEqual({ terminalId: PANE, title: 'npm run dev' })
    const stored = JSON.parse(await fs.readFile(join(folder, TERMINAL_REFERENCES_FILE), 'utf8'))
    expect(stored.references).toHaveLength(1)
  })

  it('names only panes of the Inbox terminal', async () => {
    const references = new TerminalReferences(folder, counter())
    await expect(references.create('session-1:tab:t:pane:pane-1', 'x')).rejects.toThrow(/Inbox terminal/)
    await expect(references.create(`${PANE}\n`, 'x')).rejects.toThrow()
    expect(await references.resolve('not a ref')).toBeUndefined()
  })

  it('keeps the newest refs only', async () => {
    const references = new TerminalReferences(folder, counter())
    const first = await references.create(`${PANE}-0`, 'first')
    for (let index = 1; index <= TERMINAL_REFERENCE_LIMIT; index += 1) await references.create(`${PANE}-${index}`, 'pane')
    expect(await references.resolve(first.ref)).toBeUndefined()
  })

  it('ignores a damaged file', async () => {
    await fs.writeFile(join(folder, TERMINAL_REFERENCES_FILE), '{"references":[{"ref":"../x","terminalId":"y"}, 5]}')
    const references = new TerminalReferences(folder, counter())
    expect(await references.resolve('k3m9x2qavw')).toBeUndefined()
    expect((await references.create(PANE, 'a')).ref).toMatch(/^[a-z2-9]{10}$/)
  })

  it('asks the window for the pane a ref names and passes on its answer', async () => {
    const references = new TerminalReferences(folder, counter())
    const sent = await attached(references)
    const { ref } = await references.create(PANE, 'Dev server')
    const reading = references.read(ref, 50)
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toMatchObject({ terminalId: PANE, lines: 50 })
    references.answer({ requestId: sent[0]!.requestId, reading: { title: 'Dev server', directory: null, running: true, totalLines: 1, text: 'ok' } })
    await expect(reading).resolves.toMatchObject({ text: 'ok' })

    const failing = references.read(ref, 50)
    await vi.waitFor(() => expect(sent).toHaveLength(2))
    references.answer({ requestId: sent[1]!.requestId, error: 'That terminal was closed.' })
    await expect(failing).rejects.toThrow('That terminal was closed.')
    // An answer nobody waits for is dropped.
    references.answer({ requestId: 'nobody', error: 'x' })
  })

  it('refuses a ref it did not make, with no window, and too many at once', async () => {
    const references = new TerminalReferences(folder, counter())
    await expect(references.read('k3m9x2qavw', 10)).rejects.toThrow(/dragged into a message/)
    const { ref } = await references.create(PANE, 'a')
    await expect(references.read(ref, 10)).rejects.toThrow(/starting/)
    await attached(references, [], false)
    await expect(references.read(ref, 10)).rejects.toThrow(/no window/)

    const busy = new TerminalReferences(folder, counter())
    await attached(busy)
    const waiting = Array.from({ length: TERMINAL_READ_PENDING_LIMIT }, () => busy.read(ref, 10))
    await vi.waitFor(async () => expect(await busy.read(ref, 10).catch((error: Error) => error.message)).toMatch(/other terminals/))
    void Promise.allSettled(waiting)
  })

  it('gives up on a window that does not answer', async () => {
    const references = new TerminalReferences(folder, counter())
    await attached(references)
    const { ref } = await references.create(PANE, 'a')
    vi.useFakeTimers()
    const reading = references.read(ref, 10)
    const outcome = expect(reading).rejects.toThrow(/did not answer/)
    await vi.advanceTimersByTimeAsync(TERMINAL_READ_TIMEOUT_MS)
    await outcome
  })

  it('forgets the refs of a closed pane, so a later pane is not read through them', async () => {
    const references = new TerminalReferences(folder, counter())
    const sent = await attached(references)
    const closed = await references.create(PANE, 'shared')
    const other = await references.create(`${PANE}x`, 'other')
    await references.forget([PANE])
    await expect(references.read(closed.ref, 10)).rejects.toThrow(/dragged into a message/)
    expect(sent).toHaveLength(0)
    expect(await new TerminalReferences(folder, counter()).resolve(closed.ref)).toBeUndefined()
    expect(await references.resolve(other.ref)).toMatchObject({ terminalId: `${PANE}x` })
  })

  it('reads nothing until the window says which panes it brought back, and forgets the refs of all others', async () => {
    const earlier = new TerminalReferences(folder, counter())
    const kept = await earlier.create(PANE, 'kept')
    const gone = await earlier.create(`${PANE}x`, 'gone')

    const references = new TerminalReferences(folder, counter())
    const sent: TerminalReadRequest[] = []
    references.attach({ send: (request) => { sent.push(request); return true }, now: () => 1000 })
    await expect(references.read(kept.ref, 10)).rejects.toThrow(/starting/)
    await references.retain([PANE])
    expect(await references.resolve(gone.ref)).toBeUndefined()
    expect(await new TerminalReferences(folder, counter()).resolve(gone.ref)).toBeUndefined()
    void references.read(kept.ref, 10).catch(() => undefined)
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toMatchObject({ terminalId: PANE })
    references.answer({ requestId: sent[0]!.requestId, error: 'done' })
  })
})
