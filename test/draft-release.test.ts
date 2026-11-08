import { describe, expect, it, vi } from 'vitest'
import { ensureReleaseTag, uploadDraftRelease } from '../scripts/draft-release.mjs'

const tag = 'v0.0.1'
const repository = 'example/mde'
const assets = ['mde-0.0.1-win.zip', 'mde-0.0.1-arm64.dmg']

function client(pages: unknown[][]) {
  return vi.fn().mockReturnValueOnce(JSON.stringify(pages)).mockReturnValue('')
}

describe('draft release uploads', () => {
  it('creates an unpublished draft for an existing tag with all assets', () => {
    const run = client([[]])
    uploadDraftRelease({ tag, repository, assets, run })
    expect(run.mock.calls[1]?.[1]).toEqual([
      'release', 'create', tag, '--repo', repository, '--draft', '--verify-tag', '--title', tag, ...assets,
    ])
  })

  it('finds drafts on later pages and replaces their assets without editing notes', () => {
    const run = client([[{ tag_name: 'v0.0.2', draft: false }], [{ tag_name: tag, draft: true }]])
    uploadDraftRelease({ tag, repository, assets, run })
    expect(run.mock.calls[0]?.[1]).toEqual(['api', '--paginate', '--slurp', `repos/${repository}/releases`])
    expect(run.mock.calls[1]?.[1]).toEqual(['release', 'upload', tag, '--repo', repository, '--clobber', ...assets])
  })

  it('refuses to modify a published release', () => {
    const run = client([[{ tag_name: tag, draft: false }]])
    expect(() => uploadDraftRelease({ tag, repository, assets, run })).toThrow('already published')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('does not mistake an API failure for a missing release', () => {
    const run = vi.fn(() => { throw new Error('API unavailable') })
    expect(() => uploadDraftRelease({ tag, repository, assets, run })).toThrow('API unavailable')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('rejects ambiguous releases and invalid tags before uploading', () => {
    const run = client([[{ tag_name: tag, draft: true }, { tag_name: tag, draft: true }]])
    expect(() => uploadDraftRelease({ tag, repository, assets, run })).toThrow('Multiple releases')
    expect(run).toHaveBeenCalledTimes(1)
    expect(() => uploadDraftRelease({ tag: '--draft', repository, assets, run })).toThrow('version tag')
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('release tags', () => {
  const sha = 'a'.repeat(40)
  const other = 'b'.repeat(40)

  /** Answers the two lookups in order: the release list, then the matching tag refs. */
  function lookups(releases: unknown[], refs: unknown[], third = '') {
    return vi.fn()
      .mockReturnValueOnce(JSON.stringify([releases]))
      .mockReturnValueOnce(JSON.stringify(refs))
      .mockReturnValueOnce(third)
      .mockReturnValue('')
  }

  it('creates the tag on the built commit when there is none', () => {
    const run = lookups([], [{ ref: `refs/tags/${tag}-rc1`, object: { type: 'commit', sha: other } }])
    expect(ensureReleaseTag({ tag, sha, repository, run })).toBe('created')
    expect(run.mock.calls[1]?.[1]).toEqual(['api', `repos/${repository}/git/matching-refs/tags/${tag}`])
    expect(run.mock.calls[2]?.[1]).toEqual([
      'api', '--method', 'POST', `repos/${repository}/git/refs`, '-f', `ref=refs/tags/${tag}`, '-f', `sha=${sha}`,
    ])
  })

  it('only checks when asked not to create', () => {
    const run = lookups([{ tag_name: tag, draft: true }], [])
    expect(ensureReleaseTag({ tag, sha, repository, create: false, run })).toBe('created')
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('accepts a tag already on the built commit, lightweight or annotated', () => {
    expect(ensureReleaseTag({ tag, sha, repository, run: lookups([], [{ ref: `refs/tags/${tag}`, object: { type: 'commit', sha } }]) })).toBe('exists')
    const annotated = lookups([], [{ ref: `refs/tags/${tag}`, object: { type: 'tag', sha: other } }], JSON.stringify({ object: { type: 'commit', sha } }))
    expect(ensureReleaseTag({ tag, sha, repository, run: annotated })).toBe('exists')
    expect(annotated.mock.calls[2]?.[1]).toEqual(['api', `repos/${repository}/git/tags/${other}`])
  })

  it('refuses a tag on another commit and a version that is already published', () => {
    const moved = lookups([], [{ ref: `refs/tags/${tag}`, object: { type: 'commit', sha: other } }])
    expect(() => ensureReleaseTag({ tag, sha, repository, run: moved })).toThrow('different commit')
    const published = lookups([{ tag_name: tag, draft: false }], [])
    expect(() => ensureReleaseTag({ tag, sha, repository, run: published })).toThrow('already published')
    expect(published).toHaveBeenCalledTimes(1)
  })

  it('rejects a malformed tag or commit before asking GitHub', () => {
    const run = vi.fn()
    expect(() => ensureReleaseTag({ tag: '--delete', sha, repository, run })).toThrow('version tag')
    expect(() => ensureReleaseTag({ tag, sha: 'main', repository, run })).toThrow('full commit SHA')
    expect(run).not.toHaveBeenCalled()
  })
})
