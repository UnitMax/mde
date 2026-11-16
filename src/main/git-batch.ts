import type { GitCommandResult } from './git'

/**
 * One reading of a checkout in one process.
 *
 * Reaching into WSL costs about 100 ms for every `wsl.exe` that is started, while the Git command
 * it runs there takes a few milliseconds. A reading such as the terminal header's Git chip used to
 * start ten of them. Here the commands of one reading travel together: one `wsl.exe`, one bash, and
 * the Git commands run one after the other inside the distro.
 *
 * Not done yet, and worth doing when this is still too slow:
 *  - A helper that stays running in each distro and takes requests over its standard input, so a
 *    command costs a few milliseconds instead of a round trip. That would make the file tree
 *    (one `wsl.exe` for every folder listed, see `files/tree.ts`) and the Git polling almost free.
 *    It needs a lifecycle (start, restart, exit with the app), binary-safe framing, and the same
 *    guarantee as today that arguments are never parsed by a shell.
 *  - Polling less: only the panes and threads on screen, and not at all when nothing changed.
 */

/** In a batched command, before any `--`: `HEAD`, or the empty tree in a repository with no commit. */
export const GIT_BATCH_BASE = '{mde:base}'
/** In a batched command, before any `--`: `HEAD`, or nothing in a repository with no commit. */
export const GIT_BATCH_HEAD = '{mde:head}'

/** The filter probe could not be read, or named a driver that cannot be switched off safely. */
export const GIT_BATCH_FILTERS_UNREADABLE = 97
export const GIT_BATCH_FILTERS_TOO_MANY = 98

export interface GitBatchCommand {
  args: readonly string[]
  /** True for a command that converts file contents (`status`, `diff`): it runs with every filter driver switched off. */
  converts: boolean
}

/** True when a command names a batch placeholder where the batch replaces it. */
export function usesGitBatchHead(args: readonly string[]): boolean {
  const end = args.indexOf('--')
  return (end < 0 ? args : args.slice(0, end)).some((arg) => arg === GIT_BATCH_BASE || arg === GIT_BATCH_HEAD)
}

/** The command with its placeholders replaced, as the script below does it. */
export function fillGitBatchCommand(args: readonly string[], hasHead: boolean, emptyTree: string): string[] {
  const filled: string[] = []
  let options = true
  for (const arg of args) {
    if (options && arg === '--') options = false
    if (options && arg === GIT_BATCH_BASE) filled.push(hasHead ? 'HEAD' : emptyTree)
    else if (options && arg === GIT_BATCH_HEAD) { if (hasHead) filled.push('HEAD') }
    else filled.push(arg)
  }
  return filled
}

/**
 * Runs inside the distro as `bash -c <script> mde-git <boundary> <empty tree> <head?> <filters?>
 * <n> <n safety options> { <n> <converts?> <n arguments> }...`. Every value is a positional
 * argument, so no path or name is parsed as shell syntax.
 *
 * It answers with one frame for each step: what the step wrote, then a line with the boundary and
 * the step's exit code (the boundary alone on the error stream). The steps are: the checkout root,
 * `HEAD` when asked for, the filter probe when asked for, then each command. It stops after a step
 * the rest depends on has failed, so fewer frames than expected means the rest did not run.
 *
 * The filter probe is the one in `git-filters.ts`, with the same limits: every configured filter
 * driver is switched off for the commands that convert file contents, and a driver name that
 * cannot be passed safely stops the batch.
 */
export const GIT_BATCH_SCRIPT = [
  'LC_ALL=C',
  'boundary=$1 empty=$2 want_head=$3 want_filters=$4 n=$5',
  'shift 5',
  'safe=("${@:1:n}")',
  'shift "$n"',
  'frame() { printf "\\n%s %s\\n" "$boundary" "$1"; printf "\\n%s\\n" "$boundary" >&2; }',
  'out=$(git "${safe[@]}" --no-pager rev-parse --is-inside-work-tree --show-toplevel)',
  'code=$?',
  'printf "%s\\n" "$out"',
  'frame "$code"',
  '[ "$code" -eq 0 ] || exit 0',
  'newline="',
  '"',
  'root=${out#*"$newline"}',
  'if [ "$root" = "$out" ] || [ -z "$root" ]; then exit 0; fi',
  'base=$empty',
  'head=()',
  'if [ "$want_head" = 1 ]; then',
  '  git "${safe[@]}" --literal-pathspecs -C "$root" --no-pager rev-parse --verify HEAD',
  '  code=$?',
  '  frame "$code"',
  '  if [ "$code" -eq 0 ]; then base=HEAD; head=(HEAD); fi',
  'fi',
  'filters=()',
  'if [ "$want_filters" = 1 ]; then',
  '  status=97 count=0 size=0 seen=$newline',
  "  key_pattern='^filter\\.(.+)\\.[A-Za-z][A-Za-z0-9-]*$'",
  '  while IFS= read -r -d "" key; do',
  '    case $key in',
  '      rc=0) status=0; break ;;',
  '      rc=1) if [ "$count" -eq 0 ]; then status=0; fi; break ;;',
  '      rc=*) break ;;',
  '    esac',
  '    [[ $key =~ $key_pattern ]] || break',
  '    name=${BASH_REMATCH[1]}',
  '    case $name in *=*|*[[:cntrl:]]*) break ;; esac',
  '    [ "${#name}" -le 128 ] || break',
  '    case $seen in *"$newline$name$newline"*) continue ;; esac',
  '    seen+=$name$newline',
  '    count=$((count + 1))',
  '    size=$((size + 4 * ${#name} + 90))',
  '    if [ "$count" -gt 64 ] || [ "$size" -gt 16384 ]; then status=98; break; fi',
  '    filters+=(-c "filter.$name.clean=" -c "filter.$name.smudge=" -c "filter.$name.process=" -c "filter.$name.required=false")',
  "  done < <(git \"${safe[@]}\" --literal-pathspecs -C \"$root\" config --null --name-only --get-regexp '^filter\\..*\\.'; printf 'rc=%s\\0' \"$?\")",
  '  frame "$status"',
  '  [ "$status" -eq 0 ] || exit 0',
  'fi',
  'while [ "$#" -ge 2 ]; do',
  '  n=$1 converts=$2',
  '  shift 2',
  '  args=()',
  '  options=1',
  '  for arg in "${@:1:n}"; do',
  '    if [ "$options" = 1 ]; then',
  '      case $arg in',
  '        --) options=0 ;;',
  '        "{mde:base}") arg=$base ;;',
  '        "{mde:head}") args+=("${head[@]}"); continue ;;',
  '      esac',
  '    fi',
  '    args+=("$arg")',
  '  done',
  '  shift "$n"',
  '  if [ "$converts" = 1 ]; then',
  '    git "${safe[@]}" "${filters[@]}" --literal-pathspecs -C "$root" "${args[@]}"',
  '  else',
  '    git "${safe[@]}" --literal-pathspecs -C "$root" "${args[@]}"',
  '  fi',
  '  frame "$?"',
  'done',
].join('\n')

/** The arguments after `bash -c <script>`. */
export function gitBatchArguments(
  boundary: string,
  emptyTree: string,
  safety: readonly string[],
  wantHead: boolean,
  commands: readonly GitBatchCommand[],
): string[] {
  return [
    'mde-git',
    boundary,
    emptyTree,
    wantHead ? '1' : '0',
    commands.some((command) => command.converts) ? '1' : '0',
    String(safety.length),
    ...safety,
    ...commands.flatMap((command) => [String(command.args.length), command.converts ? '1' : '0', ...command.args]),
  ]
}

/** The frames a batch wrote, in order. The boundary is random for each batch, so no output can contain it. */
export function parseGitBatchOutput(boundary: string, stdout: string, stderr: string): GitCommandResult[] {
  const errors = stderr.split(`\n${boundary}\n`)
  const frames: GitCommandResult[] = []
  const pattern = new RegExp(`\\n${boundary} (\\d+)\\n`, 'g')
  let from = 0
  for (let match = pattern.exec(stdout); match; match = pattern.exec(stdout)) {
    frames.push({ stdout: stdout.slice(from, match.index), stderr: errors[frames.length] ?? '', code: Number(match[1]) })
    from = pattern.lastIndex
  }
  return frames
}

/**
 * Roughly how many characters an argument takes on a Windows command line, where quotes and
 * backslashes are escaped. A command line there holds 32,767 characters at most.
 */
export function commandLineLength(args: readonly string[]): number {
  let length = 0
  for (const arg of args) length += arg.length + 3 + 2 * (arg.match(/["\\]/g)?.length ?? 0)
  return length
}
