import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { posix } from 'node:path'
import { nativeOpenCodeConfigDirectory } from '../../native-environment'
import { writeTextAtomic } from '../../store/atomic-json'
import { assertWslLinuxPath, readWslShellValue, type WslValueResult } from '../../wsl/shell-value'
import { canonicalizeWslPath, uncPathFor } from '../../wsl/paths'

/**
 * Where OpenCode reads its global configuration from, as OpenCode itself works it out. The expression is shell
 * source run in the distro's login shell; `OPENCODE_CONFIG_DIR` wins over `XDG_CONFIG_HOME`.
 */
export const WSL_CONFIG_DIRECTORY_EXPRESSION = '"${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}"'

/**
 * The few file operations the configuration editor needs, on the machine OpenCode runs on. Every path is an
 * absolute POSIX path there; main builds them, the renderer never names one.
 */
export interface ConfigFileSystem {
  directory(): Promise<string>
  /** The home directory, for showing paths as `~/...`; null when it cannot be told. */
  home(): Promise<string | null>
  /** Null when nothing is there. */
  stat(path: string): Promise<{ size: number; mode: number } | null>
  readText(path: string): Promise<string>
  /** The path with symbolic links resolved, so a file managed by dotfiles is edited in place and not replaced. */
  realpath(path: string): Promise<string>
  writeText(path: string, text: string, mode: number): Promise<void>
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

async function statFile(path: string): Promise<{ size: number; mode: number } | null> {
  try {
    const stat = await fs.stat(path)
    if (!stat.isFile()) throw new Error(`${posix.basename(path)} is not a regular file.`)
    return { size: stat.size, mode: stat.mode & 0o777 }
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
}

export function nativeConfigFileSystem(
  directory: () => Promise<string> = nativeOpenCodeConfigDirectory,
  home: () => string = homedir,
): ConfigFileSystem {
  return {
    directory,
    home: async () => home(),
    stat: statFile,
    readText: (path) => fs.readFile(path, 'utf8'),
    realpath: async (path) => {
      try {
        return await fs.realpath(path)
      } catch (error) {
        if (!isMissing(error)) throw error
        // Not there yet: the file will be created in the real directory, which may itself be a link.
        const directory = await fs.realpath(posix.dirname(path)).catch(() => posix.dirname(path))
        return posix.join(directory, posix.basename(path))
      }
    },
    writeText: writeTextAtomic,
  }
}

export interface WslConfigDependencies {
  readValue(distro: string, expression: string): Promise<WslValueResult>
  canonicalize(distro: string, path: string): Promise<string | null>
}

const wslDefaults: WslConfigDependencies = { readValue: readWslShellValue, canonicalize: canonicalizeWslPath }

/**
 * Files inside a WSL distro, reached as `\\wsl.localhost\<distro>\...` from Windows. Only the lookups that need
 * the distro's own view (its environment, its symbolic links) go through `wsl.exe`.
 */
export function wslConfigFileSystem(distro: string, deps: WslConfigDependencies = wslDefaults): ConfigFileSystem {
  const unc = (path: string): string => uncPathFor(distro, path)
  return {
    directory: async () => {
      const result = await deps.readValue(distro, WSL_CONFIG_DIRECTORY_EXPRESSION)
      if (!result.value?.trim()) throw new Error(`Could not find OpenCode's configuration folder in ${distro} (${result.detail}).`)
      return assertWslLinuxPath(result.value, 'OpenCode configuration folder')
    },
    home: async () => {
      try {
        const result = await deps.readValue(distro, '"$HOME"')
        return result.value?.trim() ? assertWslLinuxPath(result.value, 'home folder') : null
      } catch {
        return null
      }
    },
    stat: (path) => statFile(unc(path)),
    readText: (path) => fs.readFile(unc(path), 'utf8'),
    realpath: async (path) => {
      const resolved = await deps.canonicalize(distro, path)
      if (resolved && resolved !== path) return resolved
      // Either the file is not a link or it is not there yet; in the second case its folder may be a link.
      const directory = posix.dirname(path)
      const resolvedDirectory = (await deps.canonicalize(distro, directory)) ?? directory
      return posix.join(resolvedDirectory, posix.basename(path))
    },
    writeText: (path, text, mode) => writeTextAtomic(unc(path), text, mode),
  }
}
