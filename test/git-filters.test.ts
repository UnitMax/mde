import { describe, expect, it, vi } from 'vitest'
import { gitFilterSafetyArgs } from '../src/main/git-filters'

describe('Git filter inspection', () => {
  it('does not inspect filters for branch and ref metadata', async () => {
    const run = vi.fn()
    for (const args of [['symbolic-ref', '--short', 'HEAD'], ['for-each-ref'], ['worktree', 'prune']]) {
      expect(await gitFilterSafetyArgs(run, args)).toEqual([])
    }
    expect(run).not.toHaveBeenCalled()
  })

  it('reads effective names from the operation’s worktree without requesting command values', async () => {
    const run = vi.fn(async () => ({ stdout: 'filter.with.dots.clean\0filter.with.dots.process\0', stderr: '', code: 0 }))
    const overrides = await gitFilterSafetyArgs(run, ['--literal-pathspecs', '-C', '/repo/checkout', '--no-pager', 'status'])
    expect(run).toHaveBeenCalledWith([
      '--literal-pathspecs', '-C', '/repo/checkout', '--no-pager', 'config', '--null', '--name-only', '--get-regexp', '^filter\\..*\\.',
    ])
    expect(overrides).toEqual([
      '-c', 'filter.with.dots.clean=', '-c', 'filter.with.dots.smudge=',
      '-c', 'filter.with.dots.process=', '-c', 'filter.with.dots.required=false',
    ])
  })

  it('makes a selected checkout filter fail instead of silently skipping its conversion', async () => {
    const run = async () => ({ stdout: 'filter.lfs.process\0', stderr: '', code: 0 })
    expect(await gitFilterSafetyArgs(run, ['worktree', 'add', '--', '/new', 'main']))
      .toContain('filter.lfs.required=true')
  })

  it('accepts only a clean no-match result as having no configured drivers', async () => {
    expect(await gitFilterSafetyArgs(async () => ({ stdout: '', stderr: '', code: 1 }), ['status'])).toEqual([])
    for (const result of [
      { stdout: '', stderr: 'unreadable config', code: 1 },
      { stdout: '', stderr: '', code: 1, launchError: true },
      { stdout: '', stderr: '', code: 128 },
    ]) {
      await expect(gitFilterSafetyArgs(async () => result, ['status'])).rejects.toThrow('Could not inspect Git filters safely.')
    }
  })

  it.each([
    'filter.truncated.clean',
    'filter.a=b.clean\0',
    'filter.line\nbreak.clean\0',
    'other.driver.clean\0',
    `filter.${'x'.repeat(129)}.clean\0`,
  ])('rejects unsafe or malformed key records: %j', async (stdout) => {
    await expect(gitFilterSafetyArgs(async () => ({ stdout, stderr: '', code: 0 }), ['diff']))
      .rejects.toThrow('Could not inspect Git filters safely.')
  })

  it('bounds the generated command line', async () => {
    const stdout = Array.from({ length: 65 }, (_, i) => `filter.driver${i}.clean\0`).join('')
    await expect(gitFilterSafetyArgs(async () => ({ stdout, stderr: '', code: 0 }), ['status']))
      .rejects.toThrow('Too many Git filters')
  })
})
