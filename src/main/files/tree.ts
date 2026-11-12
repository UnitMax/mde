import { promises as fs } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import { readContainedFile } from './read'
import type {
  FileReadResponse,
  FileTreeEntry,
  FileTreeEntryKind,
  FileTreeListResponse,
  DirectoryContext
} from '@shared/types'
import {
  runWslCommand,
  runWslCommandBuffer,
  type WslBufferResult,
  type WslResult
} from '../wsl/distros'
import { isPlainAbsolutePath } from '../wsl/paths'

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
    runWslCommandBuffer(distro, command, { maxBuffer: MAX_FILE_VIEW_BYTES + 64 * 1024 })
}

function joinWslPath(root: string, relativePath: string): string {
  if (!relativePath) return root
  const base = root.replace(/\/+$/, '')
  return `${base}/${relativePath}`
}

function wslRoot(
  session: DirectoryContext
): { distro: string; root: string } {
  const distro = session.distro
  if (!distro) throw new Error('This WSL session has no distro configured.')

  const root = session.path
  if (!isPlainAbsolutePath(root)) throw new Error('Folder not found.')
  return { distro, root }
}

async function listWslDirectory(
  session: DirectoryContext,
  relativePath: string,
  deps: FileTreeDependencies
): Promise<FileTreeListResponse> {
  const { distro, root } = wslRoot(session)

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
  session: DirectoryContext,
  relativePath: string,
  deps: FileTreeDependencies
): Promise<FileTreeListResponse> {
  const directory = relativePath ? join(session.path, ...relativePath.split('/')) : session.path
  try {
    return finishListing(relativePath, await deps.readNativeDirectory(directory))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') throw new Error('Folder not found.')
    if (code === 'ENOTDIR') throw new Error('Not a folder.')
    if (code === 'EACCES' || code === 'EPERM') throw new Error('Permission denied.')
    throw new Error('Could not list folder.')
  }
}

/** The absolute path of a folder the tree names relative to its root. Check the name with `isSafeRelativePath` first. */
export function treeFolderPath(session: DirectoryContext, relativePath: string): string {
  if (session.kind === 'wsl') return joinWslPath(session.path, relativePath)
  return relativePath ? join(session.path, ...relativePath.split('/')) : session.path
}

/**
 * True when `path` is `root` or a folder below it. Both must already be resolved (realpath), so a symlinked
 * folder that points elsewhere fails the check. WSL paths are POSIX; native ones use the host's path rules.
 */
export function isWithinRoot(kind: DirectoryContext['kind'], root: string, path: string): boolean {
  if (kind === 'wsl') {
    const base = root.replace(/\/+$/, '')
    return path === root || path === base || path.startsWith(`${base}/`)
  }
  const rest = relative(root, path)
  return rest === '' || (rest !== '..' && !rest.startsWith(`..${sep}`) && !isAbsolute(rest))
}

/** Lists one directory relative to a runtime filesystem root. */
export async function listSessionDirectory(
  session: DirectoryContext,
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
  'exec 3< "$real" || exit 11',
  'opened=$(readlink -f -- /proc/self/fd/3) || exit 11',
  'case "$opened" in "${real_root%/}"/*) ;; *) exit 12 ;; esac',
  '[ -f /proc/self/fd/3 ] || exit 13',
  'size=$(stat -L -c %s -- /proc/self/fd/3) || exit 14',
  'printf "%s\\n" "$size"',
  '[ "$size" -gt "$limit" ] && exit 0',
  'exec head -c "$limit" <&3'
].join('\n')

const WSL_READ_ERRORS: Record<number, string> = {
  10: 'Folder not found.',
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
  session: DirectoryContext,
  relativePath: string,
  deps: FileTreeDependencies
): Promise<FileReadResponse> {
  const { distro, root } = wslRoot(session)
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

async function readNativeFile(session: DirectoryContext, relativePath: string): Promise<FileReadResponse> {
  try {
    const { size, bytes } = await readContainedFile(session.path, relativePath, MAX_FILE_VIEW_BYTES)
    return fileResponse(relativePath, size, bytes)
  } catch (error) {
    if (error instanceof Error && !('code' in error)) throw error
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') throw new Error('File not found.')
    if (code === 'EISDIR') throw new Error('Not a file.')
    if (code === 'EACCES' || code === 'EPERM') throw new Error('Permission denied.')
    throw new Error('Could not read file.')
  }
}

/** Reads one file for the viewer, named relative to a runtime filesystem root. */
export async function readSessionFile(
  session: DirectoryContext,
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

/** Reads a binary attachment with the viewer's same root containment checks. */
export async function readSessionAttachment(session: DirectoryContext, path: string): Promise<Buffer> {
  const limit = 20 * 1024 * 1024
  if (!path || !isSafeRelativePath(path)) throw new Error('Invalid attachment path.')
  if (session.kind === 'wsl') {
    if (process.platform !== 'win32') throw new Error('WSL files require Windows.')
    const { distro, root } = wslRoot(session)
    const result = await runWslCommandBuffer(distro, ['bash', '-c', READ_WSL_FILE_SCRIPT, 'mde-attach', root, joinWslPath(root, path), String(limit + 1)], { maxBuffer: limit + 64 * 1024 })
    if (result.code !== 0) throw new Error(WSL_READ_ERRORS[result.code] ?? 'Could not read attachment.')
    const newline = result.stdout.indexOf(10)
    const size = Number(result.stdout.subarray(0, newline).toString('ascii'))
    const bytes = result.stdout.subarray(newline + 1)
    if (newline < 0 || !Number.isSafeInteger(size) || size < 0 || size > limit || bytes.length !== size) throw new Error('Attachment exceeds 20 MiB or changed while reading.')
    return bytes
  }
  const { size, bytes } = await readContainedFile(session.path, path, limit)
  if (!bytes || size > limit) throw new Error('Choose a regular file of at most 20 MiB.')
  return bytes
}
