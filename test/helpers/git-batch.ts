import { fillGitBatchCommand } from '../../src/main/git-batch'

export interface FakeGitResult {
  stdout?: string
  stderr?: string
  code?: number
}

export interface GitBatchRequest {
  boundary: string
  emptyTree: string
  wantHead: boolean
  wantFilters: boolean
  safety: string[]
  commands: Array<{ args: string[]; converts: boolean }>
}

/** True for a `wsl.exe` command that is one batched reading (`git-batch.ts`) rather than one Git command. */
export function isGitBatch(command: readonly string[]): boolean {
  return command.includes('mde-git')
}

/** Reads the positional arguments the batch script is started with. */
export function parseGitBatch(command: readonly string[]): GitBatchRequest {
  const values = command.slice(command.indexOf('mde-git') + 1)
  const [boundary, emptyTree, wantHead, wantFilters, count] = values
  let at = 5
  const safety = values.slice(at, at + Number(count))
  at += Number(count)
  const commands: GitBatchRequest['commands'] = []
  while (at + 1 < values.length) {
    const length = Number(values[at])
    commands.push({ converts: values[at + 1] === '1', args: values.slice(at + 2, at + 2 + length) })
    at += 2 + length
  }
  return { boundary: boundary!, emptyTree: emptyTree!, wantHead: wantHead === '1', wantFilters: wantFilters === '1', safety, commands }
}

/**
 * Answers a batched reading the way the script would, asking `answer` for each Git command it runs
 * (without the safety options): the checkout root, `HEAD`, the filter probe, then the commands.
 */
export function answerGitBatch(
  command: readonly string[],
  answer: (args: string[]) => FakeGitResult,
): { stdout: string; stderr: string; code: number } {
  const request = parseGitBatch(command)
  let stdout = ''
  let stderr = ''
  const frame = (result: FakeGitResult): number => {
    stdout += `${result.stdout ?? ''}\n${request.boundary} ${result.code ?? 0}\n`
    stderr += `${result.stderr ?? ''}\n${request.boundary}\n`
    return result.code ?? 0
  }
  const done = () => ({ stdout, stderr, code: 0 })
  const first = answer(['--no-pager', 'rev-parse', '--is-inside-work-tree', '--show-toplevel'])
  if (frame(first) !== 0) return done()
  const root = (first.stdout ?? '').split('\n')[1] ?? ''
  if (!root) return done()
  const rooted = ['--literal-pathspecs', '-C', root]
  let hasHead = false
  if (request.wantHead) hasHead = frame(answer([...rooted, '--no-pager', 'rev-parse', '--verify', 'HEAD'])) === 0
  if (request.wantFilters) {
    const probe = answer([...rooted, 'config', '--null', '--name-only', '--get-regexp', '^filter\\..*\\.'])
    const fine = (probe.code ?? 0) === 0 || (probe.code === 1 && !probe.stdout)
    if (frame({ code: fine ? 0 : 97 }) !== 0) return done()
  }
  for (const item of request.commands) frame(answer([...rooted, ...fillGitBatchCommand(item.args, hasHead, request.emptyTree)]))
  return done()
}
