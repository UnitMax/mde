import { posix, win32 } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  net: { fetch: vi.fn() },
  protocol: { registerSchemesAsPrivileged: vi.fn() }
}))

vi.mock('electron', () => electronMock)

import {
  installRendererProtocol,
  registerRendererScheme,
  RENDERER_ENTRY_URL,
  resolveRendererAsset,
  type RendererProtocolSession
} from '../src/main/renderer-protocol'

const POSIX_ROOT = '/opt/mde/resources/app.asar/out/renderer'
const WIN32_ROOT = 'C:\\Users\\Me\\mde\\resources\\app.asar\\out\\renderer'

const HOSTILE_URLS = [
  'app://mde/assets/%2e%2e%2f%2e%2e%2fmain/index.js',
  'app://mde/assets%2f..%2f..%2fmain/index.js',
  'app://mde/..%5c..%5cmain%5cindex.js',
  'app://mde/assets/%5c%5cserver%5cshare',
  'app://mde/index.html%00.js',
  'app://mde/index%0a.html',
  'app://mde/%E0%A4%A',
  'app://mde/index.html?x=1',
  'app://mde/index.html#top',
  'app://user:pass@mde/index.html',
  'app://mde:8080/index.html',
  'app://evil/index.html',
  'app:///etc/passwd',
  'file:///etc/passwd',
  'http://mde/index.html',
  'not a url'
]

describe('renderer protocol', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers a standard, secure scheme without CSP bypass', () => {
    registerRendererScheme()

    expect(electronMock.protocol.registerSchemesAsPrivileged).toHaveBeenCalledExactlyOnceWith([
      { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
    ])
    expect(RENDERER_ENTRY_URL).toBe('app://mde/index.html')
  })

  it('maps renderer paths inside the packaged renderer directory', () => {
    expect(resolveRendererAsset(POSIX_ROOT, 'app://mde/', posix)).toBe(`${POSIX_ROOT}/index.html`)
    expect(resolveRendererAsset(POSIX_ROOT, 'app://mde', posix)).toBe(`${POSIX_ROOT}/index.html`)
    expect(resolveRendererAsset(POSIX_ROOT, RENDERER_ENTRY_URL, posix)).toBe(
      `${POSIX_ROOT}/index.html`
    )
    expect(resolveRendererAsset(POSIX_ROOT, 'app://mde/assets/index-D4NzoJNf.js', posix)).toBe(
      `${POSIX_ROOT}/assets/index-D4NzoJNf.js`
    )
    expect(resolveRendererAsset(WIN32_ROOT, 'app://mde/assets/index-D4NzoJNf.js', win32)).toBe(
      `${WIN32_ROOT}\\assets\\index-D4NzoJNf.js`
    )
  })

  it('keeps dot segments the URL parser collapses inside the root', () => {
    for (const url of [
      'app://mde/../main/index.js',
      'app://mde/%2e%2e/main/index.js',
      'app://mde/.%2e/../../main/index.js'
    ]) {
      expect(resolveRendererAsset(POSIX_ROOT, url, posix), url).toBe(`${POSIX_ROOT}/main/index.js`)
    }
  })

  it('refuses hostile and foreign URLs', () => {
    for (const url of HOSTILE_URLS) {
      expect(resolveRendererAsset(POSIX_ROOT, url, posix), url).toBeNull()
      expect(resolveRendererAsset(WIN32_ROOT, url, win32), url).toBeNull()
    }
  })

  it('refuses Windows drive paths and keeps UNC-shaped paths inside the root', () => {
    for (const url of [
      'app://mde/C:/Windows/win.ini',
      'app://mde/C:%5cWindows%5cwin.ini',
      'app://mde/index.html:stream'
    ]) {
      expect(resolveRendererAsset(WIN32_ROOT, url, win32), url).toBeNull()
    }
    expect(resolveRendererAsset(WIN32_ROOT, 'app://mde//server/share/file', win32)).toBe(
      `${WIN32_ROOT}\\server\\share\\file`
    )
  })

  it('serves resolved files and rejects everything else', async () => {
    const handlers: Array<(request: Request) => Response | Promise<Response>> = []
    const session = {
      protocol: {
        handle: (scheme: string, handler: (request: Request) => Response | Promise<Response>) => {
          expect(scheme).toBe('app')
          handlers.push(handler)
        }
      }
    } as unknown as RendererProtocolSession
    const served = new Response('ok')
    electronMock.net.fetch.mockResolvedValue(served)

    installRendererProtocol(session, POSIX_ROOT)
    expect(handlers).toHaveLength(1)
    const handler = handlers[0]!

    const request = (url: string, method = 'GET') => ({ url, method }) as Request
    await expect(handler(request('app://mde/index.html'))).resolves.toBe(served)
    expect(electronMock.net.fetch).toHaveBeenCalledExactlyOnceWith(
      `file://${POSIX_ROOT}/index.html`
    )

    expect((await handler(request('app://mde/assets%2f..%2f..%2fmain/index.js'))).status).toBe(404)
    expect((await handler(request('app://mde/index.html', 'POST'))).status).toBe(405)
    expect(electronMock.net.fetch).toHaveBeenCalledOnce()

    electronMock.net.fetch.mockRejectedValue(new Error('net::ERR_FILE_NOT_FOUND'))
    expect((await handler(request('app://mde/missing.js'))).status).toBe(404)
  })
})
