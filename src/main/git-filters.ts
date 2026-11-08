import type { GitCommandRunner } from './git'

const FILTER_KEYS = '^filter\\..*\\.'
const MAX_FILTER_DRIVERS = 64
const MAX_OVERRIDE_LENGTH = 16 * 1024

/**
 * Conversion can select drivers from tracked, info, global or system attributes.
 * Read effective config keys (never command values) before each converting call,
 * including conditional includes and per-worktree config. Do not cache this list.
 * Empty commands suppress both single-file and long-running process filters.
 */
export async function gitFilterSafetyArgs(run: GitCommandRunner, args: readonly string[]): Promise<string[]> {
  const command = args.findIndex((arg, index) => !arg.startsWith('-') && args[index - 1] !== '-C')
  const name = args[command]
  if (name !== 'status' && name !== 'diff' && name !== 'worktree' && name !== 'reset') return []
  if (name === 'worktree' && args[command + 1] !== 'add' && args[command + 1] !== 'remove') return []

  // Keep -C and other global options so the probe reads the same worktree's config.
  const drivers = new Set<string>()
  const contexts = [args.slice(0, command)]
  if (name === 'worktree' && args[command + 1] === 'remove' && !args.includes('--force')) {
    // Git checks cleanliness in the target worktree, where onbranch includes
    // and per-worktree config can differ from the repository running remove.
    const target = args.at(-1)
    if (!target) throw new Error('Could not inspect Git filters safely.')
    contexts.push(['-C', target])
  }
  for (const context of contexts) {
    const result = await run([...context, 'config', '--null', '--name-only', '--get-regexp', FILTER_KEYS])
    if (result.code === 1 && !result.stdout && !result.stderr && !result.launchError) continue
    if (result.code !== 0 || result.launchError || (result.stdout && !result.stdout.endsWith('\0'))) {
      throw new Error('Could not inspect Git filters safely.')
    }
    for (const key of result.stdout.split('\0').filter(Boolean)) {
      const match = /^filter\.(.+)\.[a-z][a-z0-9-]*$/i.exec(key)
      const driver = match?.[1]
      // '=' would change where -c splits its assignment. Controls cannot be shown
      // safely in errors and are unnecessary for a usable driver name.
      if (!driver || driver.length > 128 || /[=\u0000-\u001f\u007f-\u009f]/.test(driver)) {
        throw new Error('Could not inspect Git filters safely.')
      }
      drivers.add(driver)
      if (drivers.size > MAX_FILTER_DRIVERS) throw new Error('Too many Git filters to inspect safely.')
    }
  }
  const overrides = [...drivers].flatMap((driver) => [
    '-c', `filter.${driver}.clean=`,
    '-c', `filter.${driver}.smudge=`,
    '-c', `filter.${driver}.process=`,
    // Reads compare unfiltered content. A mutation must fail rather than
    // produce a checkout without its configured conversion (for example LFS).
    '-c', `filter.${driver}.required=${name === 'worktree' || name === 'reset' ? 'true' : 'false'}`,
  ])
  if (overrides.join(' ').length > MAX_OVERRIDE_LENGTH) throw new Error('Too many Git filters to inspect safely.')
  return overrides
}
