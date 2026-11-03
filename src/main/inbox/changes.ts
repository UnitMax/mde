import type { InboxChangesResponse, InboxChangeDiff, Session } from '@shared/types'
import { createGitCommandRunner, readGitCheckoutChangesWithRunner, readGitCheckoutDiffWithRunner } from '../git'

function nullDevice(session: Session): string {
  return session.kind === 'wsl' || process.platform !== 'win32' ? '/dev/null' : 'NUL'
}

/** Changes belong to the current checkout; no OpenCode history or fork metadata is read. */
export async function readInboxGitChanges(session: Session, details = false): Promise<InboxChangesResponse> {
  const result = await readGitCheckoutChangesWithRunner(
    createGitCommandRunner(session, process.platform, session.path, details ? 'interactive' : 'background'),
    nullDevice(session)
  )
  if (details) return result
  const { files: _files, ...summary } = result
  return summary
}

export function readInboxGitDiff(session: Session, path: string): Promise<InboxChangeDiff> {
  return readGitCheckoutDiffWithRunner(createGitCommandRunner(session), path, nullDevice(session))
}
