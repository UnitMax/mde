import type { OpenCodeTarget } from '@shared/types'
import type { InboxChatService } from '../inbox/chat'
import type { InboxStore } from '../inbox/store'
import { serviceTargetKey } from '../opencode/service/discovery'
import { bridgeCommand } from './bridge'
import { ensureMcpToken, mcpEndpoint } from './endpoint'
import { McpListener } from './listener'
import { MdeMcpTools } from './tools'

export { isMcpBridgeLaunch } from './bridge'

export interface MdeMcpOptions {
  userData: string
  platform: NodeJS.Platform
  chat: InboxChatService
  store: InboxStore
  available(): boolean
  /** Resolves and checks a folder as the window's "add project" does. */
  checkFolder(target: OpenCodeTarget, directory: string): Promise<{ directory: string; target: OpenCodeTarget }>
  /** Tells the window its projects changed. */
  foldersChanged(): void
  now(): number
}

/** Starts listening for the bridge. A failure only means agents cannot start threads; MDE itself carries on. */
export async function startMdeMcp(options: MdeMcpOptions): Promise<McpListener | null> {
  const { chat, store } = options
  const tools = new MdeMcpTools({
    available: options.available,
    targetAllowed: (target) => options.platform === 'win32' ? target.kind === 'wsl' : target.kind === 'native',
    thread: (id) => store.get(id),
    folders: () => store.folders(),
    composer: () => store.composer(),
    addFolder: async (target, directory) => {
      const place = await options.checkFolder(target, directory)
      if (serviceTargetKey(place.target) !== serviceTargetKey(target)) throw new Error('That folder is in another WSL distro.')
      const before = store.folders().length
      const folder = chat.addFolder({ ...place, select: false })
      if (store.folders().length !== before) options.foldersChanged()
      return folder
    },
    currentBranch: async (folder) => (await chat.gitInfo({ folderId: folder.id })).branch,
    create: async (request, { parentId }) => {
      const before = store.folders().length
      try {
        return await chat.create(request, { spawnedBy: parentId ? { threadId: parentId } : {} })
      } finally {
        // A worktree thread adds the worktree as a project.
        if (store.folders().length !== before) options.foldersChanged()
      }
    },
    now: options.now,
  })
  try {
    const token = await ensureMcpToken(options.userData)
    const listener = new McpListener({
      path: mcpEndpoint(options.userData, options.platform),
      platform: options.platform,
      token: () => token,
      handle: (request) => tools.handle(request),
    })
    await listener.start()
    return listener
  } catch (error) {
    console.warn(`[mcp] could not start the MDE MCP listener: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

/**
 * This copy of MDE as the bridge command for a target. Inside WSL the Windows executable is named by its
 * `/mnt/…` path, which WSL's interop runs as a Windows program.
 */
export async function mdeMcpCommand(
  target: OpenCodeTarget,
  self: { executable: string; appPath?: string; userDataDir?: string },
  toWsl: (distro: string, windowsPath: string) => Promise<string | null>,
): Promise<string[]> {
  if (target.kind === 'native') return bridgeCommand({ ...self, target })
  const executable = await toWsl(target.distro, self.executable)
  const appPath = self.appPath ? await toWsl(target.distro, self.appPath) : undefined
  if (!executable || appPath === null) throw new Error(`MDE’s location could not be translated into ${target.distro}. Is the distro running?`)
  return bridgeCommand({ executable, ...(appPath ? { appPath } : {}), ...(self.userDataDir ? { userDataDir: self.userDataDir } : {}), target })
}
