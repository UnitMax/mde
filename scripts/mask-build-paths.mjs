// Replace the longest prefix first, including the forward-slash paths emitted by Node build tools.
import { createInterface } from 'node:readline'

const replacements = new Map()
for (let i = 2; i < process.argv.length; i += 2) {
  const label = process.argv[i]
  const path = process.argv[i + 1]
  if (path.length <= 1) continue
  for (const spelling of [path, path.replaceAll('\\', '/'), path.replaceAll('\\', '\\\\')]) {
    replacements.set(spelling.toLowerCase(), label)
  }
}
const patterns = [...replacements.keys()].sort((a, b) => b.length - a.length)
  .map(path => path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
const paths = new RegExp(patterns.join('|'), 'gi')
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  console.log(line.replace(paths, match => replacements.get(match.toLowerCase())))
}
