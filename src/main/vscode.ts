import { spawn } from 'node:child_process'
import type { Session } from '@shared/types'

export interface VsCodeLaunchSpec {
  file: string
  args: string[]
}

/**
 * Builds the Windows VS Code CLI invocation for a WSL session.
 *
 * The path intentionally stays in Linux format. VS Code's Remote - WSL CLI
 * uses the distro authority to resolve it inside WSL; converting it to a
 * Windows/UNC path would open the folder as a local filesystem path instead.
 */
export function buildVsCodeLaunchSpec(
  session: Session,
  platform: NodeJS.Platform
): VsCodeLaunchSpec {
  if (platform !== 'win32') {
    throw new Error('Opening WSL sessions in Windows VS Code is only supported on Windows')
  }
  if (session.kind !== 'wsl') {
    throw new Error('Only WSL sessions can be opened in Windows VS Code')
  }
  if (!session.distro) {
    throw new Error(`WSL session "${session.name}" has no distro`)
  }

  const path = session.path.trim()
  if (!path) {
    throw new Error(`WSL session "${session.name}" has no project path`)
  }

  // VS Code treats a path with a file-like extension as a file. The trailing
  // slash makes the intent unambiguous for dotted project directories.
  const folderPath = path.endsWith('/') ? path : `${path}/`

  return {
    // Windows resolves this through the VS Code code.cmd launcher on PATH.
    file: 'code',
    args: ['--remote', `wsl+${session.distro}`, folderPath]
  }
}

/** Starts the detached Windows VS Code CLI and rejects if it cannot launch. */
export function launchVsCodeSession(session: Session, platform: NodeJS.Platform): Promise<void> {
  const spec = buildVsCodeLaunchSpec(session, platform)
  // The Windows VS Code CLI is normally a .cmd launcher. Running it through
  // cmd.exe lets Windows resolve code.cmd/code.exe from PATH. Environment
  // variables keep user-controlled distro/path text out of the shell command.
  const [, remote, folderPath] = spec.args
  const command = `${spec.file} --remote "%MDE_VSCODE_REMOTE%" "%MDE_VSCODE_PATH%"`
  const child = spawn('cmd.exe', ['/d', '/s', '/c', command], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: {
      ...process.env,
      MDE_VSCODE_REMOTE: remote,
      MDE_VSCODE_PATH: folderPath
    }
  })

  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('spawn', () => child.unref())
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`VS Code CLI exited with ${signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`}`))
    })
  })
}
