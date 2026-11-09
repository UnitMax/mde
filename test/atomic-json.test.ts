import { describe, expect, it } from 'vitest'
import { renameOver } from '../src/main/store/atomic-json'

const refusal = (code: string): Error => Object.assign(new Error(code), { code })

describe('renaming a written file over the one it replaces', () => {
  it('tries again when Windows refuses because another program has the file open', async () => {
    const codes = ['EPERM', 'EBUSY', 'EACCES']
    let calls = 0
    await renameOver('from', 'to', async () => {
      calls += 1
      const code = codes.shift()
      if (code) throw refusal(code)
    }, [1, 1, 1])
    expect(calls).toBe(4)
  })

  it('gives up with the refusal once the tries are used up', async () => {
    let calls = 0
    await expect(renameOver('from', 'to', async () => { calls += 1; throw refusal('EPERM') }, [1, 1])).rejects.toMatchObject({ code: 'EPERM' })
    expect(calls).toBe(3)
  })

  it('does not try again after any other failure', async () => {
    let calls = 0
    await expect(renameOver('from', 'to', async () => { calls += 1; throw refusal('ENOSPC') }, [1, 1])).rejects.toMatchObject({ code: 'ENOSPC' })
    expect(calls).toBe(1)
  })
})
