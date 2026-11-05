import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { OpenCodeTarget, Session } from '@shared/types'
import { resolveWslExecutable, type HostExecutable } from '../../windows-executable'
import { buildLaunchSpec, type LaunchSpec } from '../../pty/launch'
import { nativeLoginShell } from '../../native-environment'
import { decodeWslOutput, wslEnv } from '../../wsl/distros'

/** Where and how to reach one OpenCode background service. The password stays in the main process. */
export interface OpenCodeServiceEndpoint {
  /** Loopback origin, e.g. `http://127.0.0.1:49374`. */
  url: string
  password: string
}

export type OpenCodeServiceDiscover = (target: OpenCodeTarget, executable: string) => Promise<OpenCodeServiceEndpoint>

/** Starting a cold service can take a while; reading its file afterwards is instant. */
const DISCOVERY_TIMEOUT_MS = 45_000
const DISCOVERY_MAX_BYTES = 64 * 1024
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])
const PASSWORD = /^[\x21-\x7e]{1,256}$/

export const SERVICE_UNAVAILABLE =
  'Could not start the OpenCode background service. Check the OpenCode executable in Settings (OpenCode 2 or newer is required).'

export function serviceTargetKey(target: OpenCodeTarget): string {
  return target.kind === 'native' ? 'native' : `wsl:${target.distro}`
}

/** A stand-in session that only carries the target's transport (native or a WSL distro). */
export function targetSession(target: OpenCodeTarget, path = '/'): Session {
  return {
    id: 'inbox',
    projectId: 'inbox',
    name: 'Inbox',
    kind: target.kind,
    ...(target.kind === 'wsl' ? { distro: target.distro } : {}),
    path,
    createdAt: new Date(0).toISOString(),
  }
}

/**
 * Starts the service when it is not running (`service start` is a no-op
 * otherwise), then prints its state file between markers. The file holds the
 * URL and the password the CLI itself uses.
 */
export function serviceDiscoveryLaunch(
  target: OpenCodeTarget,
  executable: string,
  marker: string,
  hostExecutable?: HostExecutable,
): { spec: LaunchSpec; begin: string; end: string } {
  if (typeof executable !== 'string' || !executable.trim() || /[\u0000-\u001f\u007f-\u009f]/.test(executable)) {
    throw new Error('Invalid OpenCode executable.')
  }
  const begin = `__MDE_OPENCODE_SERVICE_BEGIN_${marker}__`
  const end = `__MDE_OPENCODE_SERVICE_END_${marker}__`
  const script = [
    'mde_executable=$1',
    'mde_begin=$2',
    'mde_end=$3',
    '"$mde_executable" service start >/dev/null 2>&1 || exit 69',
    'mde_state="${XDG_STATE_HOME:-$HOME/.local/state}/opencode/service.json"',
    'printf "\\n%s\\n" "$mde_begin"',
    'cat -- "$mde_state" || exit 70',
    'printf "\\n%s\\n" "$mde_end"',
  ].join('\n')
  const native = target.kind === 'native'
  const spec = buildLaunchSpec(targetSession(target), {
    platform: native ? 'darwin' : 'win32',
    windowsExecutable: hostExecutable,
    defaultShell: native ? nativeLoginShell() : undefined,
    workingDirectory: '/',
    agent: { executable: '/bin/sh', args: ['-c', script, 'mde-opencode-service', executable, begin, end] },
  })
  return { spec, begin, end }
}

/** Validates the state file: a loopback HTTP origin and a printable password. */
export function parseServiceState(value: unknown): OpenCodeServiceEndpoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(SERVICE_UNAVAILABLE)
  const record = value as Record<string, unknown>
  if (typeof record.url !== 'string' || typeof record.password !== 'string' || !PASSWORD.test(record.password)) {
    throw new Error(SERVICE_UNAVAILABLE)
  }
  let url: URL
  try {
    url = new URL(record.url)
  } catch {
    throw new Error(SERVICE_UNAVAILABLE)
  }
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname) || !url.port ||
    url.username || url.password || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    throw new Error('The OpenCode service reported an address that is not on this computer.')
  }
  return { url: url.origin, password: record.password }
}

export const discoverOpenCodeService: OpenCodeServiceDiscover = async (target, executable) => {
  const native = target.kind === 'native'
  const { spec, begin, end } = serviceDiscoveryLaunch(target, executable, randomUUID(), native ? undefined : resolveWslExecutable('win32'))
  const { stdout, error } = await new Promise<{
    stdout: string
    error: (Error & { killed?: boolean }) | null
  }>((resolve) => {
    execFile(spec.file, spec.args, {
      env: native ? process.env : wslEnv(),
      cwd: spec.cwd,
      encoding: 'buffer',
      timeout: DISCOVERY_TIMEOUT_MS,
      maxBuffer: DISCOVERY_MAX_BYTES,
      windowsHide: true,
    }, (error, rawStdout) => {
      resolve({
        stdout: native ? rawStdout.toString('utf8') : decodeWslOutput(rawStdout),
        error,
      })
    })
  })
  if (error) {
    if (error.killed) throw new Error('Starting the OpenCode background service timed out.')
    throw new Error(SERVICE_UNAVAILABLE)
  }
  let state: unknown
  try {
    const start = stdout.indexOf(begin)
    const finish = stdout.indexOf(end, start + begin.length)
    if (start < 0 || finish < 0) throw new Error(SERVICE_UNAVAILABLE)
    state = JSON.parse(stdout.slice(start + begin.length, finish).trim())
  } catch {
    throw new Error(SERVICE_UNAVAILABLE)
  }
  return parseServiceState(state)
}
