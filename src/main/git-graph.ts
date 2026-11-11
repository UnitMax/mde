import type {
  GitChangeStatus,
  GitGraphCommit,
  GitGraphRef,
  GitGraphScope,
  InboxGitCommitDetails,
  InboxGitCommitFile,
  InboxGitGraph,
} from '@shared/types'
import { checkoutRunner, parseGitFileNumstat, repositoryFetchPrograms, type GitCommandResult, type GitCommandRunner } from './git'

/** The most commits one request reads; the view asks for more in steps. */
export const GIT_GRAPH_MAX_COMMITS = 5000
/** Refs beyond this many (a repository with thousands of tags) are left out. */
const GIT_GRAPH_REF_LIMIT = 2000
/** A commit's file list stops here; a commit that touches more says so. */
export const GIT_COMMIT_FILE_LIMIT = 500
const FIELD = '\x1f'
const RECORD = '\x1e'

function failure(what: string, result: GitCommandResult): Error {
  return new Error(result.launchError ? `Could not run Git ${what}.` : `Could not read Git ${what}.`)
}

/** Parses `git log --format=%H%x1f%P%x1f%an%x1f%at%x1f%s%x1e` output. */
export function parseGitGraphLog(stdout: string): GitGraphCommit[] {
  const commits: GitGraphCommit[] = []
  for (const record of stdout.split(RECORD)) {
    const fields = record.replace(/^\n/, '').split(FIELD)
    if (fields.length < 5 || !/^[0-9a-f]{40,64}$/.test(fields[0]!)) continue
    commits.push({
      hash: fields[0]!,
      parents: fields[1]!.split(' ').filter(Boolean),
      author: fields[2]!,
      time: Number(fields[3]) || 0,
      // A subject cannot hold the separators, but keep any later field rather than lose text.
      subject: fields.slice(4).join(' '),
    })
  }
  return commits
}

/**
 * Parses `for-each-ref --format=%(objectname)%1f%(*objectname)%1f%(refname)`. An annotated tag
 * points at its tag object; the commit it names is `*objectname`. A remote's `HEAD` is not a branch.
 */
export function parseGitGraphRefs(stdout: string): GitGraphRef[] {
  const refs: GitGraphRef[] = []
  for (const line of stdout.split('\n')) {
    const [object, peeled, refname] = line.split(FIELD)
    if (!object || refname === undefined) continue
    const hash = peeled || object
    if (refname.startsWith('refs/heads/')) {
      refs.push({ hash, name: refname.slice('refs/heads/'.length), kind: 'branch' })
    } else if (refname.startsWith('refs/remotes/')) {
      const name = refname.slice('refs/remotes/'.length)
      if (name.includes('/') && !name.endsWith('/HEAD')) refs.push({ hash, name, kind: 'remote' })
    } else if (refname.startsWith('refs/tags/')) {
      refs.push({ hash, name: refname.slice('refs/tags/'.length), kind: 'tag' })
    }
  }
  return refs
}

function unavailable(reason: string): InboxGitGraph {
  return {
    available: false, reason, worktree: null, head: null, branch: null, upstream: null,
    remotes: [], refs: [], commits: [], more: false,
  }
}

async function readUpstream(run: GitCommandRunner): Promise<InboxGitGraph['upstream']> {
  const name = await run(['--no-pager', 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
  if (name.code !== 0 || !name.stdout.trim()) return null
  const counts = await run(['--no-pager', 'rev-list', '--left-right', '--count', 'HEAD...@{upstream}', '--'])
  const match = /^(\d+)\s+(\d+)/.exec(counts.stdout.trim())
  if (counts.code !== 0 || !match) return null
  return { name: name.stdout.trim(), ahead: Number(match[1]), behind: Number(match[2]) }
}

/**
 * The commits reachable from the refs the scope names, and always from HEAD,
 * newest first in date order, with the refs that point into them. Metadata only: no file is read.
 */
export async function readGitGraphWithRunner(
  source: GitCommandRunner,
  limit: number,
  scope: GitGraphScope,
): Promise<InboxGitGraph> {
  const checkout = await checkoutRunner(source)
  if (!checkout) return unavailable('This folder is not a Git repository.')
  const run = checkout.run
  const count = Math.max(1, Math.min(GIT_GRAPH_MAX_COMMITS, Math.floor(limit)))
  const [head, branch, refs, remotes] = await Promise.all([
    run(['--no-pager', 'rev-parse', '--verify', '--quiet', 'HEAD^{commit}']),
    run(['--no-pager', 'symbolic-ref', '--quiet', '--short', 'HEAD']),
    run([
      '--no-pager', 'for-each-ref', `--count=${GIT_GRAPH_REF_LIMIT}`,
      '--format=%(objectname)%1f%(*objectname)%1f%(refname)',
      'refs/heads', 'refs/remotes', 'refs/tags',
    ]),
    run(['--no-pager', 'remote']),
  ])
  if (head.launchError) throw failure('HEAD', head)
  if (refs.code !== 0) throw failure('refs', refs)
  if (remotes.code !== 0) throw failure('remotes', remotes)
  const headHash = head.code === 0 ? head.stdout.trim() || null : null
  const branchName = branch.code === 0 ? branch.stdout.trim() || null : null
  const allRefs = parseGitGraphRefs(refs.stdout)
  const revisions = [
    ...(scope !== 'head' && allRefs.length ? ['--branches', '--tags'] : []),
    ...(scope === 'all' && allRefs.length ? ['--remotes'] : []),
    ...(headHash ? ['HEAD'] : []),
  ]
  let commits: GitGraphCommit[] = []
  if (revisions.length) {
    const log = await run([
      '--no-pager', 'log', '--no-show-signature', '--no-color', '--date-order',
      '--format=%H%x1f%P%x1f%an%x1f%at%x1f%s%x1e',
      '-n', String(count + 1),
      ...revisions, '--',
    ])
    if (log.code !== 0) throw failure('history', log)
    commits = parseGitGraphLog(log.stdout)
  }
  const more = commits.length > count
  if (more) commits = commits.slice(0, count)
  const shown = new Set(commits.map((commit) => commit.hash))
  return {
    available: true,
    worktree: checkout.root,
    head: headHash,
    branch: branchName,
    upstream: branchName && headHash ? await readUpstream(run) : null,
    remotes: remotes.stdout.split('\n').map((line) => line.trim()).filter(Boolean),
    refs: allRefs.filter((ref) => shown.has(ref.hash)),
    commits,
    more,
  }
}

const STATUS_LETTERS: Record<string, GitChangeStatus> = {
  A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'copied', T: 'type-changed', U: 'unmerged',
}

/** Parses `diff-tree --name-status -z`: a status, then one path (two for a rename or copy). */
export function parseGitNameStatus(stdout: string): Array<{ path: string; from?: string; status: GitChangeStatus }> {
  const fields = stdout.split('\0')
  const files: Array<{ path: string; from?: string; status: GitChangeStatus }> = []
  for (let index = 0; index < fields.length;) {
    const code = fields[index++]
    if (!code) continue
    const status = STATUS_LETTERS[code[0]!] ?? 'modified'
    if (code[0] === 'R' || code[0] === 'C') {
      const from = fields[index++] ?? ''
      const path = fields[index++] ?? ''
      if (path) files.push({ path, from, status })
    } else {
      const path = fields[index++] ?? ''
      if (path) files.push({ path, status })
    }
  }
  return files
}

/**
 * One commit's message and the files it changed against its first parent. The hash is a full
 * object name checked by the IPC boundary, so it cannot be read as an option or a range.
 */
export async function readGitCommitWithRunner(source: GitCommandRunner, hash: string): Promise<InboxGitCommitDetails> {
  const checkout = await checkoutRunner(source)
  if (!checkout) throw new Error('This folder is not a Git repository.')
  const run = checkout.run
  const info = await run([
    '--no-pager', 'log', '-1', '--no-show-signature', '--no-color',
    '--format=%H%x00%P%x00%an%x00%at%x00%cn%x00%ct%x00%B', `${hash}^{commit}`, '--',
  ])
  if (info.code !== 0) throw new Error('That commit is not in this repository.')
  const [full, parentList, author, authorTime, committer, commitTime, ...message] = info.stdout.split('\0')
  const parents = (parentList ?? '').split(' ').filter(Boolean)
  // A merge is shown against its first parent, the way the branch it was merged into saw it.
  const range = parents.length > 1 ? [parents[0]!, full!] : ['--root', full!]
  const common = ['--no-pager', 'diff-tree', '-r', '-z', '--no-commit-id', '--find-renames', '--no-ext-diff', '--no-textconv', '--no-color']
  const [names, numbers] = await Promise.all([
    run([...common, '--name-status', ...range, '--']),
    run([...common, '--numstat', ...range, '--']),
  ])
  if (names.code !== 0) throw failure('commit files', names)
  if (numbers.code !== 0) throw failure('commit files', numbers)
  const counts = parseGitFileNumstat(numbers.stdout)
  const listed = parseGitNameStatus(names.stdout)
  const files: InboxGitCommitFile[] = listed.slice(0, GIT_COMMIT_FILE_LIMIT).map((file) => {
    const count = counts.get(file.path)
    return {
      path: file.path,
      ...(file.from ? { from: file.from } : {}),
      status: file.status,
      additions: count?.additions ?? 0,
      deletions: count?.deletions ?? 0,
      binary: count?.binary ?? false,
    }
  })
  return {
    hash: full!,
    parents,
    author: author ?? '',
    authorTime: Number(authorTime) || 0,
    committer: committer ?? '',
    commitTime: Number(commitTime) || 0,
    message: message.join('\0').replace(/\s+$/, ''),
    files,
    truncated: listed.length > GIT_COMMIT_FILE_LIMIT,
  }
}

/**
 * What Git said when a fetch failed, fit to show: its `fatal:` and `error:` lines (or the last
 * line), without control characters or credentials written into a URL, and kept short.
 */
export function fetchErrorMessage(result: GitCommandResult): string {
  if (result.launchError) return 'Could not fetch: Git could not start, or did not finish in time.'
  const lines = result.stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const important = lines.filter((line) => /^(fatal|error|ERROR):/.test(line))
  const text = (important.length ? important : lines.slice(-1)).join(' ')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, '$1')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .trim()
  if (!text) return 'Could not fetch.'
  return `Could not fetch: ${text.length > 400 ? `${text.slice(0, 399)}…` : text}`
}

/**
 * Fetches every remote of the checkout, pruning remote-tracking branches deleted there. `read`
 * is an ordinary (network-less) runner used to look at the repository first; `fetch` is the
 * runner allowed to reach the network. The repository's own configuration must not name a
 * program for the fetch to start; one that does is refused with the settings it names.
 */
export async function fetchGitWithRunners(
  read: GitCommandRunner,
  fetch: (root: string) => GitCommandRunner,
): Promise<{ remotes: string[] }> {
  const checkout = await checkoutRunner(read)
  if (!checkout) throw new Error('This folder is not a Git repository.')
  const [remotes, config] = await Promise.all([
    checkout.run(['--no-pager', 'remote']),
    checkout.run(['--no-pager', 'config', '--list', '--show-scope', '--includes', '-z']),
  ])
  if (remotes.code !== 0) throw failure('remotes', remotes)
  if (config.code !== 0) throw failure('configuration', config)
  const names = remotes.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
  if (!names.length) throw new Error('This repository has no remotes to fetch from.')
  const programs = repositoryFetchPrograms(config.stdout)
  if (programs.length) {
    throw new Error(`This repository's own Git settings choose a program for Git to run (${programs.join(', ')}). Fetch it in a terminal instead.`)
  }
  const result = await fetch(checkout.root)(['fetch', '--all', '--prune', '--no-recurse-submodules', '--quiet'])
  if (result.code !== 0) throw new Error(fetchErrorMessage(result))
  return { remotes: names }
}
