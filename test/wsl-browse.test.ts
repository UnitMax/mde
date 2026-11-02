import { describe, expect, it, vi } from 'vitest'
import { MAX_BROWSE_DIRECTORIES, listWslDirectories, type WslBrowseDependencies } from '../src/main/wsl/browse'

function found(...lines: string[]): { stdout: string; stderr: string; code: number } {
  return { stdout: lines.map((line) => `${line}\n`).join(''), stderr: '', code: 0 }
}

function deps(overrides: Partial<WslBrowseDependencies> = {}): WslBrowseDependencies {
  return {
    runWsl: vi.fn(async () => found()),
    home: vi.fn(async () => '/home/me'),
    ...overrides,
  }
}

const FIND = ['find', '-L', '/home/me', '-mindepth', '1', '-maxdepth', '1', '-printf', '%y\\t%f\\n']

describe('listWslDirectories', () => {
  it('lists the folders of the distro home when no path is given', async () => {
    const dependencies = deps({
      runWsl: vi.fn(async () => found('d\tsrc', 'f\tnotes.txt', 'd\tdocs', 'd\tApps')),
    })

    const listing = await listWslDirectories({ distro: 'Ubuntu-24.04' }, 'win32', dependencies)

    expect(listing).toEqual({ path: '/home/me', directories: ['Apps', 'docs', 'src'], truncated: false })
    expect(dependencies.home).toHaveBeenCalledWith('Ubuntu-24.04')
    expect(dependencies.runWsl).toHaveBeenCalledWith('Ubuntu-24.04', FIND)
  })

  it('lists exactly the folder asked for, without asking for the home directory', async () => {
    const dependencies = deps({ runWsl: vi.fn(async () => found('d\tapi')) })

    const listing = await listWslDirectories({ distro: 'Ubuntu', path: '/srv/projects/' }, 'win32', dependencies)

    expect(listing.path).toBe('/srv/projects')
    expect(dependencies.home).not.toHaveBeenCalled()
    expect(dependencies.runWsl).toHaveBeenCalledWith('Ubuntu', [
      'find', '-L', '/srv/projects', '-mindepth', '1', '-maxdepth', '1', '-printf', '%y\\t%f\\n',
    ])
  })

  it('keeps the root as /', async () => {
    const dependencies = deps({ runWsl: vi.fn(async () => found('d\thome', 'd\tetc')) })

    const listing = await listWslDirectories({ distro: 'Ubuntu', path: '//' }, 'win32', dependencies)

    expect(listing).toEqual({ path: '/', directories: ['etc', 'home'], truncated: false })
  })

  it('treats a symlink to a folder as a folder and leaves out files and other entries', async () => {
    // With -L, find reports the type of the link target; only a broken link stays an 'l'.
    const dependencies = deps({
      runWsl: vi.fn(async () => found('d\tlinked-project', 'l\tbroken', 'f\tfile', 'p\tpipe', 's\tsocket')),
    })

    const listing = await listWslDirectories({ distro: 'Ubuntu' }, 'win32', dependencies)

    expect(listing.directories).toEqual(['linked-project'])
  })

  it('hides dot folders unless they are asked for', async () => {
    const dependencies = deps({ runWsl: vi.fn(async () => found('d\t.config', 'd\t.git', 'd\tsrc')) })

    expect((await listWslDirectories({ distro: 'Ubuntu' }, 'win32', dependencies)).directories).toEqual(['src'])
    expect((await listWslDirectories({ distro: 'Ubuntu', hidden: true }, 'win32', dependencies)).directories)
      .toEqual(['.config', '.git', 'src'])
  })

  it('sorts numbers the way people read them', async () => {
    const dependencies = deps({ runWsl: vi.fn(async () => found('d\tproject10', 'd\tproject2', 'd\tProject1')) })

    expect((await listWslDirectories({ distro: 'Ubuntu' }, 'win32', dependencies)).directories)
      .toEqual(['Project1', 'project2', 'project10'])
  })

  it('keeps spaces and non-ASCII letters in names', async () => {
    const dependencies = deps({ runWsl: vi.fn(async () => found('d\tmy project', 'd\tÜbung')) })

    expect((await listWslDirectories({ distro: 'Ubuntu' }, 'win32', dependencies)).directories)
      .toEqual(['my project', 'Übung'])
  })

  it('leaves out folders it could not open again, because their names are not plain path text', async () => {
    const dependencies = deps({ runWsl: vi.fn(async () => found('d\tok', 'd\tback\\slash', 'd\tbell\u0007')) })

    expect((await listWslDirectories({ distro: 'Ubuntu' }, 'win32', dependencies)).directories).toEqual(['ok'])
  })

  it('cuts a very long listing off and says so', async () => {
    const lines = Array.from({ length: MAX_BROWSE_DIRECTORIES + 5 }, (_, index) => `d\tfolder-${String(index).padStart(5, '0')}`)
    const dependencies = deps({ runWsl: vi.fn(async () => found(...lines)) })

    const listing = await listWslDirectories({ distro: 'Ubuntu' }, 'win32', dependencies)

    expect(listing.directories).toHaveLength(MAX_BROWSE_DIRECTORIES)
    expect(listing.truncated).toBe(true)
  })

  it('starts at the root when the home directory cannot be used as a plain path', async () => {
    const dependencies = deps({
      home: vi.fn(async () => '/home/odd\\name'),
      runWsl: vi.fn(async () => found('d\tetc')),
    })

    const listing = await listWslDirectories({ distro: 'Ubuntu' }, 'win32', dependencies)

    expect(listing.path).toBe('/')
    expect(dependencies.runWsl).toHaveBeenCalledWith('Ubuntu', expect.arrayContaining(['/']))
  })

  it.each([
    'relative/path',
    '~',
    '~/src',
    'C:\\Users\\Me',
    '\\\\wsl.localhost\\Ubuntu\\home\\me',
    '/home/me/../you',
    '/home/me/./src',
    '/home/me\\src',
    '/home/me\nsrc',
  ])('refuses %j without running anything', async (path) => {
    const dependencies = deps()

    await expect(listWslDirectories({ distro: 'Ubuntu', path }, 'win32', dependencies)).rejects.toThrow('Invalid folder path.')
    expect(dependencies.runWsl).not.toHaveBeenCalled()
  })

  it('refuses outside Windows without running anything', async () => {
    const dependencies = deps()

    await expect(listWslDirectories({ distro: 'Ubuntu' }, 'darwin', dependencies)).rejects.toThrow('only be browsed on Windows')
    await expect(listWslDirectories({ distro: 'Ubuntu' }, 'linux', dependencies)).rejects.toThrow('only be browsed on Windows')
    expect(dependencies.runWsl).not.toHaveBeenCalled()
    expect(dependencies.home).not.toHaveBeenCalled()
  })

  it('shows an empty folder as empty, not as an error', async () => {
    const runWsl = vi.fn()
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 })

    const listing = await listWslDirectories({ distro: 'Ubuntu', path: '/home/me/empty' }, 'win32', deps({ runWsl }))

    expect(listing).toEqual({ path: '/home/me/empty', directories: [], truncated: false })
    expect(runWsl).toHaveBeenLastCalledWith('Ubuntu', ['test', '-d', '/home/me/empty'])
  })

  it('does not check again when the folder holds only files', async () => {
    const runWsl = vi.fn(async () => found('f\ta.txt'))

    const listing = await listWslDirectories({ distro: 'Ubuntu', path: '/home/me/docs' }, 'win32', deps({ runWsl }))

    expect(listing.directories).toEqual([])
    expect(runWsl).toHaveBeenCalledTimes(1)
  })

  it('says so when the path is a file', async () => {
    const runWsl = vi.fn()
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 1 })

    await expect(listWslDirectories({ distro: 'Ubuntu', path: '/etc/hostname' }, 'win32', deps({ runWsl })))
      .rejects.toThrow('That is not a folder.')
  })

  it.each([
    ["find: ‘/nope’: No such file or directory", 'That folder does not exist.'],
    ["find: ‘/root’: Permission denied", 'Permission denied.'],
    ["find: ‘/etc/passwd/x’: Not a directory", 'That is not a folder.'],
    ['There is no distribution with the supplied name.', 'Could not list the folder: There is no distribution with the supplied name.'],
  ])('turns the failure %j into a plain message', async (stderr, message) => {
    const runWsl = vi.fn(async () => ({ stdout: '', stderr, code: 1 }))

    await expect(listWslDirectories({ distro: 'Ubuntu', path: '/nope' }, 'win32', deps({ runWsl }))).rejects.toThrow(message)
  })

  it('reports a failure without detail as a failure', async () => {
    const runWsl = vi.fn(async () => ({ stdout: '', stderr: '', code: 1 }))

    await expect(listWslDirectories({ distro: 'Ubuntu', path: '/nope' }, 'win32', deps({ runWsl }))).rejects.toThrow('Could not list the folder.')
  })

  it('still lists what it found when find could not examine some entry', async () => {
    const runWsl = vi.fn(async () => ({ stdout: 'd\tsrc\n', stderr: 'find: ‘x’: Permission denied', code: 1 }))

    const listing = await listWslDirectories({ distro: 'Ubuntu' }, 'win32', deps({ runWsl }))

    expect(listing.directories).toEqual(['src'])
  })
})
