import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels, IpcEvents, type RendererApi } from '@shared/ipc'
import type { PtyDataChunk, PtyExitInfo } from '@shared/types'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.off(channel, wrapped)
}

const api: RendererApi = {
  platform: {
    info: () => ipcRenderer.invoke(IpcChannels.platformInfo)
  },
  projects: {
    list: () => ipcRenderer.invoke(IpcChannels.projectsList),
    create: (input) => ipcRenderer.invoke(IpcChannels.projectsCreate, input),
    update: (req) => ipcRenderer.invoke(IpcChannels.projectsUpdate, req),
    remove: (id) => ipcRenderer.invoke(IpcChannels.projectsRemove, id)
  },
  pty: {
    ensure: (req) => ipcRenderer.invoke(IpcChannels.ptyEnsure, req),
    write: (req) => ipcRenderer.invoke(IpcChannels.ptyWrite, req),
    resize: (req) => ipcRenderer.invoke(IpcChannels.ptyResize, req),
    restart: (req) => ipcRenderer.invoke(IpcChannels.ptyRestart, req),
    dispose: (projectId) => ipcRenderer.invoke(IpcChannels.ptyDispose, projectId),
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
    reveal: (projectId) => ipcRenderer.invoke(IpcChannels.pathReveal, projectId)
  }
}

contextBridge.exposeInMainWorld('api', api)
