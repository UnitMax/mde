import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type {
  FileTreeEntry,
  FileTreeEntryKind,
  FileTreeListResponse,
  Session
} from '@shared/types'
import { runWslCommand, type WslResult } from '../wsl/distros'
import { isPlainAbsolutePath, resolveForTarget } from '../wsl/paths'

/** Directories beyond this size are cut off rather than streamed to the renderer. */
export const MAX_FILE_TREE_ENTRIES = 2000

/** Entries never shown in the tree. */
const HIDDEN_ENTRY_NAMES = new Set(['.git'])

/** C0 and C1 controls, including DEL. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/

export interface FileTreeDependencies {
  readNativeDirectory(path: string): Promise<FileTreeEntry[]>
  runWsl(distro: string, command: readonly string[]): Promise<WslResult>
  resolveWslPath(distro: string, rawPath: string): Promise<string>
}

/**
 * True for a directory path relative to the session root: '/'-separated, with
 * no absolute prefix, backslash, control character, or empty/relative segment.
 * The renderer only ever names a directory by this relative form, so this check
 * is what keeps a listing inside the session.
 */
export function isSafeRelativePath(path: string): boolean {
  if (path === '') return true
  if (path.startsWith('/') || path.includes('\\') || CONTROL_CHARS.test(path)) return false
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

export function sortFileTreeEntries(entries: readonly FileTreeEntry[]): FileTreeEntry[] {
  return [...entries].sort((a, b) => {
    const aDirectory = a.kind === 'directory'
    const bDirectory = b.kind === 'directory'
    if (aDirectory !== bDirectory) return aDirectory ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  })
}

function findTypeKind(type: string): FileTreeEntryKind {
  if (type === 'd') return 'directory'
  if (type === 'f') return 'file'
  if (type === 'l') return 'symlink'
  return 'other'
}

/**
 * Parses `find -printf '%y\t%f\n'` output. The type is a single character, so
 * the first tab always ends it and any later tab belongs to the name.
 */
export function parseFindOutput(output: string): FileTreeEntry[] {
  const entries: FileTreeEntry[] = []
  for (const line of output.split('\n')) {
    const separator = line.indexOf('\t')
    if (separator !== 1) continue
    const name = line.slice(separator + 1)
    if (!name || name === '.' || name === '..' || name.includes('/')) continue
    entries.push({ name, kind: findTypeKind(line.charAt(0)) })
  }
  return entries
}

function finishListing(path: string, entries: readonly FileTreeEntry[]): FileTreeListResponse {
  const visible = sortFileTreeEntries(entries.filter((entry) => !HIDDEN_ENTRY_NAMES.has(entry.name)))
  return {
    path,
    entries: visible.slice(0, MAX_FILE_TREE_ENTRIES),
    truncated: visible.length > MAX_FILE_TREE_ENTRIES
  }
}

async function readNativeDirectory(path: string): Promise<FileTreeEntry[]> {
  const dirents = await fs.readdir(path, { withFileTypes: true })
  return dirents.map((dirent) => ({
    name: dirent.name,
    kind: dirent.isSymbolicLink()
      ? 'symlink'
      : dirent.isDirectory()
        ? 'directory'
        : dirent.isFile()
          ? 'file'
          : 'other'
  }))
}

const defaultDependencies: FileTreeDependencies = {
  readNativeDirectory,
  runWsl: (distro, command) => runWslCommand(distro, command),
  resolveWslPath: async (distro, rawPath) =>
    (await resolveForTarget('wsl', distro, rawPath)).path
}

function joinWslPath(root: string, relativePath: string): string {
  if (!relativePath) return root
  const base = root.replace(/\/+$/, '')
  return `${base}/${relativePath}`
}

async function listWslDirectory(
  session: Session,
  relativePath: string,
  deps: FileTreeDependencies
): Promise<FileTreeListResponse> {
  const distro = session.distro
  if (!distro) throw new Error('This WSL session has no distro configured.')

  // Older sessions may still hold `~` or a Windows path; normalize those the
  // same way terminal launches do, then insist on a plain absolute result.
  const root = isPlainAbsolutePath(session.path)
    ? session.path
    : await deps.resolveWslPath(distro, session.path)
  if (!isPlainAbsolutePath(root)) throw new Error('Session folder not found.')

  // -H follows a symlinked starting point (the session root may be one) but no
  // symlink found below it. The directory is absolute, so find cannot read it
  // as an option, and wsl.exe -e passes it without a shell.
  const directory = joinWslPath(root, relativePath)
  const result = await deps.runWsl(distro, [
    'find',
    '-H',
    directory,
    '-mindepth',
    '1',
    '-maxdepth',
    '1',
    '-printf',
    '%y\\t%f\\n'
  ])
  if (result.code !== 0 && !result.stdout.trim()) {
    const detail = result.stderr.trim().split('\n')[0]
    throw new Error(detail ? `Could not list folder: ${detail}` : 'Could not list folder.')
  }
  return finishListing(relativePath, parseFindOutput(result.stdout))
}

async function listNativeDirectory(
  session: Session,
  relativePath: string,
  deps: FileTreeDependencies
): Promise<FileTreeListResponse> {
  const directory = relativePath ? join(session.path, ...relativePath.split('/')) : session.path
  try {
    return finishListing(relativePath, await deps.readNativeDirectory(directory))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') throw new Error(relativePath ? 'Folder not found.' : 'Session folder not found.')
    if (code === 'ENOTDIR') throw new Error('Not a folder.')
    if (code === 'EACCES' || code === 'EPERM') throw new Error('Permission denied.')
    throw new Error('Could not list folder.')
  }
}

/** Lists one directory of a session's tree, named relative to the session root. */
export async function listSessionDirectory(
  session: Session,
  relativePath: string,
  platform: NodeJS.Platform = process.platform,
  deps: FileTreeDependencies = defaultDependencies
): Promise<FileTreeListResponse> {
  if (!isSafeRelativePath(relativePath)) throw new Error('Invalid folder path.')

  if (session.kind === 'wsl') {
    if (platform !== 'win32') throw new Error('WSL sessions can only be listed on Windows.')
    return listWslDirectory(session, relativePath, deps)
  }
  return listNativeDirectory(session, relativePath, deps)
}
