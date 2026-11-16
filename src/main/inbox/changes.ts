import type {
  InboxChangesResponse,
  InboxChangeDiff,
  DirectoryContext,
  InboxGitGraph,
  GitGraphScope,
  InboxGitCommitDetails,
  InboxGitFetchResult,
  InboxThread,
} from '@shared/types'
import { createGitCommandRunner, createGitFetchRunner, readGitCheckoutChangesWithRunner, readGitCheckoutDiffWithRunner } from '../git'
import {
  fetchGitWithRunners, readGitCommitDiffWithRunner, readGitCommitWithRunner, readGitGraphAndCheckouts, readGitGraphWithRunner,
  threadsInCheckouts,
} from '../git-graph'

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

/**
 * The graph, with the Inbox threads that run in the repository's checkouts (its main working tree
 * and its worktrees) and the commit each is at. Only threads on the same machine as the checkout
 * (native, or the same WSL distribution) are looked at, and archived ones and those whose worktree
 * was deleted are left out. `own` is the thread the graph was opened from, which is in the graph's
 * own checkout whatever its path is spelled like.
 */
export async function readInboxGitGraphWithThreads(
  session: DirectoryContext,
  limit: number,
  scope: GitGraphScope,
  threads: readonly InboxThread[],
  own?: string,
): Promise<InboxGitGraph> {
  const { graph, checkouts } = await readGitGraphAndCheckouts(
    createGitCommandRunner(session, process.platform, session.path), limit, scope, true)
  if (!graph.available) return graph
  const here = threads.filter((thread) =>
    !thread.archived && !thread.worktreeRemovedAt && thread.target.kind === session.kind &&
    (thread.target.kind !== 'wsl' || thread.target.distro === session.distro))
  const found = threadsInCheckouts(checkouts, here)
  if (own && graph.worktree && !found.some((item) => item.threadId === own) && here.some((thread) => thread.id === own)) {
    found.push({ threadId: own, head: graph.head, branch: graph.branch, root: graph.worktree })
  }
  return { ...graph, threads: found }
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
