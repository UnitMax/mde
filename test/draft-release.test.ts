import { describe, expect, it, vi } from 'vitest'
import { uploadDraftRelease } from '../scripts/draft-release.mjs'

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
