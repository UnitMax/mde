import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('app-builder-lib'))
const downloaderPath = builderRequire.resolve('@electron/get/dist/cjs/GotDownloader')
const proxyPath = builderRequire.resolve('@electron/get/dist/cjs/proxy')

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing server address')
  return address.port
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

describe('Electron builder downloader compatibility', () => {
  it.each([false, true])('downloads with NO_PROXY bypass=%s', async (bypass) => {
    const directory = await mkdtemp(join(tmpdir(), 'mde-proxy-test-'))
    const artifact = join(directory, 'artifact')
    const proxyRequests: string[] = []
    let originRequests = 0
    const origin = createServer((_request, response) => {
      originRequests++
      response.end('direct artifact')
    })
    const proxy = createServer((request, response) => {
      proxyRequests.push(request.url ?? '')
      response.end('proxied artifact')
    })
    try {
      const originPort = await listen(origin)
      const proxyPort = await listen(proxy)
      const url = `http://127.0.0.1:${originPort}/artifact.zip`
      const env = { ...process.env }
      for (const key of Object.keys(env)) {
        if (/proxy/i.test(key) || key.startsWith('GLOBAL_AGENT_')) delete env[key]
      }
      await execFileAsync(process.execPath, ['-e', `
        const { initializeProxy } = require(${JSON.stringify(proxyPath)})
        const { GotDownloader } = require(${JSON.stringify(downloaderPath)})
        initializeProxy()
        new GotDownloader().download(process.argv[1], process.argv[2], { quiet: true })
          .catch(error => { console.error(error); process.exitCode = 1 })
      `, url, artifact], {
        env: {
          ...env,
          GLOBAL_AGENT_HTTP_PROXY: `http://127.0.0.1:${proxyPort}`,
          GLOBAL_AGENT_NO_PROXY: bypass ? '127.0.0.1' : '',
          ELECTRON_GET_NO_PROGRESS: '1',
        },
        timeout: 10_000,
      })
      expect(await readFile(artifact, 'utf8')).toBe(bypass ? 'direct artifact' : 'proxied artifact')
      expect(proxyRequests).toEqual(bypass ? [] : [url])
      expect(originRequests).toBe(bypass ? 1 : 0)
    } finally {
      await Promise.all([close(origin), close(proxy)])
      await rm(directory, { recursive: true, force: true })
    }
  }, 15_000)
})
