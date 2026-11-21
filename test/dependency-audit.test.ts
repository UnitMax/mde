import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { advisoriesOf, advisoryId, auditVerdict, compareVersions, EXCEPTIONS, inRange, newestRelease } from '../scripts/audit-deps.mjs'

const URL = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf'
const exception = { advisory: 'GHSA-fc5q-39xc-vjpf', package: 'picomatch', reason: 'No fix yet.' }

/** An `npm audit --json` report with these advisories, as npm writes them. */
function report(...advisories: Array<{ name: string; range: string; url: string; source?: number }>) {
  const vulnerabilities: Record<string, unknown> = {}
  for (const advisory of advisories) {
    vulnerabilities[advisory.name] = {
      name: advisory.name,
      via: [{ source: advisory.source ?? 1, name: advisory.name, title: 'A problem', url: advisory.url, severity: 'high', range: advisory.range }],
    }
  }
  // A package that is affected only through another lists the other's name, not an advisory.
  vulnerabilities.fdir = { name: 'fdir', via: ['picomatch'] }
  return { vulnerabilities, metadata: { vulnerabilities: { total: advisories.length } } }
}

describe('dependency audit', () => {
  it('lets an excepted advisory through while every published version is affected', () => {
    const verdict = auditVerdict(report({ name: 'picomatch', range: '<=4.0.7', url: URL }), [exception], new Map([['picomatch', ['2.3.1', '4.0.5', '4.0.7']]]))
    expect(verdict.problems).toEqual([])
    expect(verdict.excused).toHaveLength(1)
    expect(verdict.excused[0]).toContain('Newest picomatch is 4.0.7, still affected')
  })

  it('fails once a fixed version is published', () => {
    const verdict = auditVerdict(report({ name: 'picomatch', range: '<=4.0.7', url: URL }), [exception], new Map([['picomatch', ['4.0.7', '4.0.8']]]))
    expect(verdict.problems).toHaveLength(1)
    expect(verdict.problems[0]).toContain('picomatch 4.0.8 is outside the advisory\'s range: a fixed version is out')
  })

  it('also fails when the advisory is narrowed to name the fix', () => {
    const verdict = auditVerdict(report({ name: 'picomatch', range: '<4.0.8', url: URL }), [exception], new Map([['picomatch', ['4.0.7', '4.0.8']]]))
    expect(verdict.problems[0]).toContain('a fixed version is out')
  })

  it('does not count a pre-release as the fix', () => {
    const verdict = auditVerdict(report({ name: 'picomatch', range: '<=4.0.7', url: URL }), [exception], new Map([['picomatch', ['4.0.7', '5.0.0-beta.1']]]))
    expect(verdict.problems).toEqual([])
  })

  it('fails on any advisory that is not excepted, and on one it could not check', () => {
    const other = { name: 'tar', range: '<7.5.2', url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc' }
    expect(auditVerdict(report(other), [], new Map()).problems).toHaveLength(1)
    // The same advisory id for another package is not covered.
    expect(auditVerdict(report({ name: 'micromatch', range: '<=4.0.7', url: URL }), [exception], new Map([['picomatch', ['4.0.7']]])).problems.length).toBeGreaterThan(0)
    expect(auditVerdict(report({ name: 'picomatch', range: '<=4.0.7', url: URL }), [exception], new Map()).problems[0]).toContain('Could not read the published versions')
  })

  it('fails on an exception the audit no longer reports, so it is removed', () => {
    const verdict = auditVerdict(report(), [exception], new Map())
    expect(verdict.problems).toEqual(['picomatch GHSA-fc5q-39xc-vjpf is excepted but no longer reported. Remove the exception in scripts/audit-deps.mjs.'])
  })

  it('reads each advisory once, by its GitHub id', () => {
    const twice = report({ name: 'picomatch', range: '<=4.0.7', url: URL })
    ;(twice.vulnerabilities as Record<string, unknown>).tinyglobby = { via: [{ source: 1, name: 'picomatch', url: URL, range: '<=4.0.7' }] }
    expect([...advisoriesOf(twice).keys()]).toEqual(['GHSA-fc5q-39xc-vjpf'])
    expect(advisoryId(URL)).toBe('GHSA-fc5q-39xc-vjpf')
    expect(advisoryId(undefined)).toBeNull()
  })

  it('reads version ranges as advisories write them', () => {
    expect(inRange('4.0.7', '<=4.0.7')).toBe(true)
    expect(inRange('4.0.8', '<=4.0.7')).toBe(false)
    expect(inRange('2.3.1', '>=2.0.0 <2.3.2 || >=4.0.0 <4.0.8')).toBe(true)
    expect(inRange('3.0.0', '>=2.0.0 <2.3.2 || >=4.0.0 <4.0.8')).toBe(false)
    expect(inRange('1.1.0', '1.0.0 - 1.2.0')).toBe(true)
    expect(inRange('1.0.0', '*')).toBe(true)
    expect(inRange('1.0.0', '>= 0.5.0 < 1.0.1')).toBe(true)
    expect(() => inRange('1.0.0', '^1.0.0')).toThrow()
    expect(compareVersions('4.0.0-beta.1', '4.0.0')).toBeLessThan(0)
    expect(newestRelease(['4.0.7', '10.0.0', '11.0.0-rc.1', '9.9.9'])).toBe('10.0.0')
  })

  it('gives every exception an advisory id, a package and a reason', () => {
    for (const item of EXCEPTIONS) {
      expect(advisoryId(item.advisory)).toBe(item.advisory)
      expect(item.package).not.toBe('')
      expect(item.reason).not.toBe('')
    }
  })
})

describe('dependency audit command', () => {
  let dir: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'mde-audit-'))
    writeFileSync(join(dir, 'npm.cjs'), [
      'if (process.env.AUDIT_SIGNAL) process.kill(process.pid, "SIGTERM")',
      'process.stdout.write(process.env.AUDIT_REPORT)',
      'process.exitCode = Number(process.env.AUDIT_STATUS)',
    ].join('\n'))
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  function run(report: unknown, status: number, signal = '') {
    // Windows treats NPM_EXECPATH and npm_execpath as one variable when spawning a child.
    // Remove every inherited spelling so the child always uses the fixture.
    const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'npm_execpath'))
    const result = spawnSync(process.execPath, ['scripts/audit-deps.mjs'], {
      encoding: 'utf8',
      env: {
        ...inherited,
        npm_execpath: join(dir, 'npm.cjs'),
        AUDIT_REPORT: JSON.stringify(report),
        AUDIT_STATUS: String(status),
        AUDIT_SIGNAL: signal,
      },
    })
    if (result.error) throw result.error
    return result
  }

  const zero = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 }
  const clean = { auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: zero } }
  const advisory = { name: 'example', source: 123, title: 'Example advisory', url: URL, severity: 'high', range: '<2.0.0' }
  const affected = {
    ...clean,
    vulnerabilities: {
      example: { name: 'example', severity: 'high', via: [advisory] },
      consumer: { name: 'consumer', severity: 'high', via: ['example'] },
    },
    metadata: { vulnerabilities: { ...zero, high: 2, total: 2 } },
  }

  it('accepts a complete clean report with exit status zero', () => {
    expect(run(clean, 0)).toMatchObject({ status: 0, stdout: 'found 0 vulnerabilities\n' })
  })

  it.each([
    ['empty report', {}, 1],
    ['failed clean report', clean, 1],
    ['unexpected exit', clean, 2],
    ['unsupported format', { ...clean, auditReportVersion: 3 }, 0],
    ['missing counts', { ...clean, metadata: {} }, 0],
    ['invalid count', { ...clean, metadata: { vulnerabilities: { ...zero, total: '0' } } }, 0],
    ['inconsistent severity', { ...affected, metadata: { vulnerabilities: { ...zero, total: 2 } } }, 1],
    ['successful exit with findings', affected, 0],
    ['incomplete advisory', { ...affected, vulnerabilities: { ...affected.vulnerabilities,
      example: { name: 'example', severity: 'high', via: [{}] } } }, 1],
    ['indirect entries without an advisory', { ...affected, vulnerabilities: { ...affected.vulnerabilities,
      example: { name: 'example', severity: 'high', via: ['consumer'] } } }, 1],
  ] as const)('rejects %s', (_label, report, status) => {
    expect(run(report, status)).toMatchObject({ status: 1, stdout: '', stderr: expect.stringMatching(/npm audit/i) })
  })

  it.skipIf(process.platform === 'win32')('rejects a terminated npm process', () => {
    expect(run(clean, 0, '1')).toMatchObject({ status: 1, stderr: expect.stringContaining('SIGTERM') })
  })

  it('evaluates advisories from a valid status-one report including indirect dependencies', () => {
    expect(run(affected, 1)).toMatchObject({ status: 1, stderr: expect.stringContaining('Example advisory') })
  })
})
