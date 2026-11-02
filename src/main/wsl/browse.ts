import type { FileTreeEntry, WslDirectoryListing } from '@shared/types'
import { parseFindOutput, sortFileTreeEntries } from '../files/tree'
import { runWslCommand, type WslResult } from './distros'
import { directoryCheckArgs, isPlainAbsolutePath } from './paths'
import { assertWslLinuxPath, readWslShellValue } from './shell-value'

/** More folders than this are cut off; nobody picks a project from a longer list. */
export const MAX_BROWSE_DIRECTORIES = 1000

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/

export interface WslBrowseDependencies {
  runWsl(distro: string, command: readonly string[]): Promise<WslResult>
  /** The home directory of the distro's default user. */
  home(distro: string): Promise<string>
}

const defaults: WslBrowseDependencies = {
  runWsl: (distro, command) => runWslCommand(distro, command),
  home: async (distro) => {
    const value = await readWslShellValue(distro, '"$HOME"')
    if (value.value === null) throw new Error(`Could not read the home directory of ${distro}.`)
    return assertWslLinuxPath(value.value, 'home directory')
  },
}

/** `/home/me/` becomes `/home/me`; the root stays `/`. */
function withoutTrailingSlashes(path: string): string {
  return path.replace(/\/+$/, '') || '/'
}

/**
 * A folder name the browser can offer: one that, appended to its parent, is still a plain absolute
 * path. A backslash or a control character would be rejected by every later step, so such folders
 * are left out instead of being shown and then failing when opened.
 */
function browsable(name: string): boolean {
  return name.length > 0 && !name.includes('\\') && !CONTROL_CHARS.test(name)
}

function listFailure(result: WslResult): Error {
  const detail = result.stderr.trim().split('\n')[0]?.trim() ?? ''
  if (/no such file or directory/i.test(detail)) return new Error('That folder does not exist.')
  if (/not a directory/i.test(detail)) return new Error('That is not a folder.')
  if (/permission denied/i.test(detail)) return new Error('Permission denied.')
  return new Error(detail ? `Could not list the folder: ${detail.slice(0, 200)}` : 'Could not list the folder.')
}

function folderNames(entries: readonly FileTreeEntry[], hidden: boolean): string[] {
  return sortFileTreeEntries(entries)
    .filter((entry) => entry.kind === 'directory' && browsable(entry.name) && (hidden || !entry.name.startsWith('.')))
    .map((entry) => entry.name)
}

/**
 * Lists the folders inside one folder of a WSL distro, for the folder browser that replaces the
 * Windows file dialog (which cannot show a distro's own filesystem). Read-only and names only: no
 * file, no file content, and nothing is written. The distro runs `find` directly (`wsl.exe -e`,
 * no shell), so the path is one argument that cannot be parsed as syntax; it is absolute, so
 * `find` cannot read it as an option either. `-L` makes a symlink to a folder count as a folder.
 */
export async function listWslDirectories(
  request: { distro: string; path?: string; hidden?: boolean },
  platform: NodeJS.Platform = process.platform,
  deps: WslBrowseDependencies = defaults,
): Promise<WslDirectoryListing> {
  if (platform !== 'win32') throw new Error('WSL folders can only be browsed on Windows.')

  let directory: string
  if (request.path === undefined) {
    const home = withoutTrailingSlashes(await deps.home(request.distro))
    // A home directory this app could not use further down is no place to start; the root is.
    directory = isPlainAbsolutePath(home) ? home : '/'
  } else {
    directory = withoutTrailingSlashes(request.path)
    if (!isPlainAbsolutePath(directory)) throw new Error('Invalid folder path.')
  }

  const result = await deps.runWsl(request.distro, [
    'find', '-L', directory, '-mindepth', '1', '-maxdepth', '1', '-printf', '%y\\t%f\\n',
  ])
  // find exits 1 when some entry could not be examined but still lists the rest. Only a listing
  // that failed outright, with nothing to show, is an error.
  if (result.code !== 0 && !result.stdout.trim()) throw listFailure(result)
  // find prints nothing for an empty folder and for a file alike; only a folder may be listed.
  if (!result.stdout.trim() && (await deps.runWsl(request.distro, directoryCheckArgs(directory))).code !== 0) {
    throw new Error('That is not a folder.')
  }

  const names = folderNames(parseFindOutput(result.stdout), request.hidden === true)
  return {
    path: directory,
    directories: names.slice(0, MAX_BROWSE_DIRECTORIES),
    truncated: names.length > MAX_BROWSE_DIRECTORIES,
  }
}
