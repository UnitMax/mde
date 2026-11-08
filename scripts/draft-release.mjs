import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const TAG_PATTERN = /^v?\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/
const SHA_PATTERN = /^[0-9a-f]{40}$/

const ghWith = (run) => (args) => run('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })

// List releases rather than looking up by tag: unpublished drafts must be found too.
export function uploadDraftRelease({ tag, repository, assets, run = execFileSync }) {
  if (!TAG_PATTERN.test(tag ?? '')) {
    throw new Error('A version tag is required')
  }
  if (!repository || !assets.length) throw new Error('Repository and release assets are required')

  const gh = ghWith(run)
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


/**
 * Makes sure the release tag points at the commit that was built, before anything is attached to it. A version that
 * is already published, or whose tag is on another commit, is refused: both mean this version was released before.
 * With `create` false it only checks, which is how the release workflow fails early, before it builds anything.
 * A tag is created only here, after both builds passed, so a failed build leaves nothing behind.
 */
export function ensureReleaseTag({ tag, sha, repository, create = true, run = execFileSync }) {
  if (!TAG_PATTERN.test(tag ?? '')) throw new Error('A version tag is required')
  if (!SHA_PATTERN.test(sha ?? '')) throw new Error('A full commit SHA is required')
  if (!repository) throw new Error('A repository is required')

  const gh = ghWith(run)
  const pages = JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repository}/releases`]))
  const published = pages.flat().some((release) => release.tag_name === tag && release.draft !== true)
  if (published) throw new Error(`${tag} is already published; raise the version for a new release`)

  // Matches by prefix, so only the exact ref counts. A missing tag is an empty list, not an error.
  const refs = JSON.parse(gh(['api', `repos/${repository}/git/matching-refs/tags/${tag}`]))
  const existing = refs.find((ref) => ref.ref === `refs/tags/${tag}`)
  if (!existing) {
    if (create) gh(['api', '--method', 'POST', `repos/${repository}/git/refs`, '-f', `ref=refs/tags/${tag}`, '-f', `sha=${sha}`])
    return 'created'
  }

  let target = existing.object
  // An annotated tag points at a tag object; follow it to the commit.
  if (target.type === 'tag') target = JSON.parse(gh(['api', `repos/${repository}/git/tags/${target.sha}`])).object
  if (target.sha !== sha) throw new Error(`${tag} already exists on a different commit (${target.sha}); raise the version or delete that tag`)
  return 'exists'
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, tag, ...rest] = process.argv.slice(2)
  const repository = process.env.GITHUB_REPOSITORY
  if (command === 'check' || command === 'tag') {
    ensureReleaseTag({ tag, sha: rest[0], repository, create: command === 'tag' })
  } else if (command === 'upload') {
    uploadDraftRelease({ tag, repository, assets: rest })
  } else {
    throw new Error('Usage: draft-release.mjs check|tag <tag> <sha> | upload <tag> <asset>...')
  }
}
