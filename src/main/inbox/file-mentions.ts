import { FILE_MENTION_LIMIT, fileMentionTokens } from '@shared/file-mentions'
import type { ChatFileEntry } from '@shared/types'

/** Asks for the files and folders that fit some typed text, best first. */
export type FileFinder = (query: string) => Promise<ChatFileEntry[]>

/** One file of a prompt that names a file or folder of the project: OpenCode reads it from `uri` itself. */
export interface MentionAttachment {
  uri: string
  name: string
  mention: { start: number; end: number; text: string }
}

/** The `file:` address of a path inside the directory a thread works in. Each part is encoded, so a `#` or a space survives. */
export function fileUri(directory: string, path: string): string {
  const root = directory.replace(/\/+$/, '').split('/').map(encodeURIComponent).join('/')
  return `file://${root}/${path.split('/').map(encodeURIComponent).join('/')}`
}

/**
 * What the project has under this path: the file, or the folder of that name (a folder is asked for
 * without its closing `/` as often as with it). The exact path ranks first among what is found.
 */
export async function resolveFile(find: FileFinder, path: string): Promise<ChatFileEntry | null> {
  const found = await find(path)
  const folder = `${path.replace(/\/$/, '')}/`
  return found.find((entry) => entry.path === path) ?? found.find((entry) => entry.path === folder) ?? null
}

/**
 * The files a message names with `@path` that the project really has, as attachments of the prompt. Text that
 * only looks like a mention (`@alice`) names nothing the project has and is left as text. A path named twice
 * is attached once, at the place it was first written.
 */
export async function mentionAttachments(find: FileFinder, directory: string, text: string): Promise<MentionAttachment[]> {
  const first = new Map<string, ReturnType<typeof fileMentionTokens>[number]>()
  for (const token of fileMentionTokens(text)) {
    if (!first.has(token.path) && first.size < FILE_MENTION_LIMIT) first.set(token.path, token)
  }
  const resolved = await Promise.all([...first.values()].map(async (token) => ({
    token,
    entry: await resolveFile(find, token.path).catch(() => null),
  })))
  return resolved.flatMap(({ token, entry }) => entry
    ? [{ uri: fileUri(directory, entry.path), name: entry.path, mention: { start: token.start, end: token.end, text: token.text } }]
    : [])
}
