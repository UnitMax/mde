import { StreamLanguage } from '@codemirror/language'
import type { Extension } from '@codemirror/state'

export type LanguageLoader = () => Promise<Extension>

// Each loader is a dynamic import, so every language becomes its own chunk and
// only the languages actually opened are loaded.
const typescript: LanguageLoader = () =>
  import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true }))
const tsx: LanguageLoader = () =>
  import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true, jsx: true }))
const javascript: LanguageLoader = () =>
  import('@codemirror/lang-javascript').then((m) => m.javascript())
const jsx: LanguageLoader = () =>
  import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true }))
const json: LanguageLoader = () => import('@codemirror/lang-json').then((m) => m.json())
const css: LanguageLoader = () => import('@codemirror/lang-css').then((m) => m.css())
const html: LanguageLoader = () => import('@codemirror/lang-html').then((m) => m.html())
const markdown: LanguageLoader = () => import('@codemirror/lang-markdown').then((m) => m.markdown())
const python: LanguageLoader = () => import('@codemirror/lang-python').then((m) => m.python())
const rust: LanguageLoader = () => import('@codemirror/lang-rust').then((m) => m.rust())
const yaml: LanguageLoader = () => import('@codemirror/lang-yaml').then((m) => m.yaml())
const sql: LanguageLoader = () => import('@codemirror/lang-sql').then((m) => m.sql())
const cpp: LanguageLoader = () => import('@codemirror/lang-cpp').then((m) => m.cpp())
const java: LanguageLoader = () => import('@codemirror/lang-java').then((m) => m.java())
const go: LanguageLoader = () => import('@codemirror/lang-go').then((m) => m.go())
const xml: LanguageLoader = () => import('@codemirror/lang-xml').then((m) => m.xml())
const shell: LanguageLoader = () =>
  import('@codemirror/legacy-modes/mode/shell').then((m) => StreamLanguage.define(m.shell))
const toml: LanguageLoader = () =>
  import('@codemirror/legacy-modes/mode/toml').then((m) => StreamLanguage.define(m.toml))
const powershell: LanguageLoader = () =>
  import('@codemirror/legacy-modes/mode/powershell').then((m) => StreamLanguage.define(m.powerShell))
const dockerfile: LanguageLoader = () =>
  import('@codemirror/legacy-modes/mode/dockerfile').then((m) => StreamLanguage.define(m.dockerFile))

const byExtension: Record<string, { name: string; load: LanguageLoader }> = {
  ts: { name: 'TypeScript', load: typescript },
  mts: { name: 'TypeScript', load: typescript },
  cts: { name: 'TypeScript', load: typescript },
  tsx: { name: 'TSX', load: tsx },
  js: { name: 'JavaScript', load: javascript },
  mjs: { name: 'JavaScript', load: javascript },
  cjs: { name: 'JavaScript', load: javascript },
  jsx: { name: 'JSX', load: jsx },
  json: { name: 'JSON', load: json },
  jsonc: { name: 'JSON', load: json },
  css: { name: 'CSS', load: css },
  html: { name: 'HTML', load: html },
  htm: { name: 'HTML', load: html },
  md: { name: 'Markdown', load: markdown },
  markdown: { name: 'Markdown', load: markdown },
  mdx: { name: 'Markdown', load: markdown },
  py: { name: 'Python', load: python },
  rs: { name: 'Rust', load: rust },
  yml: { name: 'YAML', load: yaml },
  yaml: { name: 'YAML', load: yaml },
  sql: { name: 'SQL', load: sql },
  c: { name: 'C', load: cpp },
  h: { name: 'C', load: cpp },
  cc: { name: 'C++', load: cpp },
  cpp: { name: 'C++', load: cpp },
  cxx: { name: 'C++', load: cpp },
  hpp: { name: 'C++', load: cpp },
  java: { name: 'Java', load: java },
  go: { name: 'Go', load: go },
  xml: { name: 'XML', load: xml },
  svg: { name: 'XML', load: xml },
  sh: { name: 'Shell', load: shell },
  bash: { name: 'Shell', load: shell },
  zsh: { name: 'Shell', load: shell },
  toml: { name: 'TOML', load: toml },
  ps1: { name: 'PowerShell', load: powershell },
  psm1: { name: 'PowerShell', load: powershell }
}

const byFileName: Record<string, { name: string; load: LanguageLoader }> = {
  dockerfile: { name: 'Dockerfile', load: dockerfile },
  '.bashrc': { name: 'Shell', load: shell },
  '.zshrc': { name: 'Shell', load: shell },
  '.profile': { name: 'Shell', load: shell }
}

/** The syntax for a file, chosen by name, or null for plain text. */
export function languageForPath(path: string): { name: string; load: LanguageLoader } | null {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const exact = byFileName[name]
  if (exact) return exact
  if (name.startsWith('dockerfile.')) return byFileName.dockerfile ?? null

  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  return byExtension[name.slice(dot + 1)] ?? null
}
