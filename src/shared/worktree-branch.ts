/** The longest branch name a person can choose for a new worktree. */
export const WORKTREE_BRANCH_MAX_LENGTH = 100

const ALLOWED = /^[A-Za-z0-9._/+-]+$/

/**
 * Why a branch name chosen for a new worktree cannot be used, or null when it can. The rules are
 * Git's own for a branch name, kept to a plain ASCII subset so the name reaches Git (natively or
 * through WSL) unchanged and cannot be mistaken for an option. The new-thread page uses this for
 * instant feedback and the main process applies it again before Git sees the name.
 */
export function worktreeBranchProblem(name: string): string | null {
  if (name.length === 0) return 'Enter a branch name.'
  if (name.length > WORKTREE_BRANCH_MAX_LENGTH) return `Use at most ${WORKTREE_BRANCH_MAX_LENGTH} characters.`
  if (/\s/.test(name)) return 'A branch name cannot contain spaces. Use - instead.'
  if (!ALLOWED.test(name)) return 'Use only letters, numbers and . _ - / +'
  if (name.startsWith('-')) return 'A branch name cannot start with -.'
  if (name.startsWith('/') || name.endsWith('/') || name.includes('//')) return 'A branch name cannot start or end with / or contain //.'
  if (name.includes('..')) return 'A branch name cannot contain ..'
  if (name.endsWith('.')) return 'A branch name cannot end with a dot.'
  if (name.split('/').some((part) => part.startsWith('.') || part.endsWith('.lock'))) {
    return 'Parts between slashes cannot start with a dot or end with .lock.'
  }
  if (name === 'HEAD') return 'HEAD cannot be a branch name.'
  return null
}

/**
 * Why a valid name clashes with the local branches that exist, or null. Git keeps branches as
 * files, so `feature` and `feature/login` cannot both exist. Git has the last word; this only
 * lets the new-thread page and the main process say so plainly before anything is created.
 */
export function worktreeBranchConflict(name: string, existing: readonly string[]): string | null {
  for (const other of existing) {
    if (other === name) return `A branch named ${name} already exists. Choose another name.`
    if (name.startsWith(`${other}/`)) return `A branch named ${other} already exists, so ${name} cannot be created. Choose another name.`
    if (other.startsWith(`${name}/`)) return `Branches under ${name}/ already exist, so ${name} cannot be a branch. Choose another name.`
  }
  return null
}
