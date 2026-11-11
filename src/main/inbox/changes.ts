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
import { fetchGitWithRunners, readGitCommitWithRunner, readGitGraphWithRunner } from '../git-graph'

function nullDevice(session: DirectoryContext): string {
  return session.kind === 'wsl' || process.platform !== 'win32' ? '/dev/null' : 'NUL'
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
