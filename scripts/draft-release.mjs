import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// List releases rather than looking up by tag: unpublished drafts must be found too.
export function uploadDraftRelease({ tag, repository, assets, run = execFileSync }) {
  if (!/^v?\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(tag ?? '')) {
    throw new Error('A version tag is required')
  }
  if (!repository || !assets.length) throw new Error('Repository and release assets are required')

  const gh = (args) => run('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  const pages = JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repository}/releases`]))
  const matches = pages.flat().filter((release) => release.tag_name === tag)
  if (matches.length > 1) throw new Error('Multiple releases exist for this tag')
  if (matches.length && matches[0].draft !== true) {
    throw new Error('The release is already published; refusing to modify it')
  }

  if (matches.length) {
    gh(['release', 'upload', tag, '--repo', repository, '--clobber', ...assets])
  } else {
    gh(['release', 'create', tag, '--repo', repository, '--draft', '--verify-tag', '--title', tag, ...assets])
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  uploadDraftRelease({
    tag: process.argv[2],
    repository: process.env.GITHUB_REPOSITORY,
    assets: process.argv.slice(3),
  })
}
