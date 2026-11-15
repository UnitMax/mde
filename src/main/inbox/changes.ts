import type {
  InboxChangesResponse,
  InboxChangeDiff,
  DirectoryContext,
  InboxGitGraph,
  GitGraphScope,
  InboxGitCommitDetails,
  InboxGitFetchResult,
} from '@shared/types'
import { createGitCommandRunner, createGitFetchRunner, readGitCheckoutChangesWithRunner, readGitCheckoutDiffWithRunner } from '../git'
import { fetchGitWithRunners, readGitCommitDiffWithRunner, readGitCommitWithRunner, readGitGraphWithRunner } from '../git-graph'

function nullDevice(session: DirectoryContext): string {
  return session.kind === 'wsl' || process.platform !== 'win32' ? '/dev/null' : 'NUL'
}

/**
 * Which of these paths, relative to the folder, Git ignores there (`git check-ignore`, which reads no file contents).
 * A folder's path ends in `/`. Outside a repository, or when Git cannot be run, none.
 */
export async function readGitIgnoredPaths(session: DirectoryContext, paths: string[]): Promise<Set<string>> {
  if (paths.length === 0) return new Set()
  // One path a line, as given; quotePath off so a name with other than ASCII letters is not written in quotes.
  const result = await createGitCommandRunner(session, process.platform, session.path)(['-c', 'core.quotePath=false', 'check-ignore', '--', ...paths])
  // 0: some are ignored; 1: none are; anything else is an error, such as no repository.
  if (result.code !== 0) return new Set()
  return new Set(result.stdout.split('\n').map((line) => line.replace(/\r$/, '')).filter(Boolean))
}

/** Changes belong to the current checkout; no OpenCode history or fork metadata is read. */
export async function readInboxGitChanges(session: DirectoryContext, details = false): Promise<InboxChangesResponse> {
  const result = await readGitCheckoutChangesWithRunner(
    createGitCommandRunner(session, process.platform, session.path, details ? 'interactive' : 'background'),
    nullDevice(session)
  )
  if (details) return result
  const { files: _files, ...summary } = result
  return summary
}

export function readInboxGitDiff(session: DirectoryContext, path: string): Promise<InboxChangeDiff> {
  return readGitCheckoutDiffWithRunner(createGitCommandRunner(session, process.platform, session.path), path, nullDevice(session))
}

/** The commit graph for the Git graph view; refs and commit metadata only, no file is read. */
export function readInboxGitGraph(session: DirectoryContext, limit: number, scope: GitGraphScope): Promise<InboxGitGraph> {
  return readGitGraphWithRunner(createGitCommandRunner(session, process.platform, session.path), limit, scope)
}

export function readInboxGitCommit(session: DirectoryContext, hash: string): Promise<InboxGitCommitDetails> {
  return readGitCommitWithRunner(createGitCommandRunner(session, process.platform, session.path), hash)
}

/** `git fetch --all --prune`, started only by the person's Fetch button. */
export function fetchInboxGit(session: DirectoryContext): Promise<InboxGitFetchResult> {
  return fetchGitWithRunners(
    createGitCommandRunner(session, process.platform, session.path),
    (root) => createGitFetchRunner(session, root),
  )
}

export function readInboxGitCommitDiff(session: DirectoryContext, hash: string, path: string): Promise<InboxChangeDiff> {
  return readGitCommitDiffWithRunner(createGitCommandRunner(session, process.platform, session.path), hash, path)
}
