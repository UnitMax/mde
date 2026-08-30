import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IpcChannels, IpcEvents, type RendererApi } from '@shared/ipc'
import type {
  OpenCodeTuiInstancesUpdate,
  OpenCodeTuiStatusUpdate,
  PtyDataChunk,
  PtyDirectoryUpdate,
  PtyExitInfo
} from '@shared/types'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.off(channel, wrapped)
}

const api: RendererApi = {
  clipboard: {
    writeText: (text) => ipcRenderer.invoke(IpcChannels.clipboardWriteText, text)
  },
  app: {
    info: () => ipcRenderer.invoke(IpcChannels.appInfo)
  },
  platform: {
    info: () => ipcRenderer.invoke(IpcChannels.platformInfo)
  },
  projects: {
    create: (input) => ipcRenderer.invoke(IpcChannels.projectsCreate, input),
    update: (req) => ipcRenderer.invoke(IpcChannels.projectsUpdate, req),
    remove: (id) => ipcRenderer.invoke(IpcChannels.projectsRemove, id)
  },
  todoProjects: {
    create: (input) => ipcRenderer.invoke(IpcChannels.todoProjectsCreate, input),
    update: (req) => ipcRenderer.invoke(IpcChannels.todoProjectsUpdate, req),
    remove: (id) => ipcRenderer.invoke(IpcChannels.todoProjectsRemove, id)
  },
  todoTasks: {
    create: (input) => ipcRenderer.invoke(IpcChannels.todoTasksCreate, input),
    update: (req) => ipcRenderer.invoke(IpcChannels.todoTasksUpdate, req),
    move: (req) => ipcRenderer.invoke(IpcChannels.todoTasksMove, req),
    remove: (id) => ipcRenderer.invoke(IpcChannels.todoTasksRemove, id)
  },
  workspace: {
    list: () => ipcRenderer.invoke(IpcChannels.workspaceList)
  },
  sessions: {
    create: (input) => ipcRenderer.invoke(IpcChannels.sessionsCreate, input),
    duplicate: (id) => ipcRenderer.invoke(IpcChannels.sessionsDuplicate, id),
    update: (req) => ipcRenderer.invoke(IpcChannels.sessionsUpdate, req),
    move: (req) => ipcRenderer.invoke(IpcChannels.sessionsMove, req),
    reorder: (req) => ipcRenderer.invoke(IpcChannels.sessionsReorder, req),
    remove: (id) => ipcRenderer.invoke(IpcChannels.sessionsRemove, id)
  },
  tabs: {
    create: (req) => ipcRenderer.invoke(IpcChannels.tabsCreate, req),
    select: (req) => ipcRenderer.invoke(IpcChannels.tabsSelect, req),
    update: (req) => ipcRenderer.invoke(IpcChannels.tabsUpdate, req),
    remove: (req) => ipcRenderer.invoke(IpcChannels.tabsRemove, req)
  },
  pty: {
    ensure: (req) => ipcRenderer.invoke(IpcChannels.ptyEnsure, req),
    write: (req) => ipcRenderer.invoke(IpcChannels.ptyWrite, req),
    resize: (req) => ipcRenderer.invoke(IpcChannels.ptyResize, req),
    setPalette: (req) => ipcRenderer.invoke(IpcChannels.ptyPalette, req),
    restart: (req) => ipcRenderer.invoke(IpcChannels.ptyRestart, req),
    dispose: (sessionId) => ipcRenderer.invoke(IpcChannels.ptyDispose, sessionId),
    statuses: () => ipcRenderer.invoke(IpcChannels.ptyStatuses),
    directories: () => ipcRenderer.invoke(IpcChannels.ptyDirectories),
    dropFiles: ({ terminalId, files, uriList, mode }) => {
      const hasMatchingUriList = uriList !== undefined && uriList.length === files.length
      const descriptors = files.map((file, index) => {
        let nativePath: string | undefined
        try {
          const path = webUtils.getPathForFile(file)
          if (path) nativePath = path
        } catch {
          // The URI fallback below handles file-manager drops on Electron builds
          // that do not expose a native path for a disk-backed File.
        }

        return {
          name: file.name || `Dropped file ${index + 1}`,
          ...(nativePath ? { nativePath } : {}),
          ...(!nativePath && hasMatchingUriList && uriList[index]
            ? { fileUri: uriList[index] }
            : {})
        }
      })

      return ipcRenderer.invoke(IpcChannels.ptyDropFiles, {
        terminalId,
        files: descriptors,
        mode
      })
    },
    onData: (listener) => subscribe<PtyDataChunk>(IpcEvents.ptyData, listener),
    onDirectory: (listener) => subscribe<PtyDirectoryUpdate>(IpcEvents.ptyDirectory, listener),
    onExit: (listener) => subscribe<PtyExitInfo>(IpcEvents.ptyExit, listener)
  },
  wsl: {
    available: () => ipcRenderer.invoke(IpcChannels.wslAvailable),
    distros: () => ipcRenderer.invoke(IpcChannels.wslDistros)
  },
  paths: {
    browse: () => ipcRenderer.invoke(IpcChannels.pathBrowse),
    resolve: (req) => ipcRenderer.invoke(IpcChannels.pathResolve, req),
    validate: (req) => ipcRenderer.invoke(IpcChannels.pathValidate, req),
    reveal: (sessionId) => ipcRenderer.invoke(IpcChannels.pathReveal, sessionId),
    revealTerminal: (terminalId) =>
      ipcRenderer.invoke(IpcChannels.pathRevealTerminal, terminalId),
    openInVsCode: (sessionId) => ipcRenderer.invoke(IpcChannels.pathOpenInVsCode, sessionId),
    openTerminalInVsCode: (terminalId) =>
      ipcRenderer.invoke(IpcChannels.pathOpenTerminalInVsCode, terminalId)
  },
  git: {
    info: (req) => ipcRenderer.invoke(IpcChannels.gitInfo, req),
    status: (req) => ipcRenderer.invoke(IpcChannels.gitStatus, req),
    diff: (req) => ipcRenderer.invoke(IpcChannels.gitDiff, req)
  },
  opencodeTui: {
    settings: () => ipcRenderer.invoke(IpcChannels.opencodeTuiSettings),
    setEnabled: (req) => ipcRenderer.invoke(IpcChannels.opencodeTuiSetEnabled, req),
    setInstanceLabelMode: (req) =>
      ipcRenderer.invoke(IpcChannels.opencodeTuiSetInstanceLabelMode, req),
    pluginState: (req) => ipcRenderer.invoke(IpcChannels.opencodeTuiPluginState, req),
    install: (req) => ipcRenderer.invoke(IpcChannels.opencodeTuiPluginInstall, req),
    remove: (req) => ipcRenderer.invoke(IpcChannels.opencodeTuiPluginRemove, req),
    onStatus: (listener) => subscribe<OpenCodeTuiStatusUpdate>(IpcEvents.opencodeTuiStatus, listener),
    onInstances: (listener) =>
      subscribe<OpenCodeTuiInstancesUpdate>(IpcEvents.opencodeTuiInstances, listener)
  },
  opencodeTokenRate: {
    pluginState: (req) => ipcRenderer.invoke(IpcChannels.opencodeTokenRatePluginState, req),
    install: (req) => ipcRenderer.invoke(IpcChannels.opencodeTokenRatePluginInstall, req),
    remove: (req) => ipcRenderer.invoke(IpcChannels.opencodeTokenRatePluginRemove, req)
  },
  opencodeAlerts: {
    settings: () => ipcRenderer.invoke(IpcChannels.opencodeAlertsSettings),
    setEnabled: (req) => ipcRenderer.invoke(IpcChannels.opencodeAlertsSetEnabled, req)
  }
}

contextBridge.exposeInMainWorld('api', api)
