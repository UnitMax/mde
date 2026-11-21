// Runs under Windows Node so NTFS junctions and the build's native paths are visible.
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const marker = '.mde-build-root'
const signature = 'MDE Windows build staging directory v1\n'

function contains(parent, child) {
  const tail = relative(parent, child)
  return tail === '' || (!isAbsolute(tail) && tail.split(/[\\/]/)[0] !== '..')
}

export function prepareStage(target, source, protectedPaths) {
  // Check each existing component before creating any missing directories.
  const missing = []
  let existing = target
  while (!lstatSync(existing, { throwIfNoEntry: false })) {
    missing.unshift(existing)
    const parent = dirname(existing)
    if (parent === existing) throw new Error('Staging drive is unavailable.')
    existing = parent
  }
  for (let dir = existing; ; dir = dirname(dir)) {
    if (!lstatSync(dir).isDirectory()) throw new Error('Staging requires ordinary directories without links or junctions.')
    if (dir === dirname(dir)) break
  }
  const canonical = resolve(realpathSync.native(existing), relative(existing, target))
  if (canonical === parse(canonical).root || contains(source, canonical)
    || [source, ...protectedPaths].some(path => contains(canonical, path))) {
    throw new Error('Refusing to use a protected folder for Windows staging.')
  }
  for (const dir of missing) mkdirSync(dir)

  const file = join(canonical, marker)
  const stat = lstatSync(file, { throwIfNoEntry: false })
  if (stat) {
    if (!stat.isFile() || stat.size !== signature.length || readFileSync(file, 'utf8') !== signature) {
      throw new Error('Invalid MDE staging marker.')
    }
  } else {
    if (readdirSync(canonical).length) throw new Error('Staging folder is nonempty and unmarked. Rename it or choose a fresh folder.')
    writeFileSync(file, signature, { flag: 'wx' })
  }
  return canonical
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [override, source, wslHome] = process.argv.slice(2)
    const { TEMP, USERPROFILE } = process.env
    const target = override || join(TEMP, 'mde-winbuild')
    if (!/^[a-z]:[\\/]/i.test(target) || /[\x00-\x1f<>:"|?*]/.test(target.slice(2))
      || target.slice(3).split(/[\\/]/).some(part => /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
      throw new Error('Staging requires an absolute Windows drive path without special or relative components.')
    }
    const path = prepareStage(resolve(target), realpathSync.native(source), [wslHome, TEMP, USERPROFILE].map(p => realpathSync.native(p)))
    // Captured privately by the caller for path conversion and log redaction.
    process.stdout.write([path, TEMP, USERPROFILE].join('\n'))
  } catch (error) {
    console.error(error.code ? 'Could not verify or initialize the Windows staging folder.' : error.message)
    process.exitCode = 1
  }
}
