// The OpenCode plugin MDE installs, kept free of imports so the source strings can be
// loaded and exercised on their own.

export const TUI_STATUS_HEARTBEAT_MS = 5_000
export const TUI_STATUS_TICK_MS = 1_000
export const TUI_STATUS_PLUGIN_MARKER = 'mde-opencode-tui-status-plugin-v1'
export const TUI_STATUS_PLUGIN_VERSION = '2.0.0'
export const TUI_STATUS_PLUGIN_VERSION_MARKER = 'mde-opencode-tui-status-plugin-version:'
export const TUI_STATUS_TITLE_MAX_LENGTH = 160

/** Directory under the OpenCode config's `plugins/` that holds both entrypoints. */
export const TUI_STATUS_PLUGIN_DIRECTORY = 'mde-status'
export const TUI_STATUS_TUI_FILE = 'tui.js'
export const TUI_STATUS_SERVER_FILE = 'index.js'
/** OpenCode 1 loaded this loose file; OpenCode 2 cannot use it. */
export const TUI_STATUS_LEGACY_FILE = 'mde-status.js'

const HEADER = `// ${TUI_STATUS_PLUGIN_MARKER}
// ${TUI_STATUS_PLUGIN_VERSION_MARKER} ${TUI_STATUS_PLUGIN_VERSION}
`

/**
 * OpenCode 2 loads a plugin directory by its entrypoints. The server half has
 * nothing to do (it runs in a shared background service that cannot see the
 * terminal's environment), but it completes the directory layout.
 */
export const TUI_STATUS_SERVER_SOURCE = `${HEADER}export default { id: 'mde.status.server', setup() {} }
`

/**
 * Plain JavaScript loaded by the OpenCode 2 terminal UI in an MDE terminal. It
 * runs inside that terminal's own process, so it sees the MDE_OPENCODE_STATUS_*
 * variables. OpenCode's background service is shared by every terminal and
 * streams events for all sessions, so only sessions this terminal has shown (and
 * their children) count towards the status.
 */
export const TUI_STATUS_TUI_SOURCE = `${HEADER}const file = process.env.MDE_OPENCODE_STATUS_FILE
const protocol = process.env.MDE_OPENCODE_STATUS_PROTOCOL
const SETTLE_MS = 3000

export default {
  id: 'mde.status',
  setup: async (context) => {
    const path = await import('node:path')
    const nodeFs = await import('node:fs')
    const root = process.env.MDE_OPENCODE_STATUS_ROOT || '/tmp/mde-opencode'
    if (!file || protocol !== '1' || !path.isAbsolute(root) || path.dirname(file) !== root) return
    if (typeof context?.data?.on !== 'function') return

    let revision = 0
    let status = 'idle'
    let attentionReason
    let title
    let currentSessionId
    let processStartTicks
    let processStartedAt
    const active = new Map()
    const permissions = new Map()
    const forms = new Map()
    const errored = new Set()
    const shown = new Set()
    const subscriptions = []
    try {
      if (process.platform === 'darwin') {
        const { execFileSync } = await import('node:child_process')
        const value = execFileSync('/bin/ps', ['-p', String(process.pid), '-o', 'lstart='], {
          encoding: 'utf8', timeout: 3000, env: { ...process.env, LC_ALL: 'C' },
        }).trim().replace(/\\s+/g, ' ')
        if (value) processStartedAt = value
      } else {
        const fs = await import('node:fs/promises')
        const stat = await fs.readFile('/proc/self/stat', 'utf8')
        const afterName = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\\s+/)
        const value = Number(afterName[19])
        if (Number.isSafeInteger(value) && value >= 0) processStartTicks = value
      }
    } catch {}

    const snapshotOf = (closed) => ({
      protocol: 1,
      status,
      ...(attentionReason ? { attentionReason } : {}),
      ...(title ? { title } : {}),
      revision,
      ...(processStartTicks === undefined ? {} : { processId: process.pid, processStartTicks }),
      ...(processStartedAt === undefined ? {} : { processId: process.pid, processStartedAt }),
      ...(closed ? { closed: true } : {}),
      updatedAt: Date.now(),
    })

    let writePending = false
    let writeRunning = false
    let closing = false
    let writePromise = Promise.resolve()

    const write = (closed = false) => {
      if (closed) closing = true
      writePending = true
      if (writeRunning) return writePromise

      writeRunning = true
      writePromise = (async () => {
        while (writePending) {
          writePending = false
          try {
            const fs = await import('node:fs/promises')
            await fs.mkdir(path.dirname(file), { recursive: true })
            const temporary = file + '.tmp-' + process.pid
            await fs.writeFile(temporary, JSON.stringify(snapshotOf(closing)), { encoding: 'utf8', mode: 0o600 })
            await fs.rename(temporary, file)
          } catch {}
        }
        writeRunning = false
      })()
      return writePromise
    }

    const writeClosedSync = () => {
      try {
        closing = true
        const temporary = file + '.tmp-' + process.pid
        nodeFs.writeFileSync(temporary, JSON.stringify(snapshotOf(true)), { encoding: 'utf8', mode: 0o600 })
        nodeFs.renameSync(temporary, file)
      } catch {}
    }

    const publish = (nextStatus, nextReason) => {
      if (status === nextStatus && attentionReason === nextReason) return
      status = nextStatus
      attentionReason = nextReason
      revision += 1
      write()
    }

    const idOf = (value) => (typeof value === 'string' && value ? value : undefined)

    const cleanTitle = (value) => {
      if (typeof value !== 'string') return undefined
      const cleaned = value.replace(/\\s+/g, ' ').trim().slice(0, ${TUI_STATUS_TITLE_MAX_LENGTH})
      return cleaned || undefined
    }

    const rootOf = (sessionId) => {
      try {
        return idOf(context.data.session.root(sessionId)) ?? sessionId
      } catch {
        return sessionId
      }
    }

    // The tab list is not a signal: it holds every root session of the directory,
    // including those other terminals started. Only the routed session is this one's.
    const claimShown = () => {
      try {
        const route = context.ui?.router?.current?.()
        const sessionId = route?.type === 'session' ? idOf(route.sessionID) : undefined
        if (sessionId) {
          shown.add(sessionId)
          currentSessionId = sessionId
        }
      } catch {}
    }

    const refreshTitle = () => {
      if (!currentSessionId) return
      let next
      try {
        next = cleanTitle(context.data.session.get(rootOf(currentSessionId))?.title)
      } catch {}
      if (title === next) return
      title = next
      write()
    }

    const forget = (sessionId) => {
      active.delete(sessionId)
      errored.delete(sessionId)
      for (const [id, entry] of permissions) if (entry.sessionId === sessionId) permissions.delete(id)
      for (const [id, entry] of forms) if (entry.sessionId === sessionId) forms.delete(id)
    }

    const derive = () => {
      claimShown()
      refreshTitle()
      const roots = new Set([...shown].map(rootOf))
      const owned = (sessionId) => roots.has(rootOf(sessionId))
      const ownsAny = (sessionIds) => {
        for (const sessionId of sessionIds) if (owned(sessionId)) return true
        return false
      }

      if (ownsAny([...permissions.values()].map((entry) => entry.sessionId))) return publish('attention', 'permission')
      if (ownsAny([...forms.values()].map((entry) => entry.sessionId))) return publish('attention', 'question')
      if (ownsAny(active.keys())) return publish('working')
      if (ownsAny(errored)) return publish('error')
      return publish(status === 'idle' || status === 'error' ? 'idle' : 'completed')
    }

    const reconcile = () => {
      const now = Date.now()
      for (const [sessionId, at] of active) {
        if (now - at < SETTLE_MS) continue
        try {
          if (context.data.session.status(sessionId) === 'idle') active.delete(sessionId)
        } catch {}
      }
      for (const [id, entry] of permissions) {
        if (now - entry.at < SETTLE_MS) continue
        try {
          const pending = context.data.session.permission.list(entry.sessionId)
          if (Array.isArray(pending) && !pending.some((item) => item?.id === id)) permissions.delete(id)
        } catch {}
      }
      for (const [id, entry] of forms) {
        if (now - entry.at < SETTLE_MS) continue
        try {
          const pending = context.data.session.form.list(entry.sessionId)
          if (Array.isArray(pending) && !pending.some((item) => item?.id === id)) forms.delete(id)
        } catch {}
      }
    }

    const on = (type, handler) => {
      try {
        subscriptions.push(context.data.on(type, (event) => {
          try {
            handler(event?.data ?? {})
          } catch {}
        }))
      } catch {}
    }

    on('session.execution.started', (data) => {
      const sessionId = idOf(data.sessionID)
      if (!sessionId) return
      errored.delete(sessionId)
      active.set(sessionId, Date.now())
      derive()
    })

    const ended = (data) => {
      const sessionId = idOf(data.sessionID)
      if (!sessionId) return
      active.delete(sessionId)
      derive()
    }
    on('session.execution.succeeded', ended)
    on('session.execution.interrupted', ended)

    on('session.execution.failed', (data) => {
      const sessionId = idOf(data.sessionID)
      if (!sessionId) return
      forget(sessionId)
      errored.add(sessionId)
      derive()
    })

    on('session.deleted', (data) => {
      const sessionId = idOf(data.sessionID)
      if (!sessionId) return
      forget(sessionId)
      derive()
    })

    on('permission.asked', (data) => {
      const id = idOf(data.id)
      const sessionId = idOf(data.sessionID)
      if (!id || !sessionId) return
      permissions.set(id, { sessionId, at: Date.now() })
      derive()
    })
    on('permission.replied', (data) => {
      const id = idOf(data.requestID)
      if (id) permissions.delete(id)
      derive()
    })

    on('form.created', (data) => {
      const id = idOf(data.form?.id)
      const sessionId = idOf(data.form?.sessionID)
      if (!id || !sessionId) return
      forms.set(id, { sessionId, at: Date.now() })
      derive()
    })
    const formSettled = (data) => {
      const id = idOf(data.id)
      if (id) forms.delete(id)
      derive()
    }
    on('form.replied', formSettled)
    on('form.cancelled', formSettled)

    on('session.created', () => derive())
    on('session.renamed', () => derive())

    claimShown()
    refreshTitle()
    write()
    const heartbeat = setInterval(write, ${TUI_STATUS_HEARTBEAT_MS})
    heartbeat.unref?.()
    const tick = setInterval(() => {
      try {
        reconcile()
        derive()
      } catch {}
    }, ${TUI_STATUS_TICK_MS})
    tick.unref?.()
    process.once('exit', writeClosedSync)

    return async () => {
      clearInterval(heartbeat)
      clearInterval(tick)
      process.off('exit', writeClosedSync)
      for (const unsubscribe of subscriptions) {
        try {
          unsubscribe()
        } catch {}
      }
      await write(true)
    }
  },
}
`
