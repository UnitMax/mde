import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, parse } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prepareStage } from '../scripts/prepare-windows-stage.mjs'

describe('Windows build staging', () => {
  let root: string
  let source: string
  let profile: string
  let stage: string

  beforeEach(() => {
    root = realpathSync.native(mkdtempSync(join(tmpdir(), 'mde-stage-test-')))
    source = join(root, 'projects', 'source')
    profile = join(root, 'profile')
    stage = join(profile, 'temporary', 'build')
    mkdirSync(source, { recursive: true })
    mkdirSync(profile)
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const prepare = (target: string) => prepareStage(target, source, [profile])

  it.each([true, false])('initializes and reuses a staging folder (already empty: %s)', existing => {
    if (existing) mkdirSync(stage, { recursive: true })
    expect(prepare(stage)).toBe(stage)
    writeFileSync(join(stage, 'artifact'), 'previous build')
    expect(prepare(stage)).toBe(stage)
    expect(readFileSync(join(stage, '.mde-build-root'), 'utf8')).toContain('MDE Windows build')
  })

  it('preserves files in an unmarked staging folder, including hidden files', () => {
    mkdirSync(stage, { recursive: true })
    const original = join(stage, '.keep')
    writeFileSync(original, 'original')
    expect(() => prepare(stage)).toThrow('nonempty and unmarked')
    expect(readFileSync(original, 'utf8')).toBe('original')
    writeFileSync(join(stage, '.mde-build-root'), 'unknown')
    expect(() => prepare(stage)).toThrow('Invalid MDE staging marker')
  })

  it('refuses drive roots, home and source folders, ancestors, and staging inside the source', () => {
    for (const path of [parse(root).root, profile, source, dirname(source), join(source, 'nested')]) {
      expect(() => prepare(path)).toThrow('protected folder')
    }
  })

  it('refuses a directory junction in the staging path and a redirected marker', () => {
    const link = join(root, 'redirect')
    symlinkSync(profile, link, 'junction')
    expect(() => prepare(link)).toThrow('without links or junctions')
    expect(() => prepare(join(link, 'child'))).toThrow('without links or junctions')
    mkdirSync(stage, { recursive: true })
    symlinkSync(source, join(stage, '.mde-build-root'), 'junction')
    expect(() => prepare(stage)).toThrow('Invalid MDE staging marker')
  })

  it('prints percent placeholders for native, WSL and slash-normalized build paths', () => {
    const result = spawnSync(process.execPath, [
      'scripts/mask-build-paths.mjs', '%TEMP%', 'C:\\profile\\Temp', '%USERPROFILE%', 'C:\\profile',
      '%HOME%', '/home/me',
    ], { encoding: 'utf8', input: 'c:\\profile\\temp\\build\nC:/profile/file\n/home/me/project\n' })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('%TEMP%\\build\n%USERPROFILE%/file\n%HOME%/project\n')
  })
})
