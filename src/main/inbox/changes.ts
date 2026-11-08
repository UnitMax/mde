import type { InboxChangesResponse, InboxChangeDiff, DirectoryContext } from '@shared/types'
import { createGitCommandRunner, readGitCheckoutChangesWithRunner, readGitCheckoutDiffWithRunner } from '../git'

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
