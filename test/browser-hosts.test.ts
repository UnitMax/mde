import { describe, expect, it } from 'vitest'
import {
  browserHost,
  browserUrl,
  classifyBrowserRequest,
  isBrowserUrlAllowed,
  isHostAllowed,
  isLoopbackHost,
  normalizeAllowedHost,
} from '../src/shared/browser'

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
    expect(classifyBrowserRequest('http://localhost:5173/src/main.ts', allowed)).toEqual({ allow: true })
    expect(classifyBrowserRequest('ws://localhost:5173/', allowed)).toEqual({ allow: true })
    expect(classifyBrowserRequest('https://staging.test/api', allowed)).toEqual({ allow: true })
    expect(classifyBrowserRequest('data:image/png;base64,AAAA', allowed)).toEqual({ allow: true })
    expect(classifyBrowserRequest('blob:http://localhost:5173/1234', allowed)).toEqual({ allow: true })
    expect(classifyBrowserRequest('about:blank', allowed)).toEqual({ allow: true })
    // A CDN, an analytics beacon, a sign-in redirect: refused, and named so the person can allow it.
    expect(classifyBrowserRequest('https://cdn.example.com/lib.js', allowed)).toEqual({ allow: false, host: 'cdn.example.com' })
    expect(classifyBrowserRequest('wss://socket.example.com/', allowed)).toEqual({ allow: false, host: 'socket.example.com' })
    // Schemes the browser never loads are refused without a host to allow.
    expect(classifyBrowserRequest('file:///etc/passwd', allowed)).toEqual({ allow: false, host: null })
    expect(classifyBrowserRequest('ftp://staging.test/x', allowed)).toEqual({ allow: false, host: null })
    expect(classifyBrowserRequest('http://user:pw@localhost/', allowed)).toEqual({ allow: false, host: null })
    expect(classifyBrowserRequest('nonsense', allowed)).toEqual({ allow: false, host: null })
  })

  it('says whether a link may open in the MDE browser', () => {
    expect(isBrowserUrlAllowed('http://localhost:3000/', [])).toBe(true)
    expect(isBrowserUrlAllowed('https://github.com/', [])).toBe(false)
    expect(isBrowserUrlAllowed('https://staging.test/', ['staging.test'])).toBe(true)
    expect(isBrowserUrlAllowed('mailto:me@example.com', [])).toBe(false)
  })
})
