import { describe, expect, it } from 'vitest'
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
