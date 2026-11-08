import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const electronRoot = join(root, 'node_modules', 'electron')
const version = JSON.parse(readFileSync(join(electronRoot, 'package.json'), 'utf8')).version
const name = `electron-v${version}-win32-x64.zip`
const checksums = JSON.parse(readFileSync(join(electronRoot, 'checksums.json'), 'utf8'))
const expected = checksums[name]
const cache = process.env.electron_config_cache || process.env.ELECTRON_CACHE ||
  (process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'electron', 'Cache'))
if (!cache || !existsSync(cache) || !expected) {
  throw new Error(`Offline Electron cache or checksum unavailable for ${name}.`)
}
const candidates = [join(cache, name), ...readdirSync(cache, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(cache, entry.name, name))].filter(existsSync)
let archive
for (const candidate of candidates) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(candidate)) hash.update(chunk)
  if (hash.digest('hex') === expected) {
    archive = resolve(candidate)
    break
  }
}
if (!archive) throw new Error(`No valid cached Electron ZIP found for ${name}.`)
console.log('Using checksum-verified Electron ZIP from the Windows cache.')
const result = spawnSync(process.execPath, [
  join(root, 'node_modules', 'electron-builder', 'cli.js'),
  '--win', '--x64', '--dir', `-c.electronDist=${archive}`,
], { cwd: root, stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
