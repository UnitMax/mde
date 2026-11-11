import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IpcChannels, IpcEvents, type RendererApi } from '@shared/ipc'
import type {
  ChatEvent,
  InboxThread,
  PtyDataChunk,
  PtyDirectoryUpdate,
  PtyExitInfo,
  WindowMode
} from '@shared/types'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.off(channel, wrapped)
}

const api: RendererApi = {
  clipboard: {
    writeText: (text) => ipcRenderer.invoke(IpcChannels.clipboardWriteText, text),
    paste: () => ipcRenderer.invoke(IpcChannels.clipboardPaste)
  },
  app: {
    info: () => ipcRenderer.invoke(IpcChannels.appInfo)
  },
  platform: {
    info: () => ipcRenderer.invoke(IpcChannels.platformInfo)
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
    configureInbox: (req) => ipcRenderer.invoke(IpcChannels.ptyConfigureInbox, req),
    ensure: (req) => ipcRenderer.invoke(IpcChannels.ptyEnsure, req),
    write: (req) => ipcRenderer.invoke(IpcChannels.ptyWrite, req),
    resize: (req) => ipcRenderer.invoke(IpcChannels.ptyResize, req),
    setPalette: (req) => ipcRenderer.invoke(IpcChannels.ptyPalette, req),
    restart: (req) => ipcRenderer.invoke(IpcChannels.ptyRestart, req),
    dispose: (sessionId) => ipcRenderer.invoke(IpcChannels.ptyDispose, sessionId),
    statuses: () => ipcRenderer.invoke(IpcChannels.ptyStatuses),
    directories: () => ipcRenderer.invoke(IpcChannels.ptyDirectories),
    dropFiles: ({ terminalId, files, uriList, treeEntry, mode }) => {
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
        treeEntry,
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
    listWslDirectories: (req) => ipcRenderer.invoke(IpcChannels.pathListWslDirectories, req),
    revealTerminal: (terminalId) =>
      ipcRenderer.invoke(IpcChannels.pathRevealTerminal, terminalId),
    openTerminalInVsCode: (terminalId) =>
      ipcRenderer.invoke(IpcChannels.pathOpenTerminalInVsCode, terminalId),
    revealInbox: (id) => ipcRenderer.invoke(IpcChannels.pathRevealInbox, id),
    openInboxInVsCode: (id) => ipcRenderer.invoke(IpcChannels.pathOpenInboxInVsCode, id),
    revealTreeFolder: (req) => ipcRenderer.invoke(IpcChannels.pathRevealTreeFolder, req)
  },
  git: {
    terminalInfo: (req) => ipcRenderer.invoke(IpcChannels.gitTerminalInfo, req)
  },
  files: {
    list: (req) => ipcRenderer.invoke(IpcChannels.filesList, req),
    read: (req) => ipcRenderer.invoke(IpcChannels.filesRead, req)
  },
  inbox: {
    changes: (req) => ipcRenderer.invoke(IpcChannels.inboxChanges, req),
    changeDiff: (req) => ipcRenderer.invoke(IpcChannels.inboxChangeDiff, req),
    list: () => ipcRenderer.invoke(IpcChannels.inboxList),
    setRead: (req) => ipcRenderer.invoke(IpcChannels.inboxSetRead, req),
    setArchived: (req) => ipcRenderer.invoke(IpcChannels.inboxSetArchived, req),
    setPinned: (req) => ipcRenderer.invoke(IpcChannels.inboxSetPinned, req),
    setCustomTitle: (req) => ipcRenderer.invoke(IpcChannels.inboxSetCustomTitle, req),
    remove: (req) => ipcRenderer.invoke(IpcChannels.inboxRemove, req),
    onChanged: (listener) => subscribe<InboxThread>(IpcEvents.inboxChanged, listener),
    folders: () => ipcRenderer.invoke(IpcChannels.inboxFolders),
    addFolder: (req) => ipcRenderer.invoke(IpcChannels.inboxFoldersAdd, req),
    updateFolder: (req) => ipcRenderer.invoke(IpcChannels.inboxFoldersUpdate, req),
    removeFolder: (req) => ipcRenderer.invoke(IpcChannels.inboxFoldersRemove, req),
    setComposer: (req) => ipcRenderer.invoke(IpcChannels.inboxComposerSet, req),
    gitInfo: (req) => ipcRenderer.invoke(IpcChannels.inboxGitInfo, req)
  },
  chat: {
    backgroundTasks: (req) => ipcRenderer.invoke(IpcChannels.chatBackground, req),
    draft: (req) => ipcRenderer.invoke(IpcChannels.chatDraft, req),
    drafts: () => ipcRenderer.invoke(IpcChannels.chatDrafts),
    configure: (req) => ipcRenderer.invoke(IpcChannels.chatConfigure, req),
    options: (req) => ipcRenderer.invoke(IpcChannels.chatOptions, req),
    create: (req) => ipcRenderer.invoke(IpcChannels.chatCreate, req),
    messages: (req) => ipcRenderer.invoke(IpcChannels.chatMessages, req),
    search: (req) => ipcRenderer.invoke(IpcChannels.chatSearch, req),
    files: (req) => ipcRenderer.invoke(IpcChannels.chatFiles, req),
    checkFiles: (req) => ipcRenderer.invoke(IpcChannels.chatFilesCheck, req),
    send: (req) => ipcRenderer.invoke(IpcChannels.chatSend, req),
    discardPending: (req) => ipcRenderer.invoke(IpcChannels.chatDiscardPending, req),
    setDelivery: (req) => ipcRenderer.invoke(IpcChannels.chatSetDelivery, req),
    aside: (req) => ipcRenderer.invoke(IpcChannels.chatAside, req),
    asideHistory: (req) => ipcRenderer.invoke(IpcChannels.chatAsideHistory, req),
    mcp: (req) => ipcRenderer.invoke(IpcChannels.chatMcp, req),
    setMcp: (req) => ipcRenderer.invoke(IpcChannels.chatMcpSet, req),
    interrupt: (req) => ipcRenderer.invoke(IpcChannels.chatInterrupt, req),
    compact: (req) => ipcRenderer.invoke(IpcChannels.chatCompact, req),
    goal: (req) => ipcRenderer.invoke(IpcChannels.chatGoal, req),
    setGoal: (req) => ipcRenderer.invoke(IpcChannels.chatGoalSet, req),
    redo: (req) => ipcRenderer.invoke(IpcChannels.chatRedo, req),
    revert: (req) => ipcRenderer.invoke(IpcChannels.chatRevert, req),
    fork: (req) => ipcRenderer.invoke(IpcChannels.chatFork, req),
    regenerateTitle: (req) => ipcRenderer.invoke(IpcChannels.chatRegenerateTitle, req),
    requests: (req) => ipcRenderer.invoke(IpcChannels.chatRequests, req),
    replyPermission: (req) => ipcRenderer.invoke(IpcChannels.chatPermissionReply, req),
    replyForm: (req) => ipcRenderer.invoke(IpcChannels.chatFormReply, req),
    subscribe: (req) => ipcRenderer.invoke(IpcChannels.chatSubscribe, req),
    unsubscribe: (req) => ipcRenderer.invoke(IpcChannels.chatUnsubscribe, req),
    onEvent: (listener) => subscribe<ChatEvent>(IpcEvents.chatEvent, listener)
  },
  opencodeConfig: {
    read: (req) => ipcRenderer.invoke(IpcChannels.opencodeConfigRead, req),
    preview: (req) => ipcRenderer.invoke(IpcChannels.opencodeConfigPreview, req),
    save: (req) => ipcRenderer.invoke(IpcChannels.opencodeConfigSave, req)
  },
  windowMode: {
    get: () => ipcRenderer.invoke(IpcChannels.windowModeGet),
    set: (req) => ipcRenderer.invoke(IpcChannels.windowModeSet, req),
    onChanged: (listener) => subscribe<WindowMode>(IpcEvents.windowModeChanged, listener)
  },
  windowChrome: {
    set: (req) => ipcRenderer.invoke(IpcChannels.windowChromeSet, req)
  },
  attention: {
    update: (req) => ipcRenderer.invoke(IpcChannels.attentionUpdate, req),
    beep: () => ipcRenderer.invoke(IpcChannels.attentionBeep)
  },
  floatingTerminal: {
    setActive: (active) => ipcRenderer.invoke(IpcChannels.floatingTerminalActive, { active }),
    onToggle: (listener) => subscribe<void>(IpcEvents.floatingTerminalToggle, () => listener())
  }
}

contextBridge.exposeInMainWorld('api', api)
