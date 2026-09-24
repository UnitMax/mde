import { promises as fs } from 'node:fs'
import { join, sep } from 'node:path'
import type {
  FileReadResponse,
  FileTreeEntry,
  FileTreeEntryKind,
  FileTreeListResponse,
  Session
} from '@shared/types'
import {
  runWslCommand,
  runWslCommandBuffer,
  type WslBufferResult,
  type WslResult
} from '../wsl/distros'
import { isPlainAbsolutePath, resolveForTarget } from '../wsl/paths'

/** Directories beyond this size are cut off rather than streamed to the renderer. */
export const MAX_FILE_TREE_ENTRIES = 2000

/** Files beyond this size are reported, not read, by the viewer. */
export const MAX_FILE_VIEW_BYTES = 2 * 1024 * 1024

/** A NUL byte this early means the file is not text worth rendering. */
const BINARY_SNIFF_BYTES = 8000

/** Entries never shown in the tree. */
const HIDDEN_ENTRY_NAMES = new Set(['.git'])

/** C0 and C1 controls, including DEL. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/

export interface FileTreeDependencies {
  readNativeDirectory(path: string): Promise<FileTreeEntry[]>
  runWsl(distro: string, command: readonly string[]): Promise<WslResult>
  runWslBuffer(distro: string, command: readonly string[]): Promise<WslBufferResult>
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
  runWslBuffer: (distro, command) =>
    runWslCommandBuffer(distro, command, { maxBuffer: MAX_FILE_VIEW_BYTES + 64 * 1024 }),
  resolveWslPath: async (distro, rawPath) =>
    (await resolveForTarget('wsl', distro, rawPath)).path
}

function joinWslPath(root: string, relativePath: string): string {
  if (!relativePath) return root
  const base = root.replace(/\/+$/, '')
  return `${base}/${relativePath}`
}

async function wslRoot(
  session: Session,
  deps: FileTreeDependencies
): Promise<{ distro: string; root: string }> {
  const distro = session.distro
  if (!distro) throw new Error('This WSL session has no distro configured.')

  // Older sessions may still hold `~` or a Windows path; normalize those the
  // same way terminal launches do, then insist on a plain absolute result.
  const root = isPlainAbsolutePath(session.path)
    ? session.path
    : await deps.resolveWslPath(distro, session.path)
  if (!isPlainAbsolutePath(root)) throw new Error('Session folder not found.')
  return { distro, root }
}

async function listWslDirectory(
  session: Session,
  relativePath: string,
  deps: FileTreeDependencies
): Promise<FileTreeListResponse> {
  const { distro, root } = await wslRoot(session, deps)

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

/**
 * Reads one file for the viewer, inside the distro, in a single wsl.exe call.
 * Arguments are positional, so paths are never parsed as shell syntax. The
 * target's real path must stay under the real session root: the tree never
 * follows symlinks, and a read must not either. On success stdout is the file
 * size, a newline, and then at most `limit` content bytes, or nothing more
 * when the file is too large to view.
 */
export const READ_WSL_FILE_SCRIPT = [
  'root=$1 target=$2 limit=$3',
  'real_root=$(realpath -e -- "$root") || exit 10',
  'real=$(realpath -e -- "$target") || exit 11',
  'case "$real" in "${real_root%/}"/*) ;; *) exit 12 ;; esac',
  '[ -f "$real" ] || exit 13',
  'size=$(stat -L -c %s -- "$real") || exit 14',
  'printf "%s\\n" "$size"',
  '[ "$size" -gt "$limit" ] && exit 0',
  'exec head -c "$limit" -- "$real"'
].join('\n')

const WSL_READ_ERRORS: Record<number, string> = {
  10: 'Session folder not found.',
  11: 'File not found.',
  12: 'File is outside the session folder.',
  13: 'Not a file.',
  14: 'Could not read file.'
}

function isBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)
}

function fileResponse(path: string, size: number, bytes: Buffer | null): FileReadResponse {
  if (bytes === null || size > MAX_FILE_VIEW_BYTES || bytes.length > MAX_FILE_VIEW_BYTES) {
    return { path, content: null, size, binary: false, tooLarge: true }
  }
  if (isBinary(bytes)) return { path, content: null, size, binary: true, tooLarge: false }
  // TextDecoder drops a UTF-8 byte order mark by default.
  const content = new TextDecoder('utf-8').decode(bytes)
  return { path, content, size, binary: false, tooLarge: false }
}

async function readWslFile(
  session: Session,
  relativePath: string,
  deps: FileTreeDependencies
): Promise<FileReadResponse> {
  const { distro, root } = await wslRoot(session, deps)
  const result = await deps.runWslBuffer(distro, [
    'bash',
    '-c',
    READ_WSL_FILE_SCRIPT,
    'mde-read',
    root,
    joinWslPath(root, relativePath),
    String(MAX_FILE_VIEW_BYTES)
  ])
  if (result.code !== 0) {
    throw new Error(WSL_READ_ERRORS[result.code] ?? 'Could not read file.')
  }

  const newline = result.stdout.indexOf(0x0a)
  const size = newline === -1 ? Number.NaN : Number(result.stdout.subarray(0, newline).toString('ascii'))
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('Could not read file.')
  return fileResponse(
    relativePath,
    size,
    size > MAX_FILE_VIEW_BYTES ? null : result.stdout.subarray(newline + 1)
  )
}

function isInside(root: string, target: string): boolean {
  const prefix = root.endsWith(sep) ? root : root + sep
  return target.startsWith(prefix)
}

async function readNativeFile(session: Session, relativePath: string): Promise<FileReadResponse> {
  let handle: fs.FileHandle | null = null
  try {
    const realRoot = await fs.realpath(session.path)
    const real = await fs.realpath(join(session.path, ...relativePath.split('/')))
    if (!isInside(realRoot, real)) throw new Error('File is outside the session folder.')

    handle = await fs.open(real, 'r')
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error('Not a file.')
    if (stat.size > MAX_FILE_VIEW_BYTES) return fileResponse(relativePath, stat.size, null)

    // One byte past the limit detects a file that grew since the stat.
    const buffer = Buffer.alloc(MAX_FILE_VIEW_BYTES + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length)
      if (bytesRead === 0) break
      length += bytesRead
    }
    return fileResponse(relativePath, Math.max(stat.size, length), buffer.subarray(0, length))
  } catch (error) {
    if (error instanceof Error && !('code' in error)) throw error
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') throw new Error('File not found.')
    if (code === 'EISDIR') throw new Error('Not a file.')
    if (code === 'EACCES' || code === 'EPERM') throw new Error('Permission denied.')
    throw new Error('Could not read file.')
  } finally {
    await handle?.close()
  }
}

/** Reads one file for the viewer, named relative to the session root. */
export async function readSessionFile(
  session: Session,
  relativePath: string,
  platform: NodeJS.Platform = process.platform,
  deps: FileTreeDependencies = defaultDependencies
): Promise<FileReadResponse> {
  if (!relativePath || !isSafeRelativePath(relativePath)) throw new Error('Invalid file path.')

  if (session.kind === 'wsl') {
    if (platform !== 'win32') throw new Error('WSL sessions can only be read on Windows.')
    return readWslFile(session, relativePath, deps)
  }
  return readNativeFile(session, relativePath)
}
