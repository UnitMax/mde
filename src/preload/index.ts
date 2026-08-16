import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels, IpcEvents, type RendererApi } from '@shared/ipc'
import type {
  OpenCodeStreamChunk,
  OpenCodeTuiStatusUpdate,
  PtyDataChunk,
  PtyExitInfo
} from '@shared/types'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.off(channel, wrapped)
}

const api: RendererApi = {
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
  workspace: {
    list: () => ipcRenderer.invoke(IpcChannels.workspaceList)
  },
  sessions: {
    create: (input) => ipcRenderer.invoke(IpcChannels.sessionsCreate, input),
    update: (req) => ipcRenderer.invoke(IpcChannels.sessionsUpdate, req),
    move: (req) => ipcRenderer.invoke(IpcChannels.sessionsMove, req),
    remove: (id) => ipcRenderer.invoke(IpcChannels.sessionsRemove, id)
  },
  pty: {
    ensure: (req) => ipcRenderer.invoke(IpcChannels.ptyEnsure, req),
    write: (req) => ipcRenderer.invoke(IpcChannels.ptyWrite, req),
    resize: (req) => ipcRenderer.invoke(IpcChannels.ptyResize, req),
    restart: (req) => ipcRenderer.invoke(IpcChannels.ptyRestart, req),
    dispose: (sessionId) => ipcRenderer.invoke(IpcChannels.ptyDispose, sessionId),
    statuses: () => ipcRenderer.invoke(IpcChannels.ptyStatuses),
    onData: (listener) => subscribe<PtyDataChunk>(IpcEvents.ptyData, listener),
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
    openInVsCode: (sessionId) => ipcRenderer.invoke(IpcChannels.pathOpenInVsCode, sessionId)
  },
  opencode: {
    send: (req) => ipcRenderer.invoke(IpcChannels.opencodeSend, req),
    executeCommand: (req) => ipcRenderer.invoke(IpcChannels.opencodeCommand, req),
    listSessions: (req) => ipcRenderer.invoke(IpcChannels.opencodeSessionsList, req),
    listModels: (req) => ipcRenderer.invoke(IpcChannels.opencodeModelsList, req),
    selectSession: (req) => ipcRenderer.invoke(IpcChannels.opencodeSessionSelect, req),
    createSession: (req) => ipcRenderer.invoke(IpcChannels.opencodeSessionCreate, req),
    revert: (req) => ipcRenderer.invoke(IpcChannels.opencodeRevert, req),
    unrevert: (req) => ipcRenderer.invoke(IpcChannels.opencodeUnrevert, req),
    replyPermission: (req) => ipcRenderer.invoke(IpcChannels.opencodePermissionReply, req),
    onStream: (listener) => subscribe<OpenCodeStreamChunk>(IpcEvents.opencodeStream, listener)
  },
  opencodeTui: {
    settings: () => ipcRenderer.invoke(IpcChannels.opencodeTuiSettings),
    setEnabled: (req) => ipcRenderer.invoke(IpcChannels.opencodeTuiSetEnabled, req),
    pluginState: (req) => ipcRenderer.invoke(IpcChannels.opencodeTuiPluginState, req),
    install: (req) => ipcRenderer.invoke(IpcChannels.opencodeTuiPluginInstall, req),
    remove: (req) => ipcRenderer.invoke(IpcChannels.opencodeTuiPluginRemove, req),
    onStatus: (listener) => subscribe<OpenCodeTuiStatusUpdate>(IpcEvents.opencodeTuiStatus, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
