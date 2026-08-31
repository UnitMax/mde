import { execFile } from 'node:child_process'
import { realpath, stat } from 'node:fs/promises'
import { win32 } from 'node:path'

const GIT_LOOKUP_TIMEOUT_MS = 5_000
const GIT_LOOKUP_MAX_BUFFER = 64 * 1024
const gitExecutableNames = ['git.exe', 'git.com']

interface GitExecutableCandidate {
  discoveredPath: string
  executablePath: string
}

interface FileStats {
  isFile(): boolean
}

export interface WindowsGitResolverDependencies {
  environment?: NodeJS.ProcessEnv
  processExecutable?: string
  runWhere?: (whereExecutable: string, name: string, cwd: string) => Promise<string>
  canonicalize?: (path: string) => Promise<string>
  readStats?: (path: string) => Promise<FileStats>
}

function environmentValue(environment: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(environment).find((candidate) => candidate.toLowerCase() === name.toLowerCase())
  return key ? environment[key] : undefined
}

function assertAbsoluteWindowsPath(path: string, label: string): string {
  if (!win32.isAbsolute(path)) throw new Error(`${label} must be an absolute Windows path.`)
  return win32.normalize(path)
}

function sameOrDescendant(parent: string, candidate: string): boolean {
  const relative = win32.relative(parent.toLowerCase(), candidate.toLowerCase())
  return relative === ''
    || (relative !== '..' && !relative.startsWith(`..${win32.sep}`) && !win32.isAbsolute(relative))
}

function isGitExecutablePath(path: string): boolean {
  return gitExecutableNames.includes(win32.basename(path).toLowerCase())
}

function defaultRunWhere(whereExecutable: string, name: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      whereExecutable,
      [name],
      {
        cwd,
        encoding: 'utf8',
        timeout: GIT_LOOKUP_TIMEOUT_MS,
        maxBuffer: GIT_LOOKUP_MAX_BUFFER,
        windowsHide: true
      },
      (error, stdout) => {
        const result = error as (NodeJS.ErrnoException & { code?: number | string }) | null
        if (result && typeof result.code !== 'number') {
          reject(result)
          return
        }
        resolve(String(stdout))
      }
    )
  })
}

async function discoverWindowsGitExecutables(
  dependencies: WindowsGitResolverDependencies
): Promise<GitExecutableCandidate[]> {
  const environment = dependencies.environment ?? process.env
  const systemRoot = environmentValue(environment, 'SystemRoot')
  if (!systemRoot) throw new Error('Windows SystemRoot is unavailable for trusted Git lookup.')

  const whereExecutable = win32.join(
    assertAbsoluteWindowsPath(systemRoot, 'Windows SystemRoot'),
    'System32',
    'where.exe'
  )
  const processExecutable = dependencies.processExecutable ?? process.execPath
  const trustedCwd = win32.dirname(
    assertAbsoluteWindowsPath(processExecutable, 'Application executable')
  )
  const runWhere = dependencies.runWhere ?? defaultRunWhere
  const canonicalize = dependencies.canonicalize ?? realpath
  const readStats = dependencies.readStats ?? stat
  const outputs = await Promise.all(
    gitExecutableNames.map((name) => runWhere(whereExecutable, name, trustedCwd))
  )
  const discoveredPaths = outputs
    .flatMap((output) => output.split(/\r?\n/))
    .map((path) => path.trim())
    .filter(Boolean)
  const candidates: GitExecutableCandidate[] = []
  const seen = new Set<string>()

  for (const discoveredPath of discoveredPaths) {
    if (!win32.isAbsolute(discoveredPath) || !isGitExecutablePath(discoveredPath)) continue

    try {
      const executablePath = assertAbsoluteWindowsPath(
        await canonicalize(discoveredPath),
        'Resolved Git executable'
      )
      if (!isGitExecutablePath(executablePath)) continue
      if (!(await readStats(executablePath)).isFile()) continue

      const key = executablePath.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      candidates.push({
        discoveredPath: win32.normalize(discoveredPath),
        executablePath
      })
    } catch {
      // Ignore stale or inaccessible PATH entries and continue to the next candidate.
    }
  }

  if (candidates.length === 0) throw new Error('Could not find a trusted Git executable.')
  return candidates
}

export function createWindowsGitExecutableResolver(
  dependencies: WindowsGitResolverDependencies = {}
): (workspaceDirectory: string) => Promise<string> {
  let candidatesPromise: Promise<GitExecutableCandidate[]> | null = null
  const canonicalize = dependencies.canonicalize ?? realpath

  return async (workspaceDirectory: string): Promise<string> => {
    const workspace = assertAbsoluteWindowsPath(workspaceDirectory, 'Native workspace')
    const canonicalWorkspace = assertAbsoluteWindowsPath(
      await canonicalize(workspace),
      'Native workspace'
    )
    candidatesPromise ??= discoverWindowsGitExecutables(dependencies)
    const candidates = await candidatesPromise
    const candidate = candidates.find((value) => (
      !sameOrDescendant(workspace, value.discoveredPath)
      && !sameOrDescendant(canonicalWorkspace, value.executablePath)
    ))

    if (!candidate) {
      throw new Error('Refusing to run a Git executable from inside the active workspace.')
    }
    return candidate.executablePath
  }
}

export const resolveWindowsGitExecutable = createWindowsGitExecutableResolver()
