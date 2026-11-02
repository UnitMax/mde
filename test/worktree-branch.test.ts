import { describe, expect, it } from 'vitest'
import { WORKTREE_BRANCH_MAX_LENGTH, worktreeBranchConflict, worktreeBranchProblem } from '../src/shared/worktree-branch'

describe('worktreeBranchProblem', () => {
  it('accepts ordinary branch names', () => {
    for (const name of ['dark-mode', 'feature/login', 'fix_123', 'JIRA-42-add-thing', 'v1.2.3', 'user/topic/sub-topic', 'a+b', 'x']) {
      expect(worktreeBranchProblem(name), name).toBeNull()
    }
    expect(worktreeBranchProblem('a'.repeat(WORKTREE_BRANCH_MAX_LENGTH))).toBeNull()
  })

  it('explains each rule it enforces', () => {
    const cases: Array<[string, RegExp]> = [
      ['', /Enter a branch name/],
      ['a'.repeat(WORKTREE_BRANCH_MAX_LENGTH + 1), /at most 100/],
      ['two words', /spaces/],
      [' padded', /spaces/],
      ['tab\there', /spaces/],
      ['new\nline', /spaces/],
      ['ünï', /only letters, numbers/],
      ['a:b', /only letters, numbers/],
      ['a~1', /only letters, numbers/],
      ['a^b', /only letters, numbers/],
      ['a?b', /only letters, numbers/],
      ['a*b', /only letters, numbers/],
      ['a[b', /only letters, numbers/],
      ['a\\b', /only letters, numbers/],
      ['a@{b', /only letters, numbers/],
      ['@', /only letters, numbers/],
      ['-f', /cannot start with -/],
      ['--force', /cannot start with -/],
      ['/a', /start or end with \//],
      ['a/', /start or end with \//],
      ['a//b', /start or end with \//],
      ['a..b', /cannot contain \.\./],
      ['a.', /end with a dot/],
      ['.hidden', /start with a dot/],
      ['a/.hidden', /start with a dot/],
      ['a.lock', /\.lock/],
      ['a.lock/b', /\.lock/],
      ['HEAD', /HEAD/],
    ]
    for (const [name, message] of cases) expect(worktreeBranchProblem(name), JSON.stringify(name)).toMatch(message)
  })

  it('does not reject HEAD when it is only part of a longer name', () => {
    expect(worktreeBranchProblem('HEAD-fix')).toBeNull()
    expect(worktreeBranchProblem('fix/HEAD')).toBeNull()
  })
})

describe('worktreeBranchConflict', () => {
  const existing = ['main', 'feature/login', 'topic']

  it('allows a name that does not touch an existing branch', () => {
    expect(worktreeBranchConflict('feature-login', existing)).toBeNull()
    expect(worktreeBranchConflict('feature/dark-mode', existing)).toBeNull()
    expect(worktreeBranchConflict('mainline', existing)).toBeNull()
    expect(worktreeBranchConflict('x', [])).toBeNull()
  })

  it('rejects a name that is taken', () => {
    expect(worktreeBranchConflict('main', existing)).toBe('A branch named main already exists. Choose another name.')
  })

  it('rejects a name inside an existing branch, and a name that an existing branch is inside of', () => {
    expect(worktreeBranchConflict('topic/new', existing)).toBe('A branch named topic already exists, so topic/new cannot be created. Choose another name.')
    expect(worktreeBranchConflict('feature', existing)).toBe('Branches under feature/ already exist, so feature cannot be a branch. Choose another name.')
  })
})
