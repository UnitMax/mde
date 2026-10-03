import { describe, expect, it } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { assertIpcSender, rendererEntryUrl } from '../src/main/ipc-security'
import { trustedIpcSender } from './helpers/ipc-sender'

function eventWith(event: IpcMainInvokeEvent, changes: object): IpcMainInvokeEvent {
  return { ...event, ...changes } as IpcMainInvokeEvent
}

describe('IPC sender authentication', () => {
  it('accepts the exact live application main frame', () => {
    const { event, security } = trustedIpcSender()
    expect(() => assertIpcSender(event, security)).not.toThrow()
  })

  it('rejects another window even when it has the same URL', () => {
    const { event, security } = trustedIpcSender()
    const other = trustedIpcSender()
    expect(() => assertIpcSender(other.event, security)).toThrow('Unauthorized IPC sender.')
    expect(() => assertIpcSender(eventWith(event, { sender: other.event.sender }), security)).toThrow('Unauthorized IPC sender.')
  })

  it('rejects child frames, detached frames and missing frame identity', () => {
    const { event, security } = trustedIpcSender()
    for (const senderFrame of [null, undefined, { url: security.rendererUrl, isDestroyed: () => false }]) {
      expect(() => assertIpcSender(eventWith(event, { senderFrame }), security)).toThrow('Unauthorized IPC sender.')
    }
    event.senderFrame!.isDestroyed = () => true
    expect(() => assertIpcSender(event, security)).toThrow('Unauthorized IPC sender.')
  })

  it('fails closed with no current window, a destroyed window or a replaced window', () => {
    const old = trustedIpcSender()
    const current = trustedIpcSender()
    expect(() => assertIpcSender(old.event, { ...old.security, getWebContents: () => null })).toThrow('Unauthorized IPC sender.')
    expect(() => assertIpcSender(old.event, current.security)).toThrow('Unauthorized IPC sender.')
    old.event.sender.isDestroyed = () => true
    expect(() => assertIpcSender(old.event, old.security)).toThrow('Unauthorized IPC sender.')
  })

  it.each([
    'https://example.com/index.html', 'file:///tmp/index.html', 'app://other/index.html',
    'app://mde/other.html', 'app://mde/index.html?untrusted=1', 'app://mde:123/index.html',
    'app://mde.example.com/index.html', 'app://me@mde/index.html', 'app://mde/%69ndex.html', 'about:blank', 'invalid',
  ])('rejects a navigated main frame: %s', (url) => {
    const { event, security } = trustedIpcSender()
    Object.defineProperty(event.senderFrame, 'url', { value: url })
    expect(() => assertIpcSender(event, security)).toThrow('Unauthorized IPC sender.')
  })

  it('allows a fragment on the same renderer document', () => {
    const { event, security } = trustedIpcSender()
    Object.defineProperty(event.senderFrame, 'url', { value: `${security.rendererUrl}#section` })
    expect(() => assertIpcSender(event, security)).not.toThrow()
  })

  it('trusts only the configured development entry, including port and path', () => {
    const { event, security } = trustedIpcSender('http://localhost:5173/')
    expect(() => assertIpcSender(event, security)).not.toThrow()
    for (const url of ['http://localhost:5174/', 'http://127.0.0.1:5173/', 'http://localhost:5173/other', 'https://localhost:5173/']) {
      Object.defineProperty(event.senderFrame, 'url', { value: url, configurable: true })
      expect(() => assertIpcSender(event, security)).toThrow('Unauthorized IPC sender.')
    }
  })

  it('uses the same entry selection as window loading and ignores dev overrides in production', () => {
    expect(rendererEntryUrl(true, 'http://localhost:5173/')).toBe('app://mde/index.html')
    expect(rendererEntryUrl(false)).toBe('app://mde/index.html')
    expect(rendererEntryUrl(false, 'http://localhost:5173/')).toBe('http://localhost:5173/')
  })
})
