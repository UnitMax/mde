import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FileTreeEntry, Session } from '../src/shared/types'
import {
  MAX_FILE_TREE_ENTRIES,
  isSafeRelativePath,
  listSessionDirectory,
  parseFindOutput,
  sortFileTreeEntries,
  type FileTreeDependencies
} from '../src/main/files/tree'
import {
  childPath,
  parentPath,
  visibleFileTreeRows,
  type FileTreeDirectoryState
} from '../src/renderer/lib/file-tree'

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    projectId: 'project-1',
    name: 'App',
    kind: 'native',
    path: '/home/me/app',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function deps(overrides: Partial<FileTreeDependencies> = {}): FileTreeDependencies {
  return {
    readNativeDirectory: vi.fn(async () => []),
    runWsl: vi.fn(async () => ({ stdout: '', stderr: '', code: 0 })),
    resolveWslPath: vi.fn(async (_distro: string, path: string) => path),
    ...overrides
  }
}

describe('isSafeRelativePath', () => {
  it('accepts the root and nested relative directories', () => {
    expect(isSafeRelativePath('')).toBe(true)
    expect(isSafeRelativePath('src')).toBe(true)
    expect(isSafeRelativePath('src/lib/.hidden dir')).toBe(true)
  })

  it('rejects paths that could leave the session root', () => {
    for (const path of ['..', 'src/..', './src', '/etc', 'a\\b', 'a//b', 'src/', 'a\u0000b', 'a\nb']) {
      expect(isSafeRelativePath(path), path).toBe(false)
    }
  })
})

describe('file tree listing helpers', () => {
  it('parses find output, keeping tabs inside names and dropping malformed lines', () => {
    expect(parseFindOutput('d\tsrc\nf\tREADME.md\nl\tlink\np\tfifo\nf\ta\tb\n\ngarbage\nfd\tbad\n')).toEqual([
      { name: 'src', kind: 'directory' },
      { name: 'README.md', kind: 'file' },
      { name: 'link', kind: 'symlink' },
      { name: 'fifo', kind: 'other' },
      { name: 'a\tb', kind: 'file' }
    ])
  })

  it('sorts directories first, then names naturally and case-insensitively', () => {
    const entries: FileTreeEntry[] = [
      { name: 'b.txt', kind: 'file' },
      { name: 'file10', kind: 'file' },
      { name: 'Zeta', kind: 'directory' },
      { name: 'file2', kind: 'file' },
      { name: 'alpha', kind: 'directory' },
      { name: 'A.txt', kind: 'file' }
    ]
    expect(sortFileTreeEntries(entries).map((entry) => entry.name)).toEqual([
      'alpha',
      'Zeta',
      'A.txt',
      'b.txt',
      'file2',
      'file10'
    ])
  })

  it('hides .git and truncates oversized directories', async () => {
    const many = Array.from({ length: MAX_FILE_TREE_ENTRIES + 5 }, (_, index) => ({
      name: `file-${index}`,
      kind: 'file' as const
    }))
    const readNativeDirectory = vi.fn(async () => [{ name: '.git', kind: 'directory' as const }, ...many])

    const result = await listSessionDirectory(session(), '', 'linux', deps({ readNativeDirectory }))

    expect(result.truncated).toBe(true)
    expect(result.entries).toHaveLength(MAX_FILE_TREE_ENTRIES)
    expect(result.entries.some((entry) => entry.name === '.git')).toBe(false)
  })

  it('refuses unsafe relative paths before touching the filesystem', async () => {
    const dependencies = deps()
    await expect(listSessionDirectory(session(), '../etc', 'linux', dependencies)).rejects.toThrow(
      'Invalid folder path.'
    )
    expect(dependencies.readNativeDirectory).not.toHaveBeenCalled()
  })
})

describe('native file tree listing', () => {
  let root: string | null = null

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
    root = null
  })

  it('lists one directory level and reports symlinks without following them', async () => {
    root = await mkdtemp(join(tmpdir(), 'mde-file-tree-'))
    await mkdir(join(root, 'src', 'lib'), { recursive: true })
    await mkdir(join(root, '.git'))
    await writeFile(join(root, 'README.md'), '')
    await writeFile(join(root, 'src', 'index.ts'), '')
    await symlink(join(root, 'src'), join(root, 'linked-src'))

    const top = await listSessionDirectory(session({ path: root }), '')
    expect(top).toEqual({
      path: '',
      entries: [
        { name: 'src', kind: 'directory' },
        { name: 'linked-src', kind: 'symlink' },
        { name: 'README.md', kind: 'file' }
      ],
      truncated: false
    })

    const nested = await listSessionDirectory(session({ path: root }), 'src')
    expect(nested.entries).toEqual([
      { name: 'lib', kind: 'directory' },
      { name: 'index.ts', kind: 'file' }
    ])
  })

  it('reports a missing session folder readably', async () => {
    root = await mkdtemp(join(tmpdir(), 'mde-file-tree-'))
    await expect(listSessionDirectory(session({ path: join(root, 'missing') }), '')).rejects.toThrow(
      'Session folder not found.'
    )
  })
})

describe('WSL file tree listing', () => {
  const wsl = (overrides: Partial<Session> = {}): Session =>
    session({ kind: 'wsl', distro: 'Ubuntu-24.04', path: '/home/me/app', ...overrides })

  it('runs find directly inside the distro against the joined directory', async () => {
    const runWsl = vi.fn(async () => ({ stdout: 'f\tindex.ts\nd\tlib\n', stderr: '', code: 0 }))
    const dependencies = deps({ runWsl })

    const result = await listSessionDirectory(wsl(), 'src/my dir', 'win32', dependencies)

    expect(runWsl).toHaveBeenCalledWith('Ubuntu-24.04', [
      'find',
      '-H',
      '/home/me/app/src/my dir',
      '-mindepth',
      '1',
      '-maxdepth',
      '1',
      '-printf',
      '%y\\t%f\\n'
    ])
    expect(dependencies.resolveWslPath).not.toHaveBeenCalled()
    expect(result.entries).toEqual([
      { name: 'lib', kind: 'directory' },
      { name: 'index.ts', kind: 'file' }
    ])
  })

  it('normalizes a shorthand session path and rejects a non-absolute result', async () => {
    const runWsl = vi.fn(async (_distro: string, _command: readonly string[]) => ({ stdout: '', stderr: '', code: 0 }))
    const resolveWslPath = vi.fn(async () => '/home/me/app')
    await listSessionDirectory(wsl({ path: '~/app' }), '', 'win32', deps({ runWsl, resolveWslPath }))
    expect(resolveWslPath).toHaveBeenCalledWith('Ubuntu-24.04', '~/app')
    expect(runWsl.mock.calls[0]?.[1][2]).toBe('/home/me/app')

    await expect(
      listSessionDirectory(wsl({ path: '~/gone' }), '', 'win32', deps({ resolveWslPath: vi.fn(async () => '~/gone') }))
    ).rejects.toThrow('Session folder not found.')
  })

  it('surfaces find errors and refuses to run off Windows', async () => {
    const runWsl = vi.fn(async () => ({
      stdout: '',
      stderr: "find: '/home/me/app/nope': No such file or directory\n",
      code: 1
    }))
    await expect(listSessionDirectory(wsl(), 'nope', 'win32', deps({ runWsl }))).rejects.toThrow(
      "Could not list folder: find: '/home/me/app/nope': No such file or directory"
    )
    await expect(listSessionDirectory(wsl(), '', 'linux', deps())).rejects.toThrow(
      'WSL sessions can only be listed on Windows.'
    )
  })
})

describe('renderer file tree rows', () => {
  it('joins and splits relative paths', () => {
    expect(childPath('', 'src')).toBe('src')
    expect(childPath('src', 'lib')).toBe('src/lib')
    expect(parentPath('src/lib')).toBe('src')
    expect(parentPath('src')).toBeNull()
  })

  it('flattens expanded directories and shows status rows', () => {
    const cache = new Map<string, FileTreeDirectoryState>([
      ['', {
        status: 'ready',
        entries: [
          { name: 'src', kind: 'directory' },
          { name: 'docs', kind: 'directory' },
          { name: 'empty', kind: 'directory' },
          { name: 'README.md', kind: 'file' }
        ],
        truncated: true
      }],
      ['src', { status: 'ready', entries: [{ name: 'lib', kind: 'directory' }], truncated: false }],
      ['src/lib', { status: 'loading' }],
      ['docs', { status: 'ready', entries: [{ name: 'hidden.md', kind: 'file' }], truncated: false }],
      ['empty', { status: 'ready', entries: [], truncated: false }]
    ])

    const rows = visibleFileTreeRows(cache, new Set(['src', 'src/lib', 'empty']))

    expect(rows.map((row) => [row.type, row.path, row.depth])).toEqual([
      ['entry', 'src', 0],
      ['entry', 'src/lib', 1],
      ['loading', 'src/lib', 2],
      ['entry', 'docs', 0],
      ['entry', 'empty', 0],
      ['empty', 'empty', 1],
      ['entry', 'README.md', 0],
      ['truncated', '', 0]
    ])
  })

  it('shows root loading and error states', () => {
    expect(visibleFileTreeRows(new Map(), new Set())).toEqual([{ type: 'loading', path: '', depth: 0 }])
    expect(visibleFileTreeRows(new Map([['', { status: 'error', error: 'Nope' }]]), new Set())).toEqual([
      { type: 'error', path: '', depth: 0, message: 'Nope' }
    ])
  })
})
