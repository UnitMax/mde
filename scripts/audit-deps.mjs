// The dependency audit: `npm audit` over the whole lockfile, failing on every advisory except the few listed in
// EXCEPTIONS below. An exception is for an advisory that has no fixed version yet and does not reach MDE. It only
// holds while that is so: once the package publishes a version outside the advisory's range, the audit fails
// again, so the lockfile gets the fix, and an exception the audit no longer reports fails too, so it is removed.
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/** @type {import('./audit-deps.d.mts').AuditException[]} */
export const EXCEPTIONS = []

/** The advisory id (`GHSA-…`) in an advisory URL, or null. */
export function advisoryId(url) {
  return /GHSA(?:-[0-9a-z]{4}){3}/i.exec(url ?? '')?.[0] ?? null
}

/** Every advisory in an `npm audit --json` report, once each, keyed by id. */
export function advisoriesOf(report) {
  const found = new Map()
  for (const vulnerability of Object.values(report?.vulnerabilities ?? {})) {
    for (const via of vulnerability?.via ?? []) {
      if (!via || typeof via !== 'object') continue
      const id = advisoryId(via.url) ?? `npm-${via.source}`
      if (!found.has(id)) {
        found.set(id, { id, package: via.name, range: via.range, severity: via.severity, title: via.title, url: via.url })
      }
    }
  }
  return found
}

function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text.trim())
  if (!match) throw new Error(`Not a version: ${text}`)
  return { parts: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ?? null }
}

/** Compares two versions as semver does; a pre-release sorts before its release. */
export function compareVersions(a, b) {
  const left = parseVersion(a)
  const right = parseVersion(b)
  for (let index = 0; index < 3; index += 1) {
    if (left.parts[index] !== right.parts[index]) return left.parts[index] - right.parts[index]
  }
  if (left.pre === right.pre) return 0
  if (left.pre === null) return 1
  if (right.pre === null) return -1
  return left.pre < right.pre ? -1 : 1
}

function comparator(text, version) {
  if (text === '*' || text === '') return true
  const match = /^(<=|>=|<|>|=)?\s*(\S+)$/.exec(text)
  if (!match) throw new Error(`Cannot read the version range part ${text}`)
  const order = compareVersions(version, match[2])
  switch (match[1] ?? '=') {
    case '<': return order < 0
    case '<=': return order <= 0
    case '>': return order > 0
    case '>=': return order >= 0
    default: return order === 0
  }
}

/**
 * Whether a version is in a range as advisories write them: `<=4.0.7`, `>=2.0.0 <2.3.2 || >=4.0.0 <4.0.8`,
 * `1.0.0 - 1.2.0`, `*`. Anything else throws, so the audit fails rather than guessing.
 */
export function inRange(version, range) {
  return String(range).split('||').some((alternative) => {
    const text = alternative.trim()
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(text)
    if (hyphen) return comparator(`>=${hyphen[1]}`, version) && comparator(`<=${hyphen[2]}`, version)
    return text.replace(/(<=|>=|<|>|=)\s+/g, '$1').split(/\s+/).every((part) => comparator(part, version))
  })
}

/** The newest version that is not a pre-release, or null. */
export function newestRelease(versions) {
  const releases = versions.filter((version) => !parseVersion(version).pre)
  return releases.sort(compareVersions).at(-1) ?? null
}

/**
 * What the audit finds: `problems` fail it, `excused` are the advisories let through. `published` has every
 * version of each excepted package on the registry.
 */
export function auditVerdict(report, exceptions, published) {
  const problems = []
  const excused = []
  const advisories = advisoriesOf(report)
  for (const advisory of advisories.values()) {
    const exception = exceptions.find((item) => item.advisory === advisory.id && item.package === advisory.package)
    const label = `${advisory.package} ${advisory.range}: ${advisory.title} (${advisory.severity}, ${advisory.url ?? advisory.id})`
    if (!exception) {
      problems.push(label)
      continue
    }
    const newest = newestRelease(published.get(advisory.package) ?? [])
    if (!newest) {
      problems.push(`${label}\n    Could not read the published versions of ${advisory.package} to check the exception.`)
    } else if (!inRange(newest, advisory.range)) {
      problems.push(`${label}\n    ${advisory.package} ${newest} is outside the advisory's range: a fixed version is out. Update the lockfile to it and remove the exception in scripts/audit-deps.mjs.`)
    } else {
      excused.push(`${label}\n    Excepted: ${exception.reason}\n    Newest ${advisory.package} is ${newest}, still affected; this fails once a fixed version is published.`)
    }
  }
  for (const exception of exceptions) {
    if (!advisories.has(exception.advisory)) {
      problems.push(`${exception.package} ${exception.advisory} is excepted but no longer reported. Remove the exception in scripts/audit-deps.mjs.`)
    }
  }
  return { problems, excused }
}

function npm(args) {
  const execPath = process.env.npm_execpath
  const result = execPath && /\.c?js$/.test(execPath)
    ? spawnSync(process.execPath, [execPath, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    : spawnSync('npm', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' })
  if (result.error) throw result.error
  return result
}

function readJson(text, what) {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Could not read ${what}:\n${text.slice(0, 2000)}`)
  }
}

// npm counts affected packages (including indirect ones), not individual advisories.
function checkedReport(audit) {
  if (audit.signal || ![0, 1].includes(audit.status)) {
    throw new Error(`npm audit did not finish normally (${audit.signal ?? audit.status}).`)
  }
  const report = readJson(audit.stdout, 'the npm audit report')
  if (report?.error) throw new Error(`npm audit failed: ${report.error.summary ?? JSON.stringify(report.error)}`)
  const packages = report?.vulnerabilities
  const counts = report?.metadata?.vulnerabilities
  if (report?.auditReportVersion !== 2 || !packages || typeof packages !== 'object' || Array.isArray(packages)) {
    throw new Error('Missing or unsupported npm audit report.')
  }
  const entries = Object.entries(packages)
  if (counts?.total !== entries.length || audit.status !== (entries.length ? 1 : 0)) {
    throw new Error('npm audit exit status, total and affected package list must agree.')
  }

  const bySeverity = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 }
  const explained = new Set()
  const dependents = new Map()
  for (const [name, entry] of entries) {
    if (entry?.name !== name || !Object.hasOwn(bySeverity, entry.severity) || !Array.isArray(entry.via) || !entry.via.length) {
      throw new Error(`Incomplete npm audit entry for ${name}.`)
    }
    bySeverity[entry.severity]++
    for (const via of entry.via) {
      if (typeof via === 'string' && Object.hasOwn(packages, via)) {
        if (!dependents.has(via)) dependents.set(via, [])
        dependents.get(via).push(name)
      } else if (via?.name === name && typeof via.title === 'string' && via.title.trim()
        && typeof via.range === 'string' && via.range.trim() && Object.hasOwn(bySeverity, via.severity)
        && (advisoryId(via.url) || Number.isSafeInteger(via.source))) {
        explained.add(name)
      } else {
        throw new Error(`Unrecognized npm audit advisory or dependency for ${name}.`)
      }
    }
  }
  for (const [severity, count] of Object.entries(bySeverity)) {
    if (counts[severity] !== count) throw new Error(`Inconsistent npm audit count for ${severity}.`)
  }
  // Each indirect entry must ultimately lead to a concrete advisory. Set iteration visits additions, too.
  for (const name of explained) {
    for (const dependent of dependents.get(name) ?? []) explained.add(dependent)
  }
  if (explained.size !== entries.length) throw new Error('Affected packages lack an underlying npm audit advisory.')
  return report
}

function main() {
  const report = checkedReport(npm(['audit', '--json', '--audit-level=info']))
  const published = new Map()
  for (const name of new Set(EXCEPTIONS.map((exception) => exception.package))) {
    const view = npm(['view', name, 'versions', '--json'])
    if (view.status !== 0) continue
    const versions = readJson(view.stdout, `the versions of ${name}`)
    published.set(name, Array.isArray(versions) ? versions : [versions])
  }
  const { problems, excused } = auditVerdict(report, EXCEPTIONS, published)
  for (const line of excused) console.log(`Excepted advisory: ${line}\n`)
  if (problems.length > 0) {
    console.error(`The dependency audit failed:\n\n${problems.map((line) => `- ${line}`).join('\n\n')}`)
    process.exitCode = 1
    return
  }
  const total = report.metadata.vulnerabilities.total
  console.log(total === 0 ? 'found 0 vulnerabilities' : `No advisories other than the ${excused.length} excepted above.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
