import { describe, expect, it } from 'vitest'
import {
  browserHost,
  browserUrl,
  classifyBrowserRequest,
  isBrowserUrlAllowed,
  isHostAllowed,
  isLoopbackHost,
  isLoopbackOrigin,
  normalizeAllowedHost,
  type BrowserRequester,
} from '../src/shared/browser'

/** A part of a local dev page asking. */
const local: BrowserRequester = { topLevel: false, origin: 'http://localhost:5173' }

describe('MDE browser hosts', () => {
  it('counts only this machine as local', () => {
    for (const host of ['localhost', 'LOCALHOST', 'app.localhost', '127.0.0.1', '127.8.9.10', '[::1]', '0.0.0.0', '[::ffff:7f00:1]']) {
      expect(isLoopbackHost(host), host).toBe(true)
    }
    for (const host of ['localhost.example.com', 'mylocalhost', '128.0.0.1', '10.0.0.1', '192.168.1.5', '[::2]', 'example.test', '127.0.0.1.nip.io']) {
      expect(isLoopbackHost(host), host).toBe(false)
    }
  })

  it('reads an allowed host from a name, an address with a port or a whole URL, and drops port and path', () => {
    expect(normalizeAllowedHost('Staging.Example.Internal')).toBe('staging.example.internal')
    expect(normalizeAllowedHost('10.1.2.3:8443')).toBe('10.1.2.3')
    expect(normalizeAllowedHost('https://staging.example.internal:8443/app?x=1')).toBe('staging.example.internal')
    expect(normalizeAllowedHost('[fd00::5]:3000')).toBe('[fd00::5]')
    expect(normalizeAllowedHost('  host.test  ')).toBe('host.test')
  })

  it('refuses wildcards, user names, other schemes and empty or spaced entries', () => {
    for (const input of ['', '   ', '*.example.com', 'user:pw@host.test', 'ftp://host.test', 'file:///etc/passwd', 'two words', 'host.test.', 'bad\u0000host']) {
      expect(normalizeAllowedHost(input), JSON.stringify(input)).toBeNull()
    }
  })

  it('allows local hosts always and others only when listed, matching the whole host', () => {
    expect(isHostAllowed('localhost', [])).toBe(true)
    expect(isHostAllowed('staging.test', ['staging.test'])).toBe(true)
    expect(isHostAllowed('STAGING.test', ['staging.test'])).toBe(true)
    expect(isHostAllowed('evil.staging.test', ['staging.test'])).toBe(false)
    expect(isHostAllowed('staging.test.evil.com', ['staging.test'])).toBe(false)
  })

  it('turns what was typed into an http(s) address, and nothing else', () => {
    expect(browserUrl('localhost:3000')).toBe('http://localhost:3000/')
    expect(browserUrl('localhost:5173/app?x=1#top')).toBe('http://localhost:5173/app?x=1#top')
    expect(browserUrl('https://staging.test/')).toBe('https://staging.test/')
    expect(browserUrl('127.0.0.1:8080')).toBe('http://127.0.0.1:8080/')
    for (const input of ['javascript:alert(1)', 'file:///C:/Windows', 'data:text/html,hi', 'http://user:pw@localhost/', 'chrome://settings', '', 'a b']) {
      expect(browserUrl(input), input).toBeNull()
    }
  })

  it('names the host of web and socket addresses only', () => {
    expect(browserHost('http://LocalHost:3000/x')).toBe('localhost')
    expect(browserHost('wss://staging.test/socket')).toBe('staging.test')
    expect(browserHost('file:///tmp/x')).toBeNull()
    expect(browserHost('not a url')).toBeNull()
  })

  it('decides each request before it is sent', () => {
    const allowed = ['staging.test']
    expect(classifyBrowserRequest('http://localhost:5173/src/main.ts', allowed, local)).toEqual({ allow: true })
    expect(classifyBrowserRequest('ws://localhost:5173/', allowed, local)).toEqual({ allow: true })
    expect(classifyBrowserRequest('https://staging.test/api', allowed, local)).toEqual({ allow: true })
    expect(classifyBrowserRequest('data:image/png;base64,AAAA', allowed, local)).toEqual({ allow: true })
    expect(classifyBrowserRequest('blob:http://localhost:5173/1234', allowed, local)).toEqual({ allow: true })
    expect(classifyBrowserRequest('about:blank', allowed, local)).toEqual({ allow: true })
    // A CDN, an analytics beacon, a sign-in redirect: refused, and named so the person can allow it.
    expect(classifyBrowserRequest('https://cdn.example.com/lib.js', allowed, local)).toEqual({ allow: false, host: 'cdn.example.com' })
    expect(classifyBrowserRequest('wss://socket.example.com/', allowed, local)).toEqual({ allow: false, host: 'socket.example.com' })
    // Schemes the browser never loads are refused without a host to allow.
    expect(classifyBrowserRequest('file:///etc/passwd', allowed, local)).toEqual({ allow: false, host: null })
    expect(classifyBrowserRequest('ftp://staging.test/x', allowed, local)).toEqual({ allow: false, host: null })
    expect(classifyBrowserRequest('http://user:pw@localhost/', allowed, local)).toEqual({ allow: false, host: null })
    expect(classifyBrowserRequest('nonsense', allowed, local)).toEqual({ allow: false, host: null })
  })

  it('counts only web origins on this machine as local', () => {
    for (const origin of ['http://localhost:5173', 'https://app.localhost', 'http://127.0.0.1:8080', 'http://[::1]:3000', 'http://localhost:3000/page']) {
      expect(isLoopbackOrigin(origin), origin).toBe(true)
    }
    for (const origin of ['null', '', null, undefined, 'https://staging.test', 'http://192.168.1.5', 'file:///tmp/x', 'chrome-extension://abc', 'http://127.0.0.1.nip.io']) {
      expect(isLoopbackOrigin(origin), String(origin)).toBe(false)
    }
  })

  it('lets only local pages reach local addresses from within the page', () => {
    const allowed = ['staging.test', '192.168.1.5']
    const staging: BrowserRequester = { topLevel: false, origin: 'https://staging.test' }
    // A page from an allowed host loads its own parts and those of other allowed hosts...
    expect(classifyBrowserRequest('https://staging.test/api', allowed, staging)).toEqual({ allow: true })
    expect(classifyBrowserRequest('http://192.168.1.5/x', allowed, staging)).toEqual({ allow: true })
    // ...but nothing on this machine, whatever the kind of request or the local name.
    for (const url of ['http://localhost:11434/api/generate', 'ws://127.0.0.1:5173/', 'http://[::1]:8080/', 'http://app.localhost/', 'http://0.0.0.0:3000/']) {
      expect(classifyBrowserRequest(url, allowed, staging), url).toEqual({ allow: false, host: new URL(url).hostname })
    }
    // A sandboxed frame, a data: page or no known origin counts as not local.
    expect(classifyBrowserRequest('http://localhost:3000/', allowed, { topLevel: false, origin: 'null' })).toMatchObject({ allow: false })
    expect(classifyBrowserRequest('http://localhost:3000/', allowed, { topLevel: false, origin: null })).toMatchObject({ allow: false })
    // A local page reaches every local port, and the tab itself may open a local page whoever sent it there.
    expect(classifyBrowserRequest('http://127.0.0.1:8080/api', allowed, local)).toEqual({ allow: true })
    expect(classifyBrowserRequest('http://localhost:3000/', allowed, { topLevel: true })).toEqual({ allow: true })
    // A host that is not allowed stays refused for every requester.
    expect(classifyBrowserRequest('https://cdn.example.com/x', allowed, { topLevel: true })).toEqual({ allow: false, host: 'cdn.example.com' })
  })

  it('says whether a link may open in the MDE browser', () => {
    expect(isBrowserUrlAllowed('http://localhost:3000/', [])).toBe(true)
    expect(isBrowserUrlAllowed('https://github.com/', [])).toBe(false)
    expect(isBrowserUrlAllowed('https://staging.test/', ['staging.test'])).toBe(true)
    expect(isBrowserUrlAllowed('mailto:me@example.com', [])).toBe(false)
  })
})
