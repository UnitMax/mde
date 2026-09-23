import * as nodePath from 'node:path'
import { pathToFileURL } from 'node:url'
import { net, protocol, type Session } from 'electron'

export const RENDERER_SCHEME = 'app'
export const RENDERER_HOST = 'mde'
export const RENDERER_ENTRY_URL = `${RENDERER_SCHEME}://${RENDERER_HOST}/index.html`

export type RendererProtocolSession = Pick<Session, 'protocol'>

type PathModule = Pick<typeof nodePath, 'resolve' | 'relative' | 'isAbsolute' | 'sep'>

// Backslashes and colons would let a Windows path name a drive, a stream or a
// UNC share; no packaged renderer file uses either.
const UNSAFE_PATH_CHARACTERS = /[\\:\u0000-\u001f\u007f]/

/**
 * Registers the renderer's own origin. The renderer is served from `app://mde`
 * rather than `file://`, so it gets an ordinary standard, secure origin and none
 * of the local-file privileges Chromium grants to file pages. Electron requires
 * this before `ready`.
 */
export function registerRendererScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: RENDERER_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true }
    }
  ])
}

/**
 * Maps an `app://mde/...` request to a file inside the packaged renderer
 * directory, or returns null. Anything that is not a plain path under `root`
 * is refused: other hosts, credentials, ports, queries, fragments, encoded
 * separators, colons or control characters, dot segments, and paths that resolve
 * outside `root`.
 */
export function resolveRendererAsset(
  root: string,
  requestUrl: string,
  path: PathModule = nodePath
): string | null {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }
  if (url.protocol !== `${RENDERER_SCHEME}:` || url.host !== RENDERER_HOST) return null
  if (url.username || url.password || url.search || url.hash) return null

  let decoded: string
  try {
    decoded = decodeURIComponent(url.pathname)
  } catch {
    return null
  }
  if (UNSAFE_PATH_CHARACTERS.test(decoded)) return null

  const segments = decoded.split('/').filter((segment) => segment !== '')
  if (segments.some((segment) => segment === '.' || segment === '..')) return null

  const file = path.resolve(root, ...(segments.length > 0 ? segments : ['index.html']))
  const relative = path.relative(root, file)
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return null
  }
  return file
}

function notFound(): Response {
  return new Response(null, { status: 404 })
}

/** Serves the packaged renderer, and nothing else, on the renderer origin. */
export function installRendererProtocol(session: RendererProtocolSession, root: string): void {
  session.protocol.handle(RENDERER_SCHEME, (request) => {
    if (request.method !== 'GET') return new Response(null, { status: 405 })
    const file = resolveRendererAsset(root, request.url)
    if (!file) return notFound()
    return net.fetch(pathToFileURL(file).toString()).catch(notFound)
  })
}
