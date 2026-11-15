import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { FileTreeEntryKind, FileTreeListResponse } from '@shared/types'

/** A file of the thread's folder that a reply names, and the line it points at when it gives one. */
export interface FileReference {
  /** Relative to the folder, written with `/`. */
  path: string
  line?: number
}

/** Where a reply's file names are looked up, and how one is opened. */
export interface ChatFileSource {
  /** The thread's folder, as the agent sees it: absolute paths under it name its files. */
  directory: string
  exists: (path: string) => Promise<boolean>
  open: (reference: FileReference) => void
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i
const DRIVE = /^[a-z]:\//i
/** Characters a file name in a reply is never written with: globs, shell syntax, quotes. */
const NOT_A_PATH = /[*?{}$<>|"'`=,;\u0000-\u001f\u007f]/
const LINE_SUFFIX = /:(\d+)(?::\d+)?(?:-\d+)?$/
const LINE_FRAGMENT = /^L(\d+)/i

function folderOf(directory: string): string {
  return directory.replace(/\\/g, '/').replace(/\/+$/, '')
}

/**
 * Reads what a reply wrote as a file of the folder: `src/a.ts`, `./a.ts:12`, an absolute path under the folder,
 * a `file://` link, or a link ending in `#L12`. Returns null for anything else: a web link, a path outside the
 * folder or climbing out of it, a folder (`src/`), or text that is not a path at all. Whether the file is there
 * is for the caller to ask.
 */
export function fileReference(raw: string, directory: string): FileReference | null {
  let text = raw.trim()
  if (!text || text.length > 1000 || /\s/.test(text)) return null
  if (/^file:\/\//i.test(text)) {
    text = text.slice('file://'.length).replace(/^localhost(?=\/)/i, '')
    if (/^\/[a-z]:\//i.test(text)) text = text.slice(1)
  }
  text = text.replace(/\\/g, '/')
  if (SCHEME.test(text) && !DRIVE.test(text)) return null

  let line: number | undefined
  const hash = text.indexOf('#')
  if (hash >= 0) {
    const fragment = LINE_FRAGMENT.exec(text.slice(hash + 1))
    if (fragment) line = Number(fragment[1])
    text = text.slice(0, hash)
  }
  text = text.split('?')[0] ?? ''
  if (text.includes('%')) {
    try {
      text = decodeURIComponent(text)
    } catch {
      return null
    }
  }
  const suffix = LINE_SUFFIX.exec(text)
  if (suffix) {
    line ??= Number(suffix[1])
    text = text.slice(0, suffix.index)
  }
  if (!text || NOT_A_PATH.test(text) || text.endsWith('/')) return null

  let relative: string
  if (text.startsWith('/') || DRIVE.test(text)) {
    const folder = folderOf(directory)
    // A Windows folder is matched without regard to case, as Windows matches it.
    const windows = DRIVE.test(folder)
    const prefix = `${folder}/`
    const under = windows ? text.toLowerCase().startsWith(prefix.toLowerCase()) : text.startsWith(prefix)
    if (!folder || !under) return null
    relative = text.slice(prefix.length)
  } else {
    relative = text.replace(/^(?:\.\/)+/, '')
    if (relative.startsWith('~')) return null
  }
  const segments = relative.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null
  // A bare word in code (`useEffect`, `npm`) is no file name; one with an extension or a folder may be.
  const name = segments[segments.length - 1]!
  if (segments.length === 1 && !/\.[\w-]+$/.test(name)) return null
  if (/^\d+(\.\d+)*$/.test(name)) return null
  return line !== undefined && line > 0 ? { path: relative, line } : { path: relative }
}

/** How long a folder's listing answers for the files in it. A reply can name a file the agent made a moment ago. */
const LISTING_TTL_MS = 10_000

/**
 * Answers whether a folder has a file, from one listing of the folder it would be in, so the many files a reply
 * names in one folder cost one read. A listing is kept for a few seconds; one that fails answers "no".
 */
export function createFileLookup(
  list: (path: string) => Promise<FileTreeListResponse>,
  now: () => number = Date.now,
): (path: string) => Promise<boolean> {
  const listings = new Map<string, { at: number; entries: Promise<Map<string, FileTreeEntryKind> | null> }>()
  return async (path) => {
    const cut = path.lastIndexOf('/')
    const folder = cut < 0 ? '' : path.slice(0, cut)
    const name = path.slice(cut + 1)
    let listing = listings.get(folder)
    if (!listing || now() - listing.at > LISTING_TTL_MS) {
      listing = {
        at: now(),
        entries: list(folder).then(
          (response) => new Map(response.entries.map((entry) => [entry.name, entry.kind])),
          () => null,
        ),
      }
      listings.set(folder, listing)
    }
    const kind = (await listing.entries)?.get(name)
    return kind === 'file' || kind === 'symlink'
  }
}

interface Candidate {
  from: number
  to: number
  raw: string
  /** Written as inline code, not as a link: it gets the chip's own focus and role. */
  code: boolean
}

function candidates(doc: ProseMirrorNode): Candidate[] {
  const found: Candidate[] = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    for (const mark of node.marks) {
      const href = mark.type.name === 'link' && typeof mark.attrs.href === 'string' ? mark.attrs.href : null
      if (href && !/^(?:https?|mailto):/i.test(href)) found.push({ from: pos, to: pos + node.nodeSize, raw: href, code: false })
      else if (mark.type.name === 'code') found.push({ from: pos, to: pos + node.nodeSize, raw: node.text, code: true })
      else continue
      break
    }
  })
  return found
}

interface FileLinksState {
  /** What each written path was found to be; only those the folder has. */
  found: ReadonlyMap<string, FileReference>
  decorations: DecorationSet
}

const fileLinksKey = new PluginKey<FileLinksState>('chatFileLinks')

function decorate(doc: ProseMirrorNode, found: ReadonlyMap<string, FileReference>): DecorationSet {
  if (found.size === 0) return DecorationSet.empty
  const decorations: Decoration[] = []
  let previous: Candidate | undefined
  for (const candidate of candidates(doc)) {
    // A link written partly in bold is several pieces of text; the icon goes before the first only.
    const continues = previous?.raw === candidate.raw && previous.to === candidate.from
    previous = candidate
    const reference = found.get(candidate.raw)
    if (!reference) continue
    decorations.push(Decoration.inline(candidate.from, candidate.to, {
      class: continues ? 'chat-file-link chat-file-link-rest' : 'chat-file-link',
      'data-file-path': reference.path,
      ...(reference.line !== undefined ? { 'data-file-line': String(reference.line) } : {}),
      title: `Open ${reference.path}`,
      // A link can already be reached with Tab; a name in code becomes one.
      ...(candidate.code ? { role: 'link', tabindex: '0' } : {}),
    }))
  }
  return DecorationSet.create(doc, decorations)
}

/**
 * Marks the files of the thread's folder that a read-only reply names, in code or as a link, so a click opens
 * them. Each written path is looked up once; what is not a file of the folder stays as it was written.
 */
export const ChatFileLinks = Extension.create<{ source: { current: ChatFileSource | null } }>({
  name: 'chatFileLinks',

  addOptions() {
    return { source: { current: null } }
  },

  addProseMirrorPlugins() {
    const source = this.options.source
    return [
      new Plugin<FileLinksState>({
        key: fileLinksKey,
        state: {
          init: () => ({ found: new Map(), decorations: DecorationSet.empty }),
          apply(tr, value, _old, state) {
            const found = tr.getMeta(fileLinksKey) as ReadonlyMap<string, FileReference> | undefined
            if (!found && !tr.docChanged) return value
            const next = found ?? value.found
            return { found: next, decorations: decorate(state.doc, next) }
          },
        },
        props: {
          decorations: (state) => fileLinksKey.getState(state)?.decorations ?? null,
        },
        view(view) {
          let alive = true
          const asked = new Set<string>()
          const confirmed = new Map<string, FileReference>()
          let flush = false
          const show = (): void => {
            if (flush) return
            flush = true
            queueMicrotask(() => {
              flush = false
              if (alive) view.dispatch(view.state.tr.setMeta(fileLinksKey, new Map(confirmed)))
            })
          }
          const scan = (): void => {
            const files = source.current
            if (!files) return
            for (const { raw } of candidates(view.state.doc)) {
              if (asked.has(raw)) continue
              asked.add(raw)
              const reference = fileReference(raw, files.directory)
              if (!reference) continue
              void files.exists(reference.path).then((exists) => {
                if (!exists || !alive) return
                confirmed.set(raw, reference)
                show()
              }, () => undefined)
            }
          }
          scan()
          return {
            update(next, previous) {
              if (next.state.doc !== previous.doc) scan()
            },
            destroy() {
              alive = false
            },
          }
        },
      }),
    ]
  },
})
