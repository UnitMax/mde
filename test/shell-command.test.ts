import { describe, expect, it } from 'vitest'
import { commandView, splitCommand } from '../src/renderer/lib/shell-command'

const DIR = '/home/me/app'
const texts = (command: string): string[] | null => splitCommand(command)?.map((step) => step.text) ?? null
const ops = (command: string): Array<string | null> | null => splitCommand(command)?.map((step) => step.op) ?? null

describe('splitCommand', () => {
  it('splits on &&, ||, ; and line breaks', () => {
    expect(texts('cd app && npm test || echo failed; ls')).toEqual(['cd app', 'npm test', 'echo failed', 'ls'])
    expect(ops('cd app && npm test || echo failed; ls')).toEqual([null, '&&', '||', ';'])
    expect(texts('npm ci\nnpm test')).toEqual(['npm ci', 'npm test'])
    expect(ops('a;\nb')).toEqual([null, ';'])
  })

  it('keeps a pipe within its step', () => {
    expect(texts('git log | head -5 && git status')).toEqual(['git log | head -5', 'git status'])
  })

  it('does not split inside quotes, substitutions, subshells or braces', () => {
    expect(texts(`echo "a && b" && echo 'c; d'`)).toEqual(['echo "a && b"', `echo 'c; d'`])
    expect(texts('echo $(cd x && pwd) && ls')).toEqual(['echo $(cd x && pwd)', 'ls'])
    expect(texts('echo "$(a && b)"; ls')).toEqual(['echo "$(a && b)"', 'ls'])
    expect(texts('(cd x && make) && ls')).toEqual(['(cd x && make)', 'ls'])
    expect(texts('{ a; b; } && c')).toEqual(['{ a; b; }', 'c'])
    expect(texts('bash -c "npm ci && npm test"')).toEqual(['bash -c "npm ci && npm test"'])
    expect(texts('echo a\\&\\&b && ls')).toEqual(['echo a\\&\\&b', 'ls'])
  })

  it('reads redirections as part of the command, and a lone & as running in the background', () => {
    expect(texts('npm test 2>&1 && ls &>/dev/null')).toEqual(['npm test 2>&1', 'ls &>/dev/null'])
    expect(texts('npm test |& tee log')).toEqual(['npm test |& tee log'])
    expect(ops('server & sleep 1')).toEqual([null, '&'])
  })

  it('drops comments', () => {
    expect(texts('# set up\nnpm ci # install\nnpm test')).toEqual(['npm ci', 'npm test'])
    expect(texts('echo a#b')).toEqual(['echo a#b'])
  })

  it('joins a line continuation into its step', () => {
    expect(texts('npm run build \\\n  --watch && ls')).toEqual(['npm run build \\\n  --watch', 'ls'])
  })

  it('gives up on what is not a plain chain', () => {
    expect(splitCommand('cat <<EOF\na && b\nEOF')).toBeNull()
    expect(splitCommand('for f in *; do echo $f; done')).toBeNull()
    expect(splitCommand('if true; then ls; fi')).toBeNull()
    expect(splitCommand('case $x in a) ls;; esac')).toBeNull()
    expect(splitCommand('echo "open')).toBeNull()
    expect(splitCommand('echo )')).toBeNull()
    expect(texts('cat <<< "here" && ls')).toEqual(['cat <<< "here"', 'ls'])
  })
})

describe('commandView', () => {
  it('hides a leading cd into the thread folder', () => {
    const view = commandView('cd /home/me/app && npm test', DIR)
    expect(view.place).toBeNull()
    expect(view.steps).toEqual([{ op: null, text: 'npm test', cut: false }])
  })

  it('shows a leading cd elsewhere in the project as a place inside it', () => {
    expect(commandView('cd packages/web && npm test', DIR).place).toEqual({ shown: 'packages/web', status: 'inside' })
    expect(commandView('cd "/home/me/app/src dir" && ls', DIR).place).toEqual({ shown: 'src dir', status: 'inside' })
    expect(commandView('cd packages && cd web; ls', DIR).place).toEqual({ shown: 'packages/web', status: 'inside' })
    expect(commandView('cd packages && cd .. && ls', DIR).place).toBeNull()
  })

  it('marks a leading cd out of the project', () => {
    expect(commandView('cd .. && ls', DIR).place).toEqual({ shown: '~', status: 'outside' })
    expect(commandView('cd ~/other && git push', DIR).place).toEqual({ shown: '~/other', status: 'outside' })
    expect(commandView('cd /tmp && rm -rf x', DIR).place).toEqual({ shown: '/tmp', status: 'outside' })
    expect(commandView('cd && ls', DIR).place).toEqual({ shown: '~', status: 'outside' })
    expect(commandView('cd ~/app && ls', DIR).place).toBeNull()
  })

  it('marks a cd it cannot follow as unknown', () => {
    expect(commandView('cd "$ROOT" && ls', DIR).place).toEqual({ shown: '$ROOT', status: 'unknown' })
    expect(commandView('cd - && ls', DIR).place).toEqual({ shown: '-', status: 'unknown' })
    expect(commandView('cd $(git rev-parse --show-toplevel) && ls', DIR).place?.status).toBe('unknown')
  })

  it('keeps a cd that is not just setting up in place', () => {
    const lone = commandView('cd src', DIR)
    expect(lone.place).toBeNull()
    expect(lone.steps).toEqual([{ op: null, text: 'cd src', cut: false, place: { shown: 'src', status: 'inside' } }])
    const handled = commandView('cd /tmp || exit 1', DIR)
    expect(handled.place).toBeNull()
    expect(handled.steps[0]!.place).toEqual({ shown: '/tmp', status: 'outside' })
    const middle = commandView('npm run build && cd /srv/www && cp -r dist .', DIR)
    expect(middle.place).toBeNull()
    expect(middle.steps.map((step) => step.text)).toEqual(['npm run build', 'cd /srv/www', 'cp -r dist .'])
    expect(middle.steps[1]!.place).toEqual({ shown: '/srv/www', status: 'outside' })
    expect(middle.steps[1]!.op).toBe('&&')
  })

  it('starts from the tool’s working directory', () => {
    expect(commandView('npm test', DIR, '/home/me/app/web').place).toEqual({ shown: 'web', status: 'inside' })
    expect(commandView('npm test', DIR, '/home/me/app').place).toBeNull()
    expect(commandView('cd .. && npm test', DIR, '/home/me/app/web').place).toBeNull()
    expect(commandView('npm test', DIR, '/opt/x').place).toEqual({ shown: '/opt/x', status: 'outside' })
  })

  it('follows Windows paths without regard to case', () => {
    const dir = 'C:\\Users\\Me\\app'
    expect(commandView('cd c:\\users\\me\\APP && npm test', dir).place).toBeNull()
    expect(commandView('cd /d C:\\Users\\Me\\app\\web && npm test', dir).place).toEqual({ shown: 'web', status: 'inside' })
    expect(commandView('Set-Location -Path D:\\tmp; ls', dir).place).toEqual({ shown: 'D:\\tmp', status: 'outside' })
    expect(commandView('cd ~ ; ls', dir).place).toEqual({ shown: '~', status: 'outside' })
  })

  it('puts each step on one line', () => {
    const view = commandView('npm run build \\\n  --watch && node -e "1\n2"', DIR)
    expect(view.steps).toEqual([
      { op: null, text: 'npm run build --watch', cut: false },
      { op: '&&', text: 'node -e "1', cut: true },
    ])
  })

  it('falls back to the first line of a command it cannot split', () => {
    const view = commandView('cd /tmp\nfor f in *; do echo $f; done', DIR)
    expect(view.raw).toBe(true)
    expect(view.steps).toEqual([{ op: null, text: 'cd /tmp', cut: true }])
  })
})
