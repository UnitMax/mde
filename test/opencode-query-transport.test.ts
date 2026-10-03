import { execFile } from 'node:child_process'
import { chmod, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { metadataQueryLaunch, parseMetadataOutput } from '../src/main/opencode/sessions'
import type { Session } from '../src/shared/types'

const session: Session = {
  id: 'workspace-1', projectId: 'project-1', name: 'App', kind: 'wsl',
  distro: 'Ubuntu-24.04', path: '/workspace', createdAt: '2026-01-01T00:00:00Z',
}

describe.skipIf(process.platform === 'win32')('OpenCode metadata shell transport', () => {
  it.each([0, 7])('captures large output through a private file, cleans up, and preserves exit status %i', async (status) => {
    const directory = await mkdtemp(join(tmpdir(), 'mde-query-test-'))
    try {
      const executable = join(directory, 'fake-opencode')
      const fixture = join(directory, 'metadata.json')
      const rows = Array.from({ length: 200 }, (_, index) => ({
        id: `ses_${index}`, title: 'A long session title '.repeat(30),
        directory: '/workspace/other', time_created: 100, time_updated: 200,
      }))
      const json = JSON.stringify(rows, null, 2)
      expect(Buffer.byteLength(json)).toBeGreaterThan(65536)
      await writeFile(fixture, json)
      // Fail if the CLI still receives a pipe, where affected OpenCode versions
      // lose buffered output on exit. The temporary output must be private.
      await writeFile(executable, [
        '#!/bin/sh',
        '[ -f /dev/stdout ] || exit 23',
        '[ "$(find "$TMPDIR" -name \'mde-opencode-query.*\' -perm 600 | wc -l)" -eq 1 ] || exit 24',
        'cat "$MDE_QUERY_FIXTURE"',
        `exit ${status}`,
      ].join('\n'))
      await chmod(executable, 0o700)
      const { spec, begin, end } = metadataQueryLaunch(session, executable, 'SELECT synthetic', 'test')
      const script = spec.args.at(-6)!
      const result = await new Promise<{ status: string | number; stdout: string }>((resolve, reject) => {
        execFile('/bin/sh', ['-c', script, 'mde-opencode-query', executable, 'SELECT synthetic', begin, end], {
          env: { ...process.env, TMPDIR: directory, MDE_QUERY_FIXTURE: fixture },
          encoding: 'utf8',
          timeout: 5000,
        }, (error, stdout) => {
          if (error && typeof error.code !== 'number') reject(error)
          else resolve({ status: error?.code ?? 0, stdout })
        })
      })

      expect(result.status).toBe(status)
      expect(parseMetadataOutput(result.stdout, begin, end)).toEqual(rows)
      expect((await readdir(directory)).sort()).toEqual(['fake-opencode', 'metadata.json'])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
